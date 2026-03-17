use crate::error::InterpolationError;
use crate::model::{TelemetryFrame, TelemetrySession};
use crate::sync::{SyncResult, VideoMetadata};

mod linear;
pub use linear::LinearInterpolation;

/// The trait all interpolation strategies must implement.
///
/// Takes the raw session + sync result + video metadata and produces exactly
/// one `TelemetryFrame` per video frame.
pub trait InterpolationStrategy: Send + Sync {
    fn interpolate(
        &self,
        session: &TelemetrySession,
        sync: &SyncResult,
        video: &VideoMetadata,
    ) -> Result<Vec<TelemetryFrame>, InterpolationError>;
}
