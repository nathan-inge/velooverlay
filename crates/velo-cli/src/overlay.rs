// This module is intentionally empty.
//
// The CLI renderer has been migrated to the tiny-skia + FFmpeg pipe approach
// described in TDD §5.3–5.4. Widget rendering lives in velo_core::render.
// The render command in main.rs calls CliRenderer directly and pipes raw RGBA
// frames to FFmpeg — no intermediate subtitle file is generated.
