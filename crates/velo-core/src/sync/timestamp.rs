use super::{SyncResult, SyncStrategy, VideoMetadata};
use crate::error::SyncError;
use crate::model::TelemetrySession;

/// Aligns telemetry to video by comparing their embedded wall-clock timestamps.
///
/// offset_ms = (telemetry_start_time - video_start_time).num_milliseconds()
///
/// Positive offset → telemetry started AFTER the video (unusual).
/// Negative offset → telemetry started BEFORE the video (typical: rider
///   started recording at home, clipped footage from mid-ride).
///
/// Requires both the video and the telemetry file to contain an embedded
/// timestamp. Returns `SyncError::NoTimestamp` if either is missing.
pub struct TimestampSyncStrategy;

impl SyncStrategy for TimestampSyncStrategy {
    fn compute_offset(
        &self,
        video: &VideoMetadata,
        telemetry: &TelemetrySession,
    ) -> Result<SyncResult, SyncError> {
        let video_time = video.recorded_start_time.ok_or(SyncError::NoTimestamp)?;
        let telem_time = telemetry.recorded_start_time.ok_or(SyncError::NoTimestamp)?;

        let offset_ms = (telem_time - video_time).num_milliseconds();

        Ok(SyncResult {
            offset_ms,
            confidence: 1.0,
        })
    }
}
