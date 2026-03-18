/// FFmpeg-based video export for the GUI.
///
/// Replicates the CLI `velooverlay render` pipeline but callable from Tauri commands.
use anyhow::{anyhow, Context, Result};
use std::io::Write as IoWrite;
use std::path::Path;
use std::process::Stdio;
use velo_core::interpolation::LinearInterpolation;
use velo_core::parser::ParserRegistry;
use velo_core::pipeline::Pipeline;
use velo_core::render::layout::Layout;
use velo_core::sync::ManualSyncStrategy;
use widgets_builtin::font::load_system_font;
use widgets_builtin::renderer::CliRenderer;

/// Render a video with widget overlays and write the result to `output_path`.
///
/// `layout_json` is the serialised `Layout` from the frontend's current state.
/// Always renders at 1920×1080 (Phase 1 fixed output).
pub fn export(
    video_path: &Path,
    telemetry_path: &Path,
    offset_ms: i64,
    layout_json: &str,
    output_path: &Path,
) -> Result<()> {
    // 1. Probe the video so the pipeline knows duration + fps.
    let video_meta = crate::video_meta::probe(video_path)?;

    // 2. Parse the layout.
    let layout: Layout =
        serde_json::from_str(layout_json).context("Failed to parse layout JSON")?;

    // 3. Collect the full GPS track (with altitude) for map/elevation widgets.
    let full_track_points: Vec<(f64, f64, Option<f32>)> = {
        let registry = ParserRegistry::default();
        match registry.parse(telemetry_path) {
            Ok(session) => session
                .points
                .iter()
                .filter_map(|p| Some((p.lat?, p.lon?, p.altitude_m)))
                .collect(),
            Err(e) => {
                eprintln!("Warning: could not parse telemetry for full track: {e}");
                vec![]
            }
        }
    };

    // 4. Run the pipeline with the user's manual sync offset.
    let pipeline = Pipeline::new(
        Box::new(ManualSyncStrategy::new(offset_ms)),
        Box::new(LinearInterpolation),
    );
    let frames = pipeline
        .process(telemetry_path, &video_meta)
        .map_err(|e| anyhow!("Pipeline error: {e}"))?;

    // 5. Build the renderer (always 1920×1080 for Phase 1).
    const W: u32 = 1920;
    const H: u32 = 1080;
    let font = load_system_font();
    let renderer = CliRenderer::new(W, H, font, full_track_points);

    // 6. Spawn FFmpeg.
    let mut ffmpeg = std::process::Command::new("ffmpeg")
        .args([
            "-y",
            // Source video
            "-i",
            video_path.to_str().unwrap_or(""),
            // Raw RGBA overlay from stdin
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-s",
            &format!("{}x{}", W, H),
            "-framerate",
            &format!("{:.6}", video_meta.frame_rate),
            "-i",
            "pipe:0",
            // Scale the source video to 1920×1080, matching the GUI stage's
            // CSS `object-fit: cover` behaviour (scale to fill, crop centre).
            // Without this, widget positions only line up for native 1080p input.
            "-filter_complex",
            "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,\
             crop=1920:1080:(iw-1920)/2:(ih-1080)/2[base];\
             [base][1:v]overlay=0:0",
            "-c:v",
            "libx264",
            "-crf",
            "23",
            "-c:a",
            "copy",
            output_path.to_str().unwrap_or(""),
        ])
        .stdin(Stdio::piped())
        .spawn()
        .context("Failed to launch FFmpeg. Is it installed?")?;

    // 7. Pipe overlay frames.
    {
        let stdin = ffmpeg.stdin.as_mut().expect("FFmpeg stdin not piped");
        for frame in &frames {
            let rgba = renderer.render_frame(frame, &frames, &layout);
            match stdin.write_all(&rgba) {
                Ok(_) => {}
                // FFmpeg closed its stdin after processing the last video frame.
                // Treat this as a clean finish — the remaining overlay frames are
                // beyond the video's end and FFmpeg no longer needs them.
                Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => break,
                Err(e) => return Err(anyhow::Error::from(e).context("Failed to write overlay frame to FFmpeg")),
            }
        }
    }

    // 8. Wait for FFmpeg to finish.
    let status = ffmpeg.wait().context("Failed to wait for FFmpeg")?;
    if !status.success() {
        return Err(anyhow!(
            "FFmpeg exited with code {}",
            status.code().unwrap_or(-1)
        ));
    }

    Ok(())
}
