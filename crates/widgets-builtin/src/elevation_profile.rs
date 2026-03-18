use tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Rect, Stroke, Transform};

use velo_core::model::TelemetryFrame;
use velo_core::render::layout::{Theme, WidgetInstance};

use crate::metric_tile::parse_hex_color;

/// Draw the elevation-profile widget.
///
/// Renders a filled area chart of altitude over the course of the activity,
/// with the ridden portion highlighted and a marker at the current position.
///
/// ## Widget config options
///
/// | Key           | Type | Default | Description |
/// |---------------|------|---------|-------------|
/// | `full_track`  | bool | `false` | When `true`, the profile is derived from the **full activity file** (passed via `full_track_points`). When `false` (default), only the video-aligned frames are used. |
///
/// ### Example layout.json snippet
/// ```json
/// {
///   "type": "builtin:elevation-profile",
///   "config": { "full_track": true }
/// }
/// ```
pub fn draw(
    pixmap: &mut Pixmap,
    widget: &WidgetInstance,
    frame: &TelemetryFrame,
    all_frames: &[TelemetryFrame],
    // (lat, lon, altitude_m) triples from the complete activity file.
    // Empty when not supplied by the caller.
    full_track_points: &[(f64, f64, Option<f32>)],
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

    draw_background(pixmap, wx, wy, ww, wh, theme.background_opacity);

    let primary = parse_hex_color(&theme.primary_color);

    if use_full_track {
        draw_full_track(
            pixmap,
            wx,
            wy,
            ww,
            wh,
            frame,
            full_track_points,
            primary,
        );
    } else {
        draw_video_frames(pixmap, wx, wy, ww, wh, frame, all_frames, primary);
    }
}

// ---------------------------------------------------------------------------
// Full-track mode (uses full_track_points)
// ---------------------------------------------------------------------------

fn draw_full_track(
    pixmap: &mut Pixmap,
    wx: f32,
    wy: f32,
    ww: f32,
    wh: f32,
    frame: &TelemetryFrame,
    full_track_points: &[(f64, f64, Option<f32>)],
    primary: [u8; 4],
) {
    // Collect (index, altitude) for all points that have altitude data.
    let alts: Vec<Option<f32>> = full_track_points.iter().map(|(_, _, a)| *a).collect();
    let n = alts.len();

    let valid: Vec<f32> = alts.iter().filter_map(|a| *a).collect();
    if valid.len() < 2 {
        return;
    }

    let (alt_min, alt_max) = min_max(&valid);
    let alt_span = alt_max - alt_min;
    if alt_span < 0.1 {
        return;
    }

    let (off_x, off_y, draw_w, draw_h) = padded_area(wx, wy, ww, wh, 0.08);
    let base_y = off_y + draw_h;

    let project_x = |idx: usize| -> f32 { off_x + (idx as f32 / (n - 1) as f32) * draw_w };
    let project_y =
        |alt: f32| -> f32 { off_y + draw_h * (1.0 - (alt - alt_min) / alt_span) };

    // Find current index by nearest GPS position.
    let current_idx =
        if let (Some(lat), Some(lon)) = (frame.data.lat, frame.data.lon) {
            find_closest_index(full_track_points.iter().map(|&(la, lo, _)| (la, lo)), lat, lon)
        } else {
            0
        };

    let ghost = ghost_color(primary);

    // Ghost: full profile (low opacity)
    draw_elevation_fill(pixmap, &alts, 0, n - 1, &project_x, &project_y, base_y, ghost, ghost, 1.5);

    // Progress: 0 to current_idx (solid)
    if current_idx > 0 {
        draw_elevation_fill(
            pixmap,
            &alts,
            0,
            current_idx,
            &project_x,
            &project_y,
            base_y,
            progress_fill(primary),
            primary,
            2.0,
        );
    }

    // Current position marker
    let cx = project_x(current_idx);
    draw_vertical_line(pixmap, cx, off_y, base_y, [255, 255, 255, 180], 1.5);

    if let Some(Some(alt)) = alts.get(current_idx) {
        let cy = project_y(*alt);
        draw_circle(pixmap, cx, cy, 5.0, primary);
    }
}

// ---------------------------------------------------------------------------
// Video-frames mode (uses all_frames)
// ---------------------------------------------------------------------------

