// velo-core: The data pipeline library.
//
// Module declarations tell Rust to look for `src/<name>.rs` or `src/<name>/mod.rs`.
// `pub mod` makes the module visible to code outside this crate.
pub mod error;
pub mod model;
pub mod parser;
pub mod sync;
pub mod interpolation;
pub mod pipeline;
pub mod render;

// Re-export the most commonly used types at the crate root so consumers
// can write `use velo_core::TelemetrySession` instead of
// `use velo_core::model::TelemetrySession`.
pub use model::{SignalStatus, TelemetryFrame, TelemetryPoint, TelemetrySession};
pub use pipeline::Pipeline;
