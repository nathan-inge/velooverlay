mod overlay;
mod video_meta;

use anyhow::{anyhow, Context, Result};
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use velo_core::interpolation::LinearInterpolation;
use velo_core::parser::ParserRegistry;
use velo_core::pipeline::Pipeline;
use velo_core::render::layout::Layout;
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

    println!("Processing: {}", args.telemetry.display());
    let frames = pipeline
        .process(&args.telemetry, &video_meta)
        .map_err(|e| anyhow!("{e}"))?;
    println!("Produced {} frames", frames.len());

    // Write the ASS subtitle file to a temp location.
    let ass_path = args.output.with_extension("ass");
    println!("Generating overlay: {}", ass_path.display());
    overlay::write_ass(&frames, &layout, &ass_path)?;

    // Determine output resolution.
    let scale_filter = match args.resolution.as_str() {
        "720p" => Some("scale=1280:720,"),
        _ => None, // 1080p: keep source resolution
    };

    // Build the FFmpeg filter chain.
    // The `subtitles` filter burns the .ass file into the video stream.
    let subtitle_filter = format!(
        "{}subtitles={}",
        scale_filter.unwrap_or(""),
        ass_path.to_string_lossy()
    );

    println!("Rendering with FFmpeg...");
    let status = std::process::Command::new("ffmpeg")
        .args([
            "-i",
            args.video.to_str().unwrap_or(""),
            "-vf",
            &subtitle_filter,
            "-c:a",
            "copy", // pass audio through untouched
            "-y",   // overwrite output without asking
            args.output.to_str().unwrap_or(""),
        ])
        .status()
        .context("Failed to launch FFmpeg")?;

    if !status.success() {
        return Err(anyhow!(
            "FFmpeg exited with status {}",
            status.code().unwrap_or(-1)
        ));
    }

    // Clean up the temporary ASS file.
    let _ = std::fs::remove_file(&ass_path);

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