fn draw_video_frames(
    pixmap: &mut Pixmap,
    wx: f32,
    wy: f32,
    ww: f32,
    wh: f32,
    frame: &TelemetryFrame,
    all_frames: &[TelemetryFrame],
    primary: [u8; 4],
) {
    let n = all_frames.len();
    if n < 2 {
        return;
    }

    let alts: Vec<Option<f32>> = all_frames.iter().map(|f| f.data.altitude_m).collect();

    let valid: Vec<f32> = alts.iter().filter_map(|a| *a).collect();
    if valid.len() < 2 {
        return;
    }

    let (alt_min, alt_max) = min_max(&valid);
    let alt_span = alt_max - alt_min;
    if alt_span < 0.1 {
        return;
    }

    let (off_x, off_y, draw_w, draw_h) = padded_area(wx, wy, ww, wh, 0.08);
    let base_y = off_y + draw_h;

    let project_x = |idx: usize| -> f32 { off_x + (idx as f32 / (n - 1) as f32) * draw_w };
    let project_y =
        |alt: f32| -> f32 { off_y + draw_h * (1.0 - (alt - alt_min) / alt_span) };

    let current_idx = (frame.frame_index as usize).min(n - 1);

    let ghost = ghost_color(primary);

    // Ghost: full profile
    draw_elevation_fill(pixmap, &alts, 0, n - 1, &project_x, &project_y, base_y, ghost, ghost, 1.5);

    // Progress: 0 to current_idx
    if current_idx > 0 {
        draw_elevation_fill(
            pixmap,
            &alts,
            0,
            current_idx,
            &project_x,
            &project_y,
            base_y,
            progress_fill(primary),
            primary,
            2.0,
        );
    }

    // Current position marker
    let cx = project_x(current_idx);
    draw_vertical_line(pixmap, cx, off_y, base_y, [255, 255, 255, 180], 1.5);

    if let Some(Some(alt)) = alts.get(current_idx) {
        let cy = project_y(*alt);
        draw_circle(pixmap, cx, cy, 5.0, primary);
    }
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

/// Draw a filled elevation area from index 0..=to_idx, skipping None altitudes.
fn draw_elevation_fill(
    pixmap: &mut Pixmap,
    alts: &[Option<f32>],
    from_idx: usize,
    to_idx: usize,
    project_x: &impl Fn(usize) -> f32,
    project_y: &impl Fn(f32) -> f32,
    base_y: f32,
    fill_color: [u8; 4],
    stroke_color: [u8; 4],
    stroke_width: f32,
) {
    let range = &alts[from_idx..=to_idx];
    // Collect valid (absolute_index, altitude) pairs.
    let pts: Vec<(usize, f32)> = range
        .iter()
        .enumerate()
        .filter_map(|(i, a)| Some((from_idx + i, (*a)?)))
        .collect();

    if pts.len() < 2 {
        return;
    }

    let first_x = project_x(pts[0].0);
    let last_x = project_x(pts[pts.len() - 1].0);

    // --- Filled polygon ---
    let mut fill_builder = PathBuilder::new();
    fill_builder.move_to(first_x, base_y);
    for &(idx, alt) in &pts {
        fill_builder.line_to(project_x(idx), project_y(alt));
    }
    fill_builder.line_to(last_x, base_y);
    fill_builder.close();

    if let Some(path) = fill_builder.finish() {
        let mut paint = Paint::default();
        paint.set_color_rgba8(fill_color[0], fill_color[1], fill_color[2], fill_color[3]);
        paint.anti_alias = true;
        pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
    }

    // --- Top-edge stroke ---
    let mut stroke_builder = PathBuilder::new();
    let mut pen_down = false;
    for &(idx, alt) in &pts {
        let px = project_x(idx);
        let py = project_y(alt);
        if pen_down {
            stroke_builder.line_to(px, py);
        } else {
            stroke_builder.move_to(px, py);
            pen_down = true;
        }
    }

    if let Some(path) = stroke_builder.finish() {
        let mut paint = Paint::default();
        paint.set_color_rgba8(
            stroke_color[0],
            stroke_color[1],
            stroke_color[2],
            stroke_color[3],
        );
        paint.anti_alias = true;
        let stroke = Stroke {
            width: stroke_width,
            ..Stroke::default()
        };
        pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
    }
}

fn draw_vertical_line(
    pixmap: &mut Pixmap,
    x: f32,
    y_top: f32,
    y_bottom: f32,
    color: [u8; 4],
    stroke_width: f32,
) {
    let mut builder = PathBuilder::new();
    builder.move_to(x, y_top);
    builder.line_to(x, y_bottom);
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

fn draw_background(pixmap: &mut Pixmap, x: f32, y: f32, w: f32, h: f32, opacity: f32) {
    let alpha = (opacity * 255.0).round() as u8;
    let mut paint = Paint::default();
    paint.set_color_rgba8(0, 0, 0, alpha);
    if let Some(rect) = Rect::from_xywh(x, y, w, h) {
        pixmap.fill_rect(rect, &paint, Transform::identity(), None);
    }
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
    pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

fn padded_area(wx: f32, wy: f32, ww: f32, wh: f32, pad: f32) -> (f32, f32, f32, f32) {
    let draw_w = ww * (1.0 - 2.0 * pad);
    let draw_h = wh * (1.0 - 2.0 * pad);
    let off_x = wx + ww * pad;
    let off_y = wy + wh * pad;
    (off_x, off_y, draw_w, draw_h)
}

fn min_max(values: &[f32]) -> (f32, f32) {
    let mn = values.iter().copied().fold(f32::MAX, f32::min);
    let mx = values.iter().copied().fold(f32::MIN, f32::max);
    (mn, mx)
}

/// Ghost color: primary at ~20% opacity.
fn ghost_color(primary: [u8; 4]) -> [u8; 4] {
    [primary[0], primary[1], primary[2], primary[3] / 5]
}

/// Progress fill color: primary at ~35% opacity.
fn progress_fill(primary: [u8; 4]) -> [u8; 4] {
    [primary[0], primary[1], primary[2], primary[3] * 9 / 25]
}

/// Return the index of the (lat, lon) pair closest to (current_lat, current_lon).
fn find_closest_index(
    coords: impl Iterator<Item = (f64, f64)>,
    current_lat: f64,
    current_lon: f64,
) -> usize {
    let mut closest = 0;
    let mut min_dist = f64::MAX;
    for (i, (lat, lon)) in coords.enumerate() {
        let dlat = lat - current_lat;
        let dlon = lon - current_lon;
        let dist = dlat * dlat + dlon * dlon;
        if dist < min_dist {
            min_dist = dist;
            closest = i;
        }
    }
    closest
}
