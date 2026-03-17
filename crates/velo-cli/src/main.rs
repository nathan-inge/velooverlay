mod overlay;
mod video_meta;

use anyhow::{anyhow, Context, Result};
use clap::{Parser, Subcommand};
use std::io::Write as IoWrite;
use std::path::PathBuf;
use std::process::Stdio;
use velo_core::interpolation::LinearInterpolation;
use velo_core::parser::ParserRegistry;
use velo_core::pipeline::Pipeline;
use velo_core::render::layout::Layout;
use widgets_builtin::font::load_system_font;
use widgets_builtin::renderer::CliRenderer;
use velo_core::sync::{ManualSyncStrategy, TimestampSyncStrategy, VideoMetadata};

// ---------------------------------------------------------------------------
// CLI definition
// ---------------------------------------------------------------------------

#[derive(Parser)]
#[command(
    name = "velooverlay",
    about = "Sync cycling telemetry with video and burn overlay widgets",
    version
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Parse telemetry, apply sync offset, interpolate to frame rate,
    /// and export as JSON or CSV.
    Process(ProcessArgs),

    /// Render a video with widget overlays burned in via FFmpeg.
    Render(RenderArgs),
}

#[derive(Parser)]
struct ProcessArgs {
    /// Path to the telemetry file (.fit, .gpx, or .tcx)
    #[arg(long, value_name = "FILE")]
    telemetry: PathBuf,

    /// Path to the video file (.mp4 or .mov).
    /// If omitted, the telemetry session duration is used.
    #[arg(long, value_name = "FILE")]
    video: Option<PathBuf>,

    /// Sync mode.
    /// "auto" uses embedded timestamps from the video and telemetry file.
    /// "manual" uses --offset-ms.
    #[arg(long, default_value = "auto", value_parser = ["auto", "manual"])]
    sync: String,

    /// Manual sync offset in milliseconds. Only used when --sync manual.
    /// Positive = telemetry started after video; negative = telemetry started before.
    #[arg(long, default_value = "0", value_name = "MS")]
    offset_ms: i64,

    /// Output frame rate for interpolation
    #[arg(long, default_value = "30.0", value_name = "FPS")]
    fps: f32,

    /// Output format
    #[arg(long, default_value = "json", value_parser = ["json", "csv"])]
    format: String,

    /// Output file path
    #[arg(long, value_name = "FILE")]
    output: PathBuf,
}

#[derive(Parser)]
struct RenderArgs {
    /// Path to the source video file
    #[arg(long, value_name = "FILE")]
    video: PathBuf,

    /// Path to the telemetry file (.fit, .gpx, or .tcx)
    #[arg(long, value_name = "FILE")]
    telemetry: PathBuf,

    /// Path to the widget layout config (layout.json)
    #[arg(long, value_name = "FILE")]
    layout: PathBuf,

    /// Sync mode.
    /// "auto" uses embedded timestamps from the video and telemetry file.
    /// "manual" uses --offset-ms.
    #[arg(long, default_value = "auto", value_parser = ["auto", "manual"])]
    sync: String,

    /// Manual sync offset in milliseconds. Only used when --sync manual.
    #[arg(long, default_value = "0", value_name = "MS")]
    offset_ms: i64,

    /// Output video file path
    #[arg(long, value_name = "FILE")]
    output: PathBuf,

    /// Output resolution
    #[arg(long, default_value = "1080p", value_parser = ["1080p", "720p"])]
    resolution: String,

    /// H.264 Constant Rate Factor (0–51). Lower = better quality and larger file.
    /// Default 23 matches FFmpeg's built-in default. Try 28 to reduce file size,
    /// or 18 for near-lossless output.
    #[arg(long, default_value = "23", value_name = "CRF")]
    crf: u8,
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Process(args) => run_process(args),
        Commands::Render(args) => {
            require_ffmpeg()?;
            run_render(args)
        }
    }
}

// ---------------------------------------------------------------------------
// `process` command
// ---------------------------------------------------------------------------

