/// Tauri IPC commands — these are the functions the TypeScript frontend can call.
///
/// Each function annotated with `#[tauri::command]` is automatically serialized:
/// - Arguments come in as JSON from the frontend's `invoke()` call.
/// - Return values are serialized back to JSON.
/// - `Result<T, String>` maps to a Promise<T> that can reject with an error message.
use serde::Serialize;

/// Data transfer object: sent from Rust to TypeScript.
/// Mirrors `VideoMetadata` but uses camelCase for JS conventions.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadataDto {
    pub duration_ms: u64,
    pub frame_rate: f32,
    pub has_timestamp: bool,
}

/// Data transfer object for a single telemetry frame — sent to TypeScript.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryFrameDto {
    pub frame_index: u64,
    pub video_time_ms: u64,
    pub speed_ms: Option<f32>,
    pub heart_rate: Option<u8>,
    pub cadence: Option<u8>,
    pub power: Option<u16>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub altitude_m: Option<f32>,
    pub distance_m: Option<f32>,
    pub signal_status: String,
}

/// Check whether ffmpeg is available on the system PATH.
/// Called on app startup so the UI can warn the user if it's missing.
#[tauri::command]
pub fn check_ffmpeg() -> bool {
    std::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
        .is_ok()
}

/// Extract metadata from a video file (duration, frame rate, embedded timestamp).
#[tauri::command]
pub fn get_video_metadata(video_path: String) -> Result<VideoMetadataDto, String> {
    // TODO: Implement using ffprobe to read video metadata.
    let _ = video_path;
    Err("get_video_metadata not yet implemented".to_string())
}

/// Run the full pipeline: parse telemetry, sync, interpolate, return frame stream.
#[tauri::command]
pub fn process_telemetry(
    telemetry_path: String,
    video_path: String,
    offset_ms: i64,
    fps: f32,
) -> Result<Vec<TelemetryFrameDto>, String> {
    // TODO: Wire up velo-core Pipeline.
    let _ = (telemetry_path, video_path, offset_ms, fps);
    Err("process_telemetry not yet implemented".to_string())
}
