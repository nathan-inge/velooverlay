use fontdue::Font;
use tiny_skia::{Paint, Pixmap, Rect, Transform};

use velo_core::model::TelemetryFrame;
use velo_core::render::layout::{Theme, WidgetInstance};

use crate::{elevation_profile, metric_tile, snake_map};

pub fn draw_widget(
    pixmap: &mut Pixmap,
    widget: &WidgetInstance,
    frame: &TelemetryFrame,
    all_frames: &[TelemetryFrame],
    full_track_points: &[(f64, f64, Option<f32>)],
    theme: &Theme,
    font: Option<&Font>,
) {
    match widget.widget_type.as_str() {
        "builtin:speedometer" => {
            metric_tile::draw_speedometer(pixmap, widget, frame, theme, font)
        }
        "builtin:heart-rate" => metric_tile::draw_heart_rate(pixmap, widget, frame, theme, font),
        "builtin:cadence" => metric_tile::draw_cadence(pixmap, widget, frame, theme, font),
        "builtin:power" => metric_tile::draw_power(pixmap, widget, frame, theme, font),
        "builtin:snake-map" => {
            snake_map::draw(pixmap, widget, frame, all_frames, full_track_points, theme)
        }
        "builtin:elevation-profile" => {
            elevation_profile::draw(pixmap, widget, frame, all_frames, full_track_points, theme)
        }
        "builtin:elevation" => {
            metric_tile::draw_elevation(pixmap, widget, frame, theme, font)
        }
        "builtin:gradient" => {
            metric_tile::draw_gradient(pixmap, widget, frame, all_frames, theme, font)
        }
        _ => draw_unknown_placeholder(pixmap, widget),
    }
}

/// Red translucent box so unknown widget types are visually obvious during development.
fn draw_unknown_placeholder(pixmap: &mut Pixmap, widget: &WidgetInstance) {
    let mut paint = Paint::default();
    paint.set_color_rgba8(200, 50, 50, 160);
    if let Some(rect) = Rect::from_xywh(
        widget.position.x as f32,
        widget.position.y as f32,
        widget.size.width as f32,
        widget.size.height as f32,
    ) {
        pixmap.fill_rect(rect, &paint, Transform::identity(), None);
    }
}
