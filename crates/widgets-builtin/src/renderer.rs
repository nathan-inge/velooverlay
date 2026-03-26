use fontdue::Font;
use tiny_skia::Pixmap;

use velo_core::model::TelemetryFrame;
use velo_core::render::layout::Layout;

use crate::dispatch;

/// CLI overlay renderer.
///
/// Owns a target resolution, an optional font, and an optional set of GPS
/// points from the full activity file (used by the snake-map widget when
/// `"full_track": true` is configured).
///
/// For each video frame, call [`render_frame`] to get a flat RGBA byte buffer
/// (straight alpha, un-premultiplied) ready to pipe to FFmpeg as `rawvideo`.
pub struct CliRenderer {
    pub width: u32,
    pub height: u32,
    font: Option<Font>,
    /// GPS points (lat, lon, altitude_m) from the full activity file.
    /// Empty when not provided — widgets will fall back to video-only frames.
    full_track_points: Vec<(f64, f64, Option<f32>)>,
    /// Raw (distanceM, altitudeM) pairs from TelemetrySession.points.
    /// Used by the gradient widget to match the GUI's sparse-sample regression.
    raw_route_points: Vec<(f32, f32)>,
}

impl CliRenderer {
    /// `full_track_points`: (lat, lon, altitude_m) triples from the complete
    /// `TelemetrySession`, pre-extracted before the video-sync step.
    /// Pass `vec![]` if unavailable.
    ///
    /// `raw_route_points`: (distanceM, altitudeM) pairs from `TelemetrySession.points`
    /// (only entries where both fields are `Some`). Pass `vec![]` if unavailable.
    pub fn new(
        width: u32,
        height: u32,
        font: Option<Font>,
        full_track_points: Vec<(f64, f64, Option<f32>)>,
        raw_route_points: Vec<(f32, f32)>,
    ) -> Self {
        Self {
            width,
            height,
            font,
            full_track_points,
            raw_route_points,
        }
    }

    /// Render one overlay frame.
    ///
    /// Returns `width * height * 4` bytes in straight RGBA order, suitable for
    /// FFmpeg `-pix_fmt rgba` rawvideo input.
    pub fn render_frame(
        &self,
        frame: &TelemetryFrame,
        all_frames: &[TelemetryFrame],
        layout: &Layout,
    ) -> Vec<u8> {
        let mut pixmap =
            Pixmap::new(self.width, self.height).expect("pixmap dimensions must be non-zero");

        for widget in &layout.widgets {
            dispatch::draw_widget(
                &mut pixmap,
                widget,
                frame,
                all_frames,
                &self.full_track_points,
                &self.raw_route_points,
                &layout.theme,
                self.font.as_ref(),
            );
        }

        unpremultiply_to_rgba(pixmap)
    }
}

// ---------------------------------------------------------------------------
// Pixel format conversion
// ---------------------------------------------------------------------------

/// Convert tiny-skia's premultiplied RGBA pixmap to straight RGBA bytes.
///
/// tiny-skia stores pixels as premultiplied (r*a, g*a, b*a, a).
/// FFmpeg's `rgba` pixel format expects straight (r, g, b, a).
fn unpremultiply_to_rgba(pixmap: Pixmap) -> Vec<u8> {
    let mut out = Vec::with_capacity((pixmap.width() * pixmap.height() * 4) as usize);

    for pixel in pixmap.pixels() {
        let a = pixel.alpha();
        if a == 0 {
            out.extend_from_slice(&[0, 0, 0, 0]);
        } else {
            let scale = 255.0 / a as f32;
            let r = ((pixel.red() as f32 * scale).round() as u32).min(255) as u8;
            let g = ((pixel.green() as f32 * scale).round() as u32).min(255) as u8;
            let b = ((pixel.blue() as f32 * scale).round() as u32).min(255) as u8;
            out.extend_from_slice(&[r, g, b, a]);
        }
    }

    out
}
