/// Tauri IPC commands — bridge between the TypeScript frontend and the Rust core.
use serde::Serialize;
use std::path::Path;
use velo_core::interpolation::LinearInterpolation;
use velo_core::model::SignalStatus;
use velo_core::parser::ParserRegistry;
use velo_core::pipeline::Pipeline;
use velo_core::sync::ManualSyncStrategy;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadataDto {
    pub duration_ms: u64,
    pub frame_rate: f32,
    pub has_timestamp: bool,
}

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePointDto {
    pub lat: f64,
    pub lon: f64,
    pub altitude_m: Option<f32>,
    pub distance_m: Option<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteBoundsDto {
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lon: f64,
    pub max_lon: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteDataDto {
    pub points: Vec<RoutePointDto>,
    pub bounds: RouteBoundsDto,
}

/// Combined result of the pipeline: per-frame telemetry + full GPS route.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessResult {
    pub frames: Vec<TelemetryFrameDto>,
    pub route: RouteDataDto,
    /// Total duration of the telemetry session in milliseconds.
    pub session_duration_ms: u64,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Check whether ffmpeg is available on the system PATH.
#[tauri::command]
pub fn check_ffmpeg() -> bool {
    std::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
        .is_ok()
}

/// Extract metadata from a video file using ffprobe.
#[tauri::command]
pub fn get_video_metadata(video_path: String) -> Result<VideoMetadataDto, String> {
    let path = Path::new(&video_path);
    let meta = crate::video_meta::probe(path).map_err(|e| e.to_string())?;
    Ok(VideoMetadataDto {
        duration_ms: meta.duration_ms,
        frame_rate: meta.frame_rate,
        has_timestamp: meta.recorded_start_time.is_some(),
    })
}

/// Run the full pipeline: parse telemetry, sync (manual offset), interpolate.
/// Returns both the frame stream and the full GPS route for the snake map.
#[tauri::command]
pub fn process_telemetry(
    telemetry_path: String,
    video_path: String,
    offset_ms: i64,
    fps: f32,
) -> Result<ProcessResult, String> {
    let tel_path = Path::new(&telemetry_path);
    let vid_path = Path::new(&video_path);

    // Probe video to get duration.
    let mut video_meta =
        crate::video_meta::probe(vid_path).map_err(|e| e.to_string())?;

    // Override fps if the caller provided one (used if user wants different rate).
    // For Phase 1 we honour whatever ffprobe reports, so this is a no-op unless
    // the caller changes it.
    if fps > 0.0 {
        video_meta.frame_rate = fps;
    }

    // Parse full session to extract GPS route for the snake-map widget.
    let registry = ParserRegistry::default();
    let session = registry
        .parse(tel_path)
        .map_err(|e| format!("Failed to parse telemetry: {e}"))?;

    // Build RouteDataDto from the raw session points.
    let gps_points: Vec<(f64, f64, Option<f32>, Option<f32>)> = session
        .points
        .iter()
        .filter_map(|p| Some((p.lat?, p.lon?, p.altitude_m, p.distance_m)))
        .collect();

    let route = if gps_points.is_empty() {
        RouteDataDto {
            points: vec![],
            bounds: RouteBoundsDto {
                min_lat: 0.0,
                max_lat: 0.0,
                min_lon: 0.0,
                max_lon: 0.0,
            },
        }
    } else {
        let min_lat = gps_points.iter().map(|(lat, _, _, _)| *lat).fold(f64::INFINITY, f64::min);
        let max_lat = gps_points.iter().map(|(lat, _, _, _)| *lat).fold(f64::NEG_INFINITY, f64::max);
        let min_lon = gps_points.iter().map(|(_, lon, _, _)| *lon).fold(f64::INFINITY, f64::min);
        let max_lon = gps_points.iter().map(|(_, lon, _, _)| *lon).fold(f64::NEG_INFINITY, f64::max);
        RouteDataDto {
            points: gps_points
                .iter()
                .map(|(lat, lon, alt, dist)| RoutePointDto {
                    lat: *lat,
                    lon: *lon,
                    altitude_m: *alt,
                    distance_m: *dist,
                })
                .collect(),
            bounds: RouteBoundsDto {
                min_lat,
                max_lat,
                min_lon,
                max_lon,
            },
        }
    };

    // Run pipeline with manual sync offset.
    let pipeline = Pipeline::new(
        Box::new(ManualSyncStrategy::new(offset_ms)),
        Box::new(LinearInterpolation),
    );

    let raw_frames = pipeline
        .process(tel_path, &video_meta)
        .map_err(|e| format!("Pipeline error: {e}"))?;

    // Convert to DTOs.
    let frames: Vec<TelemetryFrameDto> = raw_frames
        .iter()
        .map(|f| TelemetryFrameDto {
            frame_index: f.frame_index,
            video_time_ms: f.video_time_ms,
            speed_ms: f.data.speed_ms,
            heart_rate: f.data.heart_rate,
            cadence: f.data.cadence,
            power: f.data.power,
            lat: f.data.lat,
            lon: f.data.lon,
            altitude_m: f.data.altitude_m,
            distance_m: f.data.distance_m,
            signal_status: match f.signal_status {
                SignalStatus::Ok => "ok".to_string(),
                SignalStatus::Interpolated => "interpolated".to_string(),
                SignalStatus::Lost => "lost".to_string(),
            },
        })
        .collect();

    let session_duration_ms = session.points.last().map(|p| p.timestamp_ms).unwrap_or(0);

    Ok(ProcessResult { frames, route, session_duration_ms })
}

/// Attempt automatic sync using embedded timestamps from the video and telemetry files.
/// Returns the computed offset_ms on success, or an error string if timestamps are missing.
#[tauri::command]
pub fn compute_auto_sync(
    video_path: String,
    telemetry_path: String,
) -> Result<i64, String> {
    use velo_core::sync::{SyncStrategy, TimestampSyncStrategy};

    let vid_path = Path::new(&video_path);
    let tel_path = Path::new(&telemetry_path);

    let video_meta = crate::video_meta::probe(vid_path).map_err(|e| e.to_string())?;
    let registry = ParserRegistry::default();
    let session = registry
        .parse(tel_path)
        .map_err(|e| format!("Failed to parse telemetry: {e}"))?;

    let result = TimestampSyncStrategy
        .compute_offset(&video_meta, &session)
        .map_err(|e| format!("{e}"))?;

    Ok(result.offset_ms)
}

/// Burn widget overlays onto the video using FFmpeg and write to `output_path`.
/// `layout_json` is the serialised layout.json from the frontend.
/// This runs synchronously (on Tauri's thread pool) — can take several minutes.
#[tauri::command]
pub fn export_video(
    video_path: String,
    telemetry_path: String,
    offset_ms: i64,
    layout_json: String,
    output_path: String,
) -> Result<(), String> {
    crate::render::export(
        Path::new(&video_path),
        Path::new(&telemetry_path),
        offset_ms,
        &layout_json,
        Path::new(&output_path),
    )
    .map_err(|e| e.to_string())
}
