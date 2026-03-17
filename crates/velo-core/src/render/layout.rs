use serde::{Deserialize, Serialize};

/// Mirrors the layout.json format described in the TDD.
/// Shared between the CLI renderer and the GUI — the GUI exports this format
/// when saving a project, and the CLI reads it to know what to draw.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layout {
    pub schema_version: String,
    pub theme: Theme,
    pub widgets: Vec<WidgetInstance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    pub font_family: String,
    pub primary_color: String,    // hex, e.g. "#00FF00"
    pub background_opacity: f32,  // 0.0–1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetInstance {
    /// Unique ID within this layout, e.g. "speedometer-1".
    pub id: String,

    /// Widget type identifier, e.g. "builtin:speedometer" or "com.author:mywidget".
    #[serde(rename = "type")]
    pub widget_type: String,

    /// Semver string, e.g. "1.0.0".
    pub version: String,

    pub position: Position,
    pub size: Size,

    /// Widget-specific configuration (unit, color overrides, etc).
    /// Stored as raw JSON so the layout format doesn't need to know about
    /// every possible widget's config schema.
    pub config: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: u32,
    pub y: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Size {
    pub width: u32,
    pub height: u32,
}
