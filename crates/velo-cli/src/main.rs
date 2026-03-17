use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

// `clap` reads these struct definitions at compile time and generates
// the full argument parser, --help text, and error messages.

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
    /// Parse a telemetry file, apply sync offset, interpolate to frame rate,
    /// and export the result as JSON or CSV.
    Process(ProcessArgs),

    /// Render a video with widget overlays burned in via FFmpeg.
    Render(RenderArgs),
}

#[derive(Parser)]
struct ProcessArgs {
    /// Path to the telemetry file (.fit, .gpx, or .tcx)
    #[arg(long, value_name = "FILE")]
    telemetry: PathBuf,

    /// Path to the video file (.mp4 or .mov) — used to determine duration and frame rate
    #[arg(long, value_name = "FILE")]
    video: PathBuf,

    /// Sync offset in milliseconds (positive = telemetry starts after video)
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

    /// Path to the telemetry file (.fit/.gpx/.tcx) or pre-processed JSON
    #[arg(long, value_name = "FILE")]
    telemetry: PathBuf,

    /// Path to the widget layout config (layout.json)
    #[arg(long, value_name = "FILE")]
    layout: PathBuf,

    /// Sync offset in milliseconds
    #[arg(long, default_value = "0", value_name = "MS")]
    offset_ms: i64,

    /// Output video file path
    #[arg(long, value_name = "FILE")]
    output: PathBuf,

    /// Output resolution
    #[arg(long, default_value = "1080p", value_parser = ["1080p", "720p"])]
    resolution: String,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Process(args) => run_process(args),
        Commands::Render(args) => run_render(args),
    }
}

fn run_process(args: ProcessArgs) -> Result<()> {
    check_ffmpeg_for_render(false);

    // TODO: Wire up velo-core Pipeline here.
    // For now, print the parsed arguments so we can verify the CLI works.
    println!("process:");
    println!("  telemetry : {}", args.telemetry.display());
    println!("  video     : {}", args.video.display());
    println!("  offset_ms : {}", args.offset_ms);
    println!("  fps       : {}", args.fps);
    println!("  format    : {}", args.format);
    println!("  output    : {}", args.output.display());

    Ok(())
}

fn run_render(args: RenderArgs) -> Result<()> {
    check_ffmpeg_for_render(true);

    // TODO: Wire up velo-core Pipeline + CLI renderer + FFmpeg here.
    println!("render:");
    println!("  video      : {}", args.video.display());
    println!("  telemetry  : {}", args.telemetry.display());
    println!("  layout     : {}", args.layout.display());
    println!("  offset_ms  : {}", args.offset_ms);
    println!("  resolution : {}", args.resolution);
    println!("  output     : {}", args.output.display());

    Ok(())
}

/// Check whether `ffmpeg` is available on PATH.
/// Only errors (exits) when `required` is true (i.e. for the render command).
fn check_ffmpeg_for_render(required: bool) {
    let found = std::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
        .is_ok();

    if !found && required {
        eprintln!("Error: ffmpeg not found on PATH.");
        eprintln!();
        eprintln!("VeloOverlay requires ffmpeg for video rendering.");
        eprintln!("Install it with:");
        eprintln!("  macOS:   brew install ffmpeg");
        eprintln!("  Windows: https://ffmpeg.org/download.html");
        std::process::exit(1);
    }
}
