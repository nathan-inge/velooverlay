use super::TelemetryParser;
use crate::error::ParseError;
use crate::model::TelemetrySession;
use std::path::Path;

pub struct FitParser;

impl TelemetryParser for FitParser {
    fn supported_extensions(&self) -> &[&str] {
        &["fit"]
    }

    fn parse(&self, path: &Path) -> Result<TelemetrySession, ParseError> {
        // TODO: Implement FIT parsing using the `fitparser` crate.
        // Placeholder returns an error so the code compiles while we build this out.
        let _ = path;
        Err(ParseError::FitParse("FIT parser not yet implemented".to_string()))
    }
}
