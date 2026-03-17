use crate::error::SyncError;
use crate::model::TelemetrySession;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

mod manual;
mod timestamp;
pub use manual::ManualSyncStrategy;
pub use timestamp::TimestampSyncStrategy;

/// Metadata extracted from a video file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoMetadata {
    pub path: PathBuf,
    pub duration_ms: u64,
    pub frame_rate: f32,
    /// Wall-clock timestamp embedded in the video file, if the camera recorded it.
    pub recorded_start_time: Option<DateTime<Utc>>,
}

/// The output of a sync strategy: how far to shift the telemetry timeline
/// relative to the video timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    /// Positive = telemetry starts this many ms *after* the video starts.
    /// Negative = telemetry starts this many ms *before* the video starts.
    pub offset_ms: i64,

    /// How confident the strategy is in this offset (0.0–1.0).
    /// Manual sync always reports 1.0 (the user chose it explicitly).
    /// Future algorithmic strategies may report lower confidence for UI warnings.
    pub confidence: f32,
}

/// The trait all sync strategies must implement.
///
/// Phase 0 ships `ManualSyncStrategy`. Future strategies (timestamp matching,
/// speed-curve correlation, audio-beep detection) implement this same trait
/// and are drop-in replacements — no changes to the pipeline needed.
pub trait SyncStrategy: Send + Sync {
    fn compute_offset(
        &self,
        video: &VideoMetadata,
        telemetry: &TelemetrySession,
    ) -> Result<SyncResult, SyncError>;
}
