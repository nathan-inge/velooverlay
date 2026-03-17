// CLI rendering using tiny-skia (pure Rust 2D raster graphics).
//
// This module is intentionally minimal in Phase 0.
// Its job is to convert a TelemetryFrame + WidgetLayout into a PNG image buffer
// that gets piped to FFmpeg for compositing.
//
// The GUI uses an entirely separate rendering path (TypeScript + Canvas 2D),
// so this module is CLI-only and does not need to match the GUI pixel-perfectly.

pub mod layout;

// TODO: Implement widget renderers (speedometer, snake_map, metric_tile).
