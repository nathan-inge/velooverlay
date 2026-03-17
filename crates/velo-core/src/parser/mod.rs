use crate::error::ParseError;
use crate::model::TelemetrySession;
use std::path::Path;

mod fit;
mod gpx;
mod tcx;

pub use fit::FitParser;
pub use gpx::GpxParser;
pub use tcx::TcxParser;

/// The trait every parser must implement.
///
/// To add support for a new file format, create a struct and implement this trait.
/// The `ParserRegistry` will automatically pick it up if you register it.
pub trait TelemetryParser: Send + Sync {
    /// Parse the file at `path` into a normalised `TelemetrySession`.
    fn parse(&self, path: &Path) -> Result<TelemetrySession, ParseError>;

    /// File extensions this parser handles, lowercase without the dot.
    /// e.g. `&["fit"]` or `&["gpx"]`
    fn supported_extensions(&self) -> &[&str];
}

/// Selects the correct parser for a given file path based on its extension.
pub struct ParserRegistry {
    parsers: Vec<Box<dyn TelemetryParser>>,
}

impl Default for ParserRegistry {
    fn default() -> Self {
        Self {
            parsers: vec![
                Box::new(FitParser),
                Box::new(GpxParser),
                Box::new(TcxParser),
            ],
        }
    }
}

impl ParserRegistry {
    pub fn parse(&self, path: &Path) -> Result<TelemetrySession, ParseError> {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .ok_or_else(|| ParseError::UnsupportedFormat("no file extension".to_string()))?;

        let parser = self
            .parsers
            .iter()
            .find(|p| p.supported_extensions().contains(&ext.as_str()))
            .ok_or_else(|| ParseError::UnsupportedFormat(ext.clone()))?;

        parser.parse(path)
    }
}
