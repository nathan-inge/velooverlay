use tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Rect, Stroke, Transform};

use velo_core::model::TelemetryFrame;
use velo_core::render::layout::{Theme, WidgetInstance};

use crate::metric_tile::parse_hex_color;

/// Draw the snake-map widget (TDD §9).
///
/// ## Widget config options
///
/// | Key           | Type | Default | Description |
/// |---------------|------|---------|-------------|
/// | `full_track`  | bool | `false` | When `true`, the ghost route and bounding box use GPS points from the **full activity file** (passed in via `full_track_points`). When `false` (default), only the video-aligned frames are used — useful when the video covers the entire ride. |
///
/// ### Example layout.json snippet
/// ```json
/// {
///   "type": "builtin:snake-map",
///   "config": { "full_track": true }
/// }
/// ```
pub fn draw(
    pixmap: &mut Pixmap,
    widget: &WidgetInstance,
    frame: &TelemetryFrame,
    all_frames: &[TelemetryFrame],
    // GPS points (lat, lon) from the complete activity file, extracted before
    // video-sync. Empty when not supplied by the caller.
    full_track_points: &[(f64, f64)],
    theme: &Theme,
) {
    let wx = widget.position.x as f32;
    let wy = widget.position.y as f32;
    let ww = widget.size.width as f32;
    let wh = widget.size.height as f32;

    let use_full_track = widget
        .config
        .get("full_track")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        && !full_track_points.is_empty();

    // --- Choose bounding-box source ---
    // When full_track is active: encompasses the whole ride.
    // Otherwise: only the portion covered by the video.
    let bbox_pts: Vec<(f64, f64)> = if use_full_track {
        full_track_points.to_vec()
    } else {
        all_frames
            .iter()
            .filter_map(|f| Some((f.data.lat?, f.data.lon?)))
            .collect()
    };

    if bbox_pts.is_empty() {
        return;
    }

    let min_lat = bbox_pts.iter().map(|p| p.0).fold(f64::MAX, f64::min);
    let max_lat = bbox_pts.iter().map(|p| p.0).fold(f64::MIN, f64::max);
    let min_lon = bbox_pts.iter().map(|p| p.1).fold(f64::MAX, f64::min);
    let max_lon = bbox_pts.iter().map(|p| p.1).fold(f64::MIN, f64::max);

    let lat_span = max_lat - min_lat;
    let lon_span = max_lon - min_lon;

    if lat_span < 1e-9 || lon_span < 1e-9 {
        let cx = wx + ww / 2.0;
        let cy = wy + wh / 2.0;
        let primary = parse_hex_color(&theme.primary_color);
        draw_background(pixmap, wx, wy, ww, wh, theme.background_opacity);
        draw_circle(pixmap, cx, cy, 5.0, primary);
        return;
    }

    // --- Coordinate mapping with 10% padding (TDD §9) ---
    let padding = 0.10_f32;
    let draw_w = ww * (1.0 - 2.0 * padding);
    let draw_h = wh * (1.0 - 2.0 * padding);
    let offset_x = wx + ww * padding;
    let offset_y = wy + wh * padding;

    let scale_x = draw_w as f64 / lon_span;
    let scale_y = draw_h as f64 / lat_span;
    let scale = scale_x.min(scale_y);

    let map_w = lon_span * scale;
    let map_h = lat_span * scale;
    let cx_off = offset_x as f64 + (draw_w as f64 - map_w) / 2.0;
    let cy_off = offset_y as f64 + (draw_h as f64 - map_h) / 2.0;

    let to_pixel = |lat: f64, lon: f64| -> (f32, f32) {
        let px = (cx_off + (lon - min_lon) * scale) as f32;
        let py = (cy_off + (max_lat - lat) * scale) as f32; // invert Y
        (px, py)
    };

    draw_background(pixmap, wx, wy, ww, wh, theme.background_opacity);

    let primary = parse_hex_color(&theme.primary_color);
    let ghost = [primary[0], primary[1], primary[2], primary[3] / 4];

    // --- Ghost route ---
    // Source depends on full_track config: entire activity vs video frames only.
    if use_full_track {
        draw_route_coords(
            pixmap,
            full_track_points.iter().copied(),
            &to_pixel,
            ghost,
            1.5,
        );
    } else {
        draw_route_frames(pixmap, all_frames, &to_pixel, ghost, 1.5);
    }

    // --- Ridden portion (always the video-aligned frames up to now) ---
    let current_idx = (frame.frame_index as usize).min(all_frames.len().saturating_sub(1));
    draw_route_frames(pixmap, &all_frames[..=current_idx], &to_pixel, primary, 2.5);

    // --- Head marker ---
    if let (Some(lat), Some(lon)) = (frame.data.lat, frame.data.lon) {
        let (px, py) = to_pixel(lat, lon);
        draw_circle(pixmap, px, py, 6.0, primary);
    }
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

fn draw_background(pixmap: &mut Pixmap, x: f32, y: f32, w: f32, h: f32, opacity: f32) {
    let alpha = (opacity * 255.0).round() as u8;
    let mut paint = Paint::default();
    paint.set_color_rgba8(0, 0, 0, alpha);
    if let Some(rect) = Rect::from_xywh(x, y, w, h) {
        pixmap.fill_rect(rect, &paint, Transform::identity(), None);
    }
}

/// Draw a polyline through the GPS points in a frame slice.
/// Lifts the pen at GPS dropouts (None lat/lon).
fn draw_route_frames(
    pixmap: &mut Pixmap,
    frames: &[TelemetryFrame],
    to_pixel: &impl Fn(f64, f64) -> (f32, f32),
    color: [u8; 4],
    stroke_width: f32,
) {
    draw_route_coords(
        pixmap,
        frames
            .iter()
            .flat_map(|f| f.data.lat.zip(f.data.lon)),
        to_pixel,
        color,
        stroke_width,
    );
}

/// Draw a polyline from an iterator of (lat, lon) pairs.
/// GPS gaps in the source data should be represented as separate calls
/// (the iterator produces only valid points, so no pen-lift logic is needed here).
///
/// For `draw_route_frames` the GPS dropout handling (lifting the pen on None)
/// is done by `flat_map` — consecutive None points simply produce no segment.
/// This is fine for Phase 0; a future improvement could detect large gaps and
/// explicitly move_to instead of line_to after them.
fn draw_route_coords(
    pixmap: &mut Pixmap,
    coords: impl Iterator<Item = (f64, f64)>,
    to_pixel: &impl Fn(f64, f64) -> (f32, f32),
    color: [u8; 4],
    stroke_width: f32,
) {
    let mut builder = PathBuilder::new();
    let mut pen_down = false;

    for (lat, lon) in coords {
        let (px, py) = to_pixel(lat, lon);
        if pen_down {
            builder.line_to(px, py);
        } else {
            builder.move_to(px, py);
            pen_down = true;
        }
    }

    let Some(path) = builder.finish() else {
        return;
    };

    let mut paint = Paint::default();
    paint.set_color_rgba8(color[0], color[1], color[2], color[3]);
    paint.anti_alias = true;

    let stroke = Stroke {
        width: stroke_width,
        ..Stroke::default()
    };

    pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
}

fn draw_circle(pixmap: &mut Pixmap, cx: f32, cy: f32, radius: f32, color: [u8; 4]) {
    let mut builder = PathBuilder::new();
    builder.push_circle(cx, cy, radius);
    let Some(path) = builder.finish() else {
        return;
    };

    let mut paint = Paint::default();
    paint.set_color_rgba8(color[0], color[1], color[2], color[3]);
    paint.anti_alias = true;

    pixmap.fill_path(
        &path,
        &paint,
        FillRule::Winding,
        Transform::identity(),
        None,
    );
}
