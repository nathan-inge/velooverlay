/// Video metadata extraction via `ffprobe` (ships with FFmpeg).
use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;
use velo_core::sync::VideoMetadata;

// ---------------------------------------------------------------------------
// ffprobe JSON structures (only fields we need)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct FfprobeOutput {
    streams: Vec<FfprobeStream>,
    format: FfprobeFormat,
}

#[derive(Deserialize)]
struct FfprobeStream {
    codec_type: Option<String>,
    r_frame_rate: Option<String>,
    avg_frame_rate: Option<String>,
}

#[derive(Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
    tags: Option<HashMap<String, String>>,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Run `ffprobe` on `video_path` and return a `VideoMetadata`.
///
/// `fps_override` — if `Some`, use this frame rate instead of the one reported
/// by ffprobe. Useful when the user passes `--fps` explicitly.
pub fn probe(path: &Path, fps_override: Option<f32>) -> Result<VideoMetadata> {
    let output = std::process::Command::new("ffprobe")
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            path.to_str().unwrap_or(""),
        ])
        .output()
        .context("Failed to run ffprobe. Is FFmpeg installed?")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("ffprobe failed for '{}': {}", path.display(), stderr));
    }

    let probe: FfprobeOutput = serde_json::from_slice(&output.stdout)
        .context("Failed to parse ffprobe JSON output")?;

    let duration_secs: f64 = probe
        .format
        .duration
        .as_deref()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| anyhow!("ffprobe did not report a duration for '{}'", path.display()))?;

    let duration_ms = (duration_secs * 1000.0).round() as u64;

    let detected_fps = probe
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video"))
        .and_then(|s| {
            // Prefer avg_frame_rate (actual display fps); r_frame_rate can be a
            // codec timebase like "90000/1" for VFR/screen recordings which
            // would produce millions of frames and break the pipeline.
            let avg = s.avg_frame_rate.as_deref().map(parse_frame_rate).filter(|&r| r > 0.0 && r < 1000.0);
            let r = s.r_frame_rate.as_deref().map(parse_frame_rate).filter(|&r| r > 0.0 && r < 1000.0);
            avg.or(r)
        })
        .unwrap_or(30.0);

    let frame_rate = fps_override.unwrap_or(detected_fps);

    // Try to parse the recording start time from format tags.
    //
    // Priority:
    // 1. `com.apple.quicktime.creationdate` — preserved by iMovie and Apple
    //    apps even after editing/export; reflects the original recording time.
    // 2. `creation_time` — standard tag present on GoPro, DJI, most cameras,
    //    but reset to the *export* time when a video is edited in iMovie.
    let recorded_start_time: Option<DateTime<Utc>> = probe
        .format
        .tags
        .as_ref()
        .and_then(|t| {
            t.get("com.apple.quicktime.creationdate")
                .or_else(|| t.get("creation_time"))
        })
        .and_then(|s| parse_datetime(s));

    Ok(VideoMetadata {
        path: path.to_path_buf(),
        duration_ms,
        frame_rate,
        recorded_start_time,
    })
}

/// Parse a datetime string that may be RFC 3339 (`+00:00`) or the variant
/// written by Apple/GoPro firmwares that omits the colon (`+0000`).
fn parse_datetime(s: &str) -> Option<DateTime<Utc>> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc));
    }
    // Normalize "+HHMM" → "+HH:MM" then retry.
    if s.len() > 5 {
        let (body, tail) = s.split_at(s.len() - 5);
        let b = tail.as_bytes();
        if (b[0] == b'+' || b[0] == b'-') && b[1..].iter().all(|c| c.is_ascii_digit()) {
            let normalized = format!("{}{}{}:{}", body, tail[..1].to_string(), &tail[1..3], &tail[3..5]);
            if let Ok(dt) = DateTime::parse_from_rfc3339(&normalized) {
                return Some(dt.with_timezone(&Utc));
            }
        }
    }
    None
}

/// Parse a frame rate string like "30/1" or "60000/1001" into f32.
fn parse_frame_rate(s: &str) -> f32 {
    let mut parts = s.splitn(2, '/');
    let num: f32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(30.0);
    let den: f32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(1.0);
    if den > 0.0 { num / den } else { 30.0 }
}
