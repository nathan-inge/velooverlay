use super::TelemetryParser;
use crate::error::ParseError;
use crate::model::TelemetrySession;
use std::path::Path;

pub struct GpxParser;

impl TelemetryParser for GpxParser {
    fn supported_extensions(&self) -> &[&str] {
        &["gpx"]
    }

    fn parse(&self, path: &Path) -> Result<TelemetrySession, ParseError> {
        // TODO: Implement GPX parsing using the `gpx` crate.
        let _ = path;
        Err(ParseError::GpxParse("GPX parser not yet implemented".to_string()))
    }
}
