/// Video metadata extraction via `ffprobe` (ships with FFmpeg).
use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;
use velo_core::sync::VideoMetadata;

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
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
    tags: Option<HashMap<String, String>>,
}

/// Video dimensions extracted alongside the core metadata.
pub struct VideoDimensions {
    pub width: u32,
    pub height: u32,
}

/// Run `ffprobe` on `path` and return `(VideoMetadata, VideoDimensions)`.
/// The width/height default to 1920×1080 if ffprobe doesn't report them.
pub fn probe_with_dimensions(path: &Path) -> Result<(VideoMetadata, VideoDimensions)> {
    let (meta, dims) = probe_internal(path)?;
    Ok((meta, dims))
}

/// Run `ffprobe` on `path` and return a `VideoMetadata`.
pub fn probe(path: &Path) -> Result<VideoMetadata> {
    probe_internal(path).map(|(m, _)| m)
}

fn probe_internal(path: &Path) -> Result<(VideoMetadata, VideoDimensions)> {
    let output = std::process::Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            path.to_str().unwrap_or(""),
        ])
        .output()
        .context("Failed to run ffprobe. Is FFmpeg installed?")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!(
            "ffprobe failed for '{}': {}",
            path.display(),
            stderr
        ));
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

    let video_stream = probe
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video"));

    let frame_rate = video_stream
        .and_then(|s| {
            // Prefer avg_frame_rate (actual display fps); r_frame_rate can be a
            // codec timebase like "90000/1" for VFR/screen recordings which
            // would produce millions of frames and break the pipeline.
            let avg = s.avg_frame_rate.as_deref().map(parse_frame_rate).filter(|&r| r > 0.0 && r < 1000.0);
            let r = s.r_frame_rate.as_deref().map(parse_frame_rate).filter(|&r| r > 0.0 && r < 1000.0);
            avg.or(r)
        })
        .unwrap_or(30.0);

    let dims = video_stream
        .and_then(|s| s.width.zip(s.height))
        .map(|(w, h)| VideoDimensions { width: w, height: h })
        .unwrap_or(VideoDimensions { width: 1920, height: 1080 });

    // Priority:
    // 1. `com.apple.quicktime.creationdate` — preserved by iMovie/Apple apps
    //    even after editing; reflects the original camera recording time.
    // 2. `creation_time` — reset to export time by iMovie on edited videos.
    let recorded_start_time: Option<DateTime<Utc>> = probe
        .format
        .tags
        .as_ref()
        .and_then(|t| {
            t.get("com.apple.quicktime.creationdate")
                .or_else(|| t.get("creation_time"))
        })
        .and_then(|s| parse_datetime(s));

    Ok((
        VideoMetadata {
            path: path.to_path_buf(),
            duration_ms,
            frame_rate,
            recorded_start_time,
        },
        dims,
    ))
}

/// Parse a datetime string that may be RFC 3339 (`+00:00`) or the Apple/GoPro
/// variant that omits the colon (`+0000`).
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

fn parse_frame_rate(s: &str) -> f32 {
    let mut parts = s.splitn(2, '/');
    let num: f32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(30.0);
    let den: f32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(1.0);
    if den > 0.0 {
        num / den
    } else {
        30.0
    }
}
