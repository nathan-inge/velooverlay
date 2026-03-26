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

/// Probe the video, spawn FFmpeg reading RGBA from stdin, and register a session.
///
/// Returns the session ID that callers must pass to subsequent commands.
/// Always renders at 1920×1080 (Phase 1 fixed output).
pub fn start_export(
    video_path: &str,
    output_path: &str,
    state: &ExportState,
) -> Result<String> {
    let video_meta = crate::video_meta::probe(std::path::Path::new(video_path))
        .context("Failed to probe video")?;

    // Spawn FFmpeg with the same filter_complex as the old blocking export:
    //   • Scale source to 1920×1080 with cover-crop (matches GUI stage CSS object-fit: cover)
    //   • Overlay the PNG stdin stream at (0, 0) via image2pipe
    //
    // PNG encoding on the JS side compresses the mostly-transparent overlay from
    // ~8 MB raw RGBA to ~50–200 KB per frame, cutting IPC cost by ~100×.
    // PNG is self-delimiting (IEND chunk), so FFmpeg knows frame boundaries.
    let mut child = std::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            video_path,
            "-f",
            "image2pipe",
            "-c:v",
            "png",
            "-r",
            &format!("{:.6}", video_meta.frame_rate),
            "-i",
            "pipe:0",
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
            output_path,
        ])
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