fn run_process(args: ProcessArgs) -> Result<()> {
    // Build VideoMetadata — either from ffprobe (if --video given) or from
    // the telemetry file itself.
    let video_meta = match &args.video {
        Some(video_path) => {
            println!("Probing video: {}", video_path.display());
            video_meta::probe(video_path, Some(args.fps))?
        }
        None => {
            // Parse the session first just to get its duration.
            let registry = ParserRegistry::default();
            let session = registry
                .parse(&args.telemetry)
                .map_err(|e| anyhow!("{e}"))?;
            let duration_ms = session
                .points
                .last()
                .map(|p| p.timestamp_ms + 1000)
                .unwrap_or(3_600_000);
            VideoMetadata {
                path: args.telemetry.clone(),
                duration_ms,
                frame_rate: args.fps,
                recorded_start_time: session.recorded_start_time,
            }
        }
    };

    println!(
        "Video: {:.1}s @ {:.2} fps → {} frames",
        video_meta.duration_ms as f64 / 1000.0,
        video_meta.frame_rate,
        (video_meta.duration_ms as f64 / 1000.0 * video_meta.frame_rate as f64) as u64,
    );

    let pipeline = Pipeline::new(
        build_sync_strategy(&args.sync, args.offset_ms, &video_meta)?,
        Box::new(LinearInterpolation),
    );

    println!("Processing: {}", args.telemetry.display());
    let frames = pipeline
        .process(&args.telemetry, &video_meta)
        .map_err(|e| anyhow!("{e}"))?;

    println!("Produced {} frames", frames.len());

    match args.format.as_str() {
        "json" => {
            let json = serde_json::to_string_pretty(&frames)
                .context("Failed to serialize frames to JSON")?;
            std::fs::write(&args.output, json)
                .with_context(|| format!("Failed to write {}", args.output.display()))?;
        }
        "csv" => {
            write_csv(&frames, &args.output)?;
        }
        _ => unreachable!(),
    }

    println!("Output written to: {}", args.output.display());
    Ok(())
}

// ---------------------------------------------------------------------------
// `render` command
// ---------------------------------------------------------------------------

fn run_render(args: RenderArgs) -> Result<()> {
    println!("Probing video: {}", args.video.display());
    let video_meta = video_meta::probe(&args.video, None)?;

    println!(
        "Video: {:.1}s @ {:.2} fps → {} frames",
        video_meta.duration_ms as f64 / 1000.0,
        video_meta.frame_rate,
        (video_meta.duration_ms as f64 / 1000.0 * video_meta.frame_rate as f64) as u64,
    );

    let layout_json = std::fs::read_to_string(&args.layout)
        .with_context(|| format!("Failed to read layout: {}", args.layout.display()))?;
    let layout: Layout =
        serde_json::from_str(&layout_json).context("Failed to parse layout.json")?;

    let pipeline = Pipeline::new(
        build_sync_strategy(&args.sync, args.offset_ms, &video_meta)?,
        Box::new(LinearInterpolation),
    );

    // Parse the full telemetry session to extract all GPS points.
    // This is used by the snake-map widget when `"full_track": true` is set —
    // the video may only cover part of the ride, but the map should show the
    // whole route. We parse once here so the pipeline can run separately.
    println!("Parsing telemetry (full track): {}", args.telemetry.display());
    let full_track_points: Vec<(f64, f64)> = {
        let registry = ParserRegistry::default();
        match registry.parse(&args.telemetry) {
            Ok(session) => session
                .points
                .iter()
                .filter_map(|p| Some((p.lat?, p.lon?)))
                .collect(),
            Err(e) => {
                eprintln!("Warning: could not parse telemetry for full track: {e}");
                vec![]
            }
        }
    };
    println!("  {} GPS points in full activity", full_track_points.len());

    println!("Processing: {}", args.telemetry.display());
    let frames = pipeline
        .process(&args.telemetry, &video_meta)
        .map_err(|e| anyhow!("{e}"))?;
    println!("Produced {} frames", frames.len());

    // Overlay resolution matches the target output resolution.
    let (overlay_w, overlay_h) = match args.resolution.as_str() {
        "720p" => (1280u32, 720u32),
        _ => (1920u32, 1080u32),
    };

    println!("Loading font...");
    let font = load_system_font();

    let renderer = CliRenderer::new(overlay_w, overlay_h, font, full_track_points);

    // Build the FFmpeg filter graph.
    //
    // Two inputs:
    //   [0:v]  — source video file
    //   [1:v]  — raw RGBA overlay frames read from stdin
    //
    // For 720p output we scale the source video before compositing so both
    // streams are the same resolution.
    let filter_complex = match args.resolution.as_str() {
        "720p" => "[0:v]scale=1280:720[scaled];[scaled][1:v]overlay=0:0".to_string(),
        _ => "[0:v][1:v]overlay=0:0".to_string(),
    };

    println!("Rendering with FFmpeg (piping {} frames)...", frames.len());

    let mut ffmpeg = std::process::Command::new("ffmpeg")
        .args([
            "-y",
            // Input 0: source video
            "-i",
            args.video.to_str().unwrap_or(""),
            // Input 1: raw RGBA overlay from stdin
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-s",
            &format!("{}x{}", overlay_w, overlay_h),
            "-framerate",
            &format!("{:.6}", video_meta.frame_rate),
            "-i",
            "pipe:0",
            // Composite filter
            "-filter_complex",
            &filter_complex,
            "-c:v",
            "libx264",
            "-crf",
            &args.crf.to_string(),
            "-c:a",
            "copy",
            args.output.to_str().unwrap_or(""),
        ])
        .stdin(Stdio::piped())
        .spawn()
        .context("Failed to launch FFmpeg")?;

    {
        let stdin = ffmpeg.stdin.as_mut().expect("FFmpeg stdin not piped");
        let total = frames.len();

        for (i, frame) in frames.iter().enumerate() {
            let rgba = renderer.render_frame(frame, &frames, &layout);
            stdin
                .write_all(&rgba)
                .context("Failed to write overlay frame to FFmpeg")?;

            if i % 150 == 0 || i + 1 == total {
                println!("  Frame {}/{}", i + 1, total);
            }
        }
        // stdin is dropped here → FFmpeg sees EOF on its overlay input.
    }

    let status = ffmpeg.wait().context("Failed to wait for FFmpeg")?;
    if !status.success() {
        return Err(anyhow!(
            "FFmpeg exited with status {}",
            status.code().unwrap_or(-1)
        ));
    }

    println!("Done: {}", args.output.display());
    Ok(())
}

