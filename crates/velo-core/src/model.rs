use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A single telemetry sample from the source file.
///
/// All data fields are `Option<T>` — real devices have gaps (GPS dropout,
/// HR strap disconnected, no power meter). Widgets must handle `None` gracefully.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryPoint {
    /// Milliseconds elapsed since the start of the session (always present).
    pub timestamp_ms: u64,

    /// GPS latitude in decimal degrees. `None` if GPS signal was lost.
    pub lat: Option<f64>,

    /// GPS longitude in decimal degrees. `None` if GPS signal was lost.
    pub lon: Option<f64>,

    /// Altitude in metres above sea level.
    pub altitude_m: Option<f32>,

    /// Speed in metres per second. Widgets convert to mph/kph as needed.
    pub speed_ms: Option<f32>,

    /// Heart rate in BPM.
    pub heart_rate: Option<u8>,

    /// Pedalling cadence in RPM.
    pub cadence: Option<u8>,

    /// Power output in Watts.
    pub power: Option<u16>,

    /// Cumulative distance ridden in metres.
    pub distance_m: Option<f32>,
}

/// The full parsed telemetry session, as read from a FIT/GPX/TCX file.
/// Contains raw samples — typically 1 per second (1 Hz).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetrySession {
    /// Path of the source file (for error messages and diagnostics).
    pub source_file: PathBuf,

    /// Wall-clock start time extracted from the file header, if present.
    /// Used by timestamp-based sync strategies.
    pub recorded_start_time: Option<DateTime<Utc>>,

    /// Raw samples in chronological order.
    pub points: Vec<TelemetryPoint>,
}

/// A single frame of telemetry data, aligned to a specific video timestamp.
/// Produced by the interpolation stage — one per video frame (e.g. 1800 frames
/// for a 60-second clip at 30 fps).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryFrame {
    /// Zero-based index of the video frame.
    pub frame_index: u64,

    /// Video timestamp this frame corresponds to, in milliseconds from video start.
    pub video_time_ms: u64,

    /// Telemetry data at this frame (interpolated or actual).
    pub data: TelemetryPoint,

    /// Quality indicator for widgets to decide how to render.
    pub signal_status: SignalStatus,
}

/// Describes the origin and quality of a frame's telemetry data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SignalStatus {
    /// A real measured sample (or close enough to one that no interpolation was needed).
    Ok,

    /// Value was computed between two real samples. Perfectly normal — this is
    /// most frames given 1 Hz source data and 30 fps output.
    Interpolated,

    /// No source data exists in this region (GPS dropout, file gap, or the
    /// video extends beyond the telemetry). Widgets should show a "Signal Lost"
    /// indicator rather than a stale or zero value.
    Lost,
}
