use super::TelemetryParser;
use crate::error::ParseError;
use crate::model::TelemetrySession;
use std::path::Path;

pub struct TcxParser;

impl TelemetryParser for TcxParser {
    fn supported_extensions(&self) -> &[&str] {
        &["tcx"]
    }

    fn parse(&self, path: &Path) -> Result<TelemetrySession, ParseError> {
        // TODO: Implement TCX parsing (XML-based format).
        let _ = path;
        Err(ParseError::TcxParse("TCX parser not yet implemented".to_string()))
    }
}
