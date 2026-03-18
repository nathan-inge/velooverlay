// widgets-builtin: Rust CLI implementations of all built-in VeloOverlay widgets.
//
// Mirrors packages/widgets-builtin (TypeScript/Canvas 2D) for the CLI rendering
// path. Uses tiny-skia for 2D raster drawing and fontdue for text.
//
// Consumers (velo-cli) use CliRenderer as the entry point; the individual widget
// modules are internal implementation details.

pub mod font;
pub mod renderer;

mod dispatch;
mod elevation_profile;
mod metric_tile;
mod snake_map;
