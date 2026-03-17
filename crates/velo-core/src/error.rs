use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("File not found: {0}")]
    FileNotFound(PathBuf),

    #[error("Unsupported file format: {0}")]
    UnsupportedFormat(String),

    #[error("Failed to read file '{path}': {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("Failed to parse FIT file: {0}")]
    FitParse(String),

    #[error("Failed to parse GPX file: {0}")]
    GpxParse(String),

    #[error("Failed to parse TCX file: {0}")]
    TcxParse(String),
}

#[derive(Debug, Error)]
pub enum SyncError {
    #[error("No timestamp available in video or telemetry for automatic sync")]
    NoTimestamp,

    #[error("Sync strategy '{strategy}' failed: {reason}")]
    StrategyFailed { strategy: String, reason: String },
}

#[derive(Debug, Error)]
pub enum InterpolationError {
    #[error("Telemetry session has no data points")]
    EmptySession,

    #[error("Frame rate must be positive, got {0}")]
    InvalidFrameRate(f32),
}

#[derive(Debug, Error)]
pub enum PipelineError {
    #[error("Parse error: {0}")]
    Parse(#[from] ParseError),

    #[error("Sync error: {0}")]
    Sync(#[from] SyncError),

    #[error("Interpolation error: {0}")]
    Interpolation(#[from] InterpolationError),
}
