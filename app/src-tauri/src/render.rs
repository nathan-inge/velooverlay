/// Session-based FFmpeg export for the GUI.
///
/// Each export is a three-step protocol:
///   1. `start_export` — probe video, spawn FFmpeg, return a session ID
///   2. `write_frame`  — pipe one PNG-encoded overlay frame via image2pipe
///   3. `finish_export` — drop stdin (EOF) and wait for FFmpeg to finish
///
/// `abort_export` can be called at any point to kill FFmpeg immediately.
use anyhow::{anyhow, Context, Result};
use std::collections::HashMap;
use std::io::{BufWriter, Write as IoWrite};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::Mutex;

// ── Session data ──────────────────────────────────────────────────────────────

pub struct ExportSession {
    child: Child,
    /// None after `finish_export` or `abort_export` drops stdin.
    stdin: Option<BufWriter<ChildStdin>>,
}

/// Managed state registered with Tauri via `app.manage()`.
pub struct ExportState(pub Mutex<HashMap<String, ExportSession>>);

impl ExportState {
    pub fn new() -> Self {
        ExportState(Mutex::new(HashMap::new()))
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn make_session_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", nanos)
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Probe the video, spawn FFmpeg reading PNG frames from stdin, and register a session.
///
/// `encoder` selects the output codec:
///   `"balanced"` — libx264, preset medium, CRF 23 (default quality)
///   `"fast"`     — libx264, preset veryfast, CRF 23 (~3× faster, slightly larger file)
///   `"hardware"` — h264_videotoolbox, q:v 65 (macOS GPU encoder, ~10× faster)
///
/// Returns the session ID that callers must pass to subsequent commands.
pub fn start_export(
    video_path: &str,
    output_path: &str,
    width: u32,
    height: u32,
    encoder: &str,
    state: &ExportState,
) -> Result<String> {
    let video_meta = crate::video_meta::probe(std::path::Path::new(video_path))
        .context("Failed to probe video")?;

    // Build the filter_complex for scale/crop/overlay at the requested resolution.
    //
    // The overlay PNG frames are always 1920×1080 (stage resolution) regardless of
    // output resolution — encoding a 4K OffscreenCanvas to PNG takes ~50ms/frame in
    // WebKit vs ~10ms at 1080p. We upscale the overlay here with bicubic interpolation
    // before compositing. Widget graphics (text, shapes) upscale cleanly to 4K.
    let filter = format!(
        "[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,\
         crop={w}:{h}:(iw-{w})/2:(ih-{h})/2[base];\
         [1:v]scale={w}:{h}:flags=bicubic[ovl];\
         [base][ovl]overlay=0:0",
        w = width,
        h = height
    );

    let frame_rate_str = format!("{:.6}", video_meta.frame_rate);

    // Compute a resolution-proportional bitrate for the hardware encoder.
    // Target ~25 Mbps at 4K, scaling linearly with pixel count.
    // (libx264 CRF 23 produces ~5–15 Mbps at 4K; the hardware encoder is
    // less efficient at low bitrates so a higher absolute target is reasonable.)
    let hw_bitrate = {
        let pixels = width as u64 * height as u64;
        let mbps = (25 * pixels / (3840 * 2160)).max(4); // floor at 4 Mbps
        format!("{}M", mbps)
    };

    // Build codec args based on encoder selection.
    let codec_args: Vec<&str> = match encoder {
        "fast"     => vec!["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"],
        "hardware" => vec!["-c:v", "h264_videotoolbox", "-b:v", &hw_bitrate],
        _          => vec!["-c:v", "libx264", "-crf", "23"], // "balanced" / default
    };

    // For the hardware encoder, also use VideoToolbox to hardware-decode the
    // source. Without this, 4K HEVC (GoPro / DJI / iPhone) is decoded in
    // software and becomes the bottleneck — even though the H.264 encoder
    // itself is fast. Apple Silicon decodes 4K HEVC at >100 fps in hardware.
    // FFmpeg copies the decoded frames back to system memory automatically so
    // the software scale+overlay filter still works without modification.
    let hw_decode: &[&str] = if encoder == "hardware" {
        &["-hwaccel", "videotoolbox"]
    } else {
        &[]
    };

    // PNG encoding on the JS side compresses the mostly-transparent overlay from
    // ~8 MB raw RGBA to ~50–200 KB per frame, cutting IPC cost by ~100×.
    // PNG is self-delimiting (IEND chunk), so FFmpeg knows frame boundaries.
    let mut args: Vec<&str> = vec!["-y"];
    args.extend_from_slice(hw_decode);
    args.extend_from_slice(&[
        "-i", video_path,
        "-f", "image2pipe", "-c:v", "png",
        "-r", &frame_rate_str,
        "-i", "pipe:0",
        "-filter_complex", &filter,
    ]);
    args.extend_from_slice(&codec_args);
    args.extend_from_slice(&["-c:a", "copy", output_path]);

    let mut child = std::process::Command::new("ffmpeg")
        .args(&args)
        .stdin(Stdio::piped())
        .spawn()
        .context("Failed to launch FFmpeg — is it installed and on PATH?")?;

    let stdin_raw = child.stdin.take().expect("FFmpeg stdin not piped");

    let session_id = make_session_id();
    state.0.lock().unwrap().insert(
        session_id.clone(),
        ExportSession {
            child,
            stdin: Some(BufWriter::new(stdin_raw)),
        },
    );

    Ok(session_id)
}

/// Write one PNG-encoded overlay frame to the FFmpeg pipe.
///
/// A broken pipe is treated as a clean finish (FFmpeg closed its side after
/// receiving all the video frames it needs).
pub fn write_frame(session_id: &str, frame: Vec<u8>, state: &ExportState) -> Result<()> {
    let mut map = state.0.lock().unwrap();
    let session = map
        .get_mut(session_id)
        .ok_or_else(|| anyhow!("Unknown export session: {}", session_id))?;
    let stdin = session
        .stdin
        .as_mut()
        .ok_or_else(|| anyhow!("Session stdin already closed"))?;
    match stdin.write_all(&frame) {
        Ok(_) => stdin.flush().context("Failed to flush FFmpeg stdin"),
        Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => Ok(()),
        Err(e) => Err(anyhow::Error::from(e).context("Failed to write overlay frame to FFmpeg")),
    }
}

/// Signal end-of-stream by dropping stdin, then wait for FFmpeg to finish.
pub fn finish_export(session_id: &str, state: &ExportState) -> Result<()> {
    let mut session = state
        .0
        .lock()
        .unwrap()
        .remove(session_id)
        .ok_or_else(|| anyhow!("Unknown export session: {}", session_id))?;

    // Drop stdin → FFmpeg sees EOF on its overlay input and begins muxing.
    drop(session.stdin.take());

    let status = session.child.wait().context("Failed to wait for FFmpeg")?;
    if !status.success() {
        return Err(anyhow!(
            "FFmpeg exited with code {}",
            status.code().unwrap_or(-1)
        ));
    }
    Ok(())
}

/// Kill FFmpeg immediately and clean up the session.
pub fn abort_export(session_id: &str, state: &ExportState) {
    if let Some(mut session) = state.0.lock().unwrap().remove(session_id) {
        drop(session.stdin.take());
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
}
