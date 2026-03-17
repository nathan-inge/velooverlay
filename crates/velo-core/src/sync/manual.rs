use super::{SyncResult, SyncStrategy, VideoMetadata};
use crate::error::SyncError;
use crate::model::TelemetrySession;

/// The Phase 0 sync strategy: the user provides the offset directly.
///
/// # Example
/// ```
/// use velo_core::sync::ManualSyncStrategy;
/// // Telemetry starts 3.5 seconds after the video:
/// let strategy = ManualSyncStrategy::new(3500);
/// ```
pub struct ManualSyncStrategy {
    offset_ms: i64,
}

impl ManualSyncStrategy {
    pub fn new(offset_ms: i64) -> Self {
        Self { offset_ms }
    }
}

impl SyncStrategy for ManualSyncStrategy {
    fn compute_offset(
        &self,
        _video: &VideoMetadata,
        _telemetry: &TelemetrySession,
    ) -> Result<SyncResult, SyncError> {
        Ok(SyncResult {
            offset_ms: self.offset_ms,
            confidence: 1.0,
        })
    }
}
