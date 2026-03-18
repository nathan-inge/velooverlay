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
}

#[derive(Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
    tags: Option<HashMap<String, String>>,
}

/// Run `ffprobe` on `path` and return a `VideoMetadata`.
pub fn probe(path: &Path) -> Result<VideoMetadata> {
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

    let frame_rate = probe
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

    let recorded_start_time: Option<DateTime<Utc>> = probe
        .format
        .tags
        .as_ref()
        .and_then(|t| t.get("creation_time"))
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt: chrono::DateTime<chrono::FixedOffset>| dt.with_timezone(&Utc));

    Ok(VideoMetadata {
        path: path.to_path_buf(),
        duration_ms,
        frame_rate,
        recorded_start_time,
    })
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