// ---------------------------------------------------------------------------
// CSV output
// ---------------------------------------------------------------------------

fn write_csv(
    frames: &[velo_core::model::TelemetryFrame],
    path: &PathBuf,
) -> Result<()> {
    use std::fmt::Write as FmtWrite;
    let mut out = String::new();

    writeln!(
        out,
        "frame_index,video_time_ms,signal_status,\
         speed_kph,speed_mph,heart_rate,cadence,power,\
         lat,lon,altitude_m,distance_m"
    )?;

    for f in frames {
        let d = &f.data;
        writeln!(
            out,
            "{},{},{},{},{},{},{},{},{},{},{},{}",
            f.frame_index,
            f.video_time_ms,
            format!("{:?}", f.signal_status).to_lowercase(),
            opt_f32_to_csv(d.speed_ms.map(|s| s * 3.6)),
            opt_f32_to_csv(d.speed_ms.map(|s| s * 2.237)),
            opt_u8_to_csv(d.heart_rate),
            opt_u8_to_csv(d.cadence),
            opt_u16_to_csv(d.power),
            opt_f64_to_csv(d.lat),
            opt_f64_to_csv(d.lon),
            opt_f32_to_csv(d.altitude_m),
            opt_f32_to_csv(d.distance_m),
        )?;
    }

    std::fs::write(path, out)
        .with_context(|| format!("Failed to write CSV to {}", path.display()))?;
    Ok(())
}

fn opt_f32_to_csv(v: Option<f32>) -> String {
    v.map(|x| format!("{x:.3}")).unwrap_or_default()
}

fn opt_f64_to_csv(v: Option<f64>) -> String {
    v.map(|x| format!("{x:.6}")).unwrap_or_default()
}

fn opt_u8_to_csv(v: Option<u8>) -> String {
    v.map(|x| x.to_string()).unwrap_or_default()
}

fn opt_u16_to_csv(v: Option<u16>) -> String {
    v.map(|x| x.to_string()).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Sync strategy selection
// ---------------------------------------------------------------------------

/// Build the sync strategy based on the --sync flag.
///
/// "auto"   → TimestampSyncStrategy: uses creation_time from video metadata
///            and start_time from the telemetry file. Falls back to manual
///            with offset=0 and prints a warning if either timestamp is missing.
///
/// "manual" → ManualSyncStrategy: uses the --offset-ms value directly.
fn build_sync_strategy(
    mode: &str,
    offset_ms: i64,
    video_meta: &VideoMetadata,
) -> Result<Box<dyn velo_core::sync::SyncStrategy>> {
    match mode {
        "auto" => {
            if video_meta.recorded_start_time.is_none() {
                eprintln!(
                    "Warning: video has no embedded timestamp — \
                     falling back to manual offset {}ms.\n\
                     Use --sync manual --offset-ms <value> to set explicitly.",
                    offset_ms
                );
                Ok(Box::new(ManualSyncStrategy::new(offset_ms)))
            } else {
                println!("Sync: auto (timestamp-based)");
                println!(
                    "  Video start:     {}",
                    video_meta.recorded_start_time.unwrap()
                );
                // The telemetry start time is checked inside the strategy;
                // if missing it returns SyncError::NoTimestamp which we surface.
                Ok(Box::new(TimestampSyncStrategy))
            }
        }
        "manual" => {
            println!("Sync: manual offset {}ms", offset_ms);
            Ok(Box::new(ManualSyncStrategy::new(offset_ms)))
        }
        _ => unreachable!(),
    }
}

// ---------------------------------------------------------------------------
// FFmpeg check
// ---------------------------------------------------------------------------

fn require_ffmpeg() -> Result<()> {
    let found = std::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
        .is_ok();

    if !found {
        return Err(anyhow!(
            "ffmpeg not found on PATH.\nInstall it with:\n  macOS:   brew install ffmpeg\n  Windows: https://ffmpeg.org/download.html"
        ));
    }
    Ok(())
}
