use crate::error::PipelineError;
use crate::interpolation::InterpolationStrategy;
use crate::model::TelemetryFrame;
use crate::parser::ParserRegistry;
use crate::sync::{SyncStrategy, VideoMetadata};
use std::path::Path;

/// Orchestrates the full data pipeline:
///   1. Parse telemetry file → TelemetrySession
///   2. Compute sync offset → SyncResult
///   3. Interpolate to frame rate → Vec<TelemetryFrame>
///
/// Both the CLI (`velo-cli`) and the Tauri backend (`app/src-tauri`)
/// construct a `Pipeline` with their chosen strategies and call `process()`.
pub struct Pipeline {
    parser_registry: ParserRegistry,
    sync: Box<dyn SyncStrategy>,
    interpolation: Box<dyn InterpolationStrategy>,
}

impl Pipeline {
    pub fn new(
        sync: Box<dyn SyncStrategy>,
        interpolation: Box<dyn InterpolationStrategy>,
    ) -> Self {
        Self {
            parser_registry: ParserRegistry::default(),
            sync,
            interpolation,
        }
    }

    /// Run the full pipeline and return a frame-aligned telemetry stream.
    pub fn process(
        &self,
        telemetry_path: &Path,
        video: &VideoMetadata,
    ) -> Result<Vec<TelemetryFrame>, PipelineError> {
        let session = self.parser_registry.parse(telemetry_path)?;
        let sync_result = self.sync.compute_offset(video, &session)?;
        let frames = self.interpolation.interpolate(&session, &sync_result, video)?;
        Ok(frames)
    }
}
