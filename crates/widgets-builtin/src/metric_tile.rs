use fontdue::Font;
use tiny_skia::{Paint, Pixmap, Rect, Transform};

use velo_core::model::{SignalStatus, TelemetryFrame};
use velo_core::render::layout::{Theme, WidgetInstance};

// ---------------------------------------------------------------------------
// Public widget entry points
// ---------------------------------------------------------------------------

pub fn draw_speedometer(
    pixmap: &mut Pixmap,
    widget: &WidgetInstance,
    frame: &TelemetryFrame,
    theme: &Theme,
    font: Option<&Font>,
) {
    let unit = widget
        .config
        .get("unit")
        .and_then(|v| v.as_str())
        .unwrap_or("kph");

    let value = if frame.signal_status == SignalStatus::Lost {
        format!("-- {}", unit.to_uppercase())
    } else {
        let speed = frame.data.speed_ms.map(|s| {
            if unit == "mph" {
                s * 2.237_f32
            } else {
                s * 3.6_f32
            }
        });
        format!("{:.1} {}", speed.unwrap_or(0.0), unit.to_uppercase())
    };

    draw_metric(pixmap, widget, "SPEED", &value, theme, font);
}

pub fn draw_heart_rate(
    pixmap: &mut Pixmap,
    widget: &WidgetInstance,
    frame: &TelemetryFrame,
    theme: &Theme,
    font: Option<&Font>,
) {
    let value = if frame.signal_status == SignalStatus::Lost {
        "-- BPM".to_string()
    } else {
        format!("{} BPM", frame.data.heart_rate.unwrap_or(0))
    };
    draw_metric(pixmap, widget, "HR", &value, theme, font);
}

pub fn draw_cadence(
    pixmap: &mut Pixmap,
    widget: &WidgetInstance,
    frame: &TelemetryFrame,
    theme: &Theme,
    font: Option<&Font>,
) {
    let value = if frame.signal_status == SignalStatus::Lost {
        "-- RPM".to_string()
    } else {
        format!("{} RPM", frame.data.cadence.unwrap_or(0))
    };
    draw_metric(pixmap, widget, "CADENCE", &value, theme, font);
}

pub fn draw_power(
    pixmap: &mut Pixmap,
    widget: &WidgetInstance,
    frame: &TelemetryFrame,
    theme: &Theme,
    font: Option<&Font>,
) {
    let value = if frame.signal_status == SignalStatus::Lost {
        "-- W".to_string()
    } else {
        format!("{} W", frame.data.power.unwrap_or(0))
    };
    draw_metric(pixmap, widget, "POWER", &value, theme, font);
}

// ---------------------------------------------------------------------------
// Generic metric tile
// ---------------------------------------------------------------------------

fn draw_metric(
    pixmap: &mut Pixmap,
    widget: &WidgetInstance,
    label: &str,
    value: &str,
    theme: &Theme,
    font: Option<&Font>,
) {
    let x = widget.position.x as f32;
    let y = widget.position.y as f32;
    let w = widget.size.width as f32;
    let h = widget.size.height as f32;

    let bg_alpha = (theme.background_opacity * 255.0).round() as u8;
    let mut bg_paint = Paint::default();
    bg_paint.set_color_rgba8(0, 0, 0, bg_alpha);
    if let Some(rect) = Rect::from_xywh(x, y, w, h) {
        pixmap.fill_rect(rect, &bg_paint, Transform::identity(), None);
    }

    if let Some(font) = font {
        let primary = parse_hex_color(&theme.primary_color);
        render_text(pixmap, font, label, x + 8.0, y + 8.0, 14.0, [200, 200, 200, 255]);
        render_text(pixmap, font, value, x + 8.0, y + h * 0.35, 28.0, primary);
    }
}

// ---------------------------------------------------------------------------
// Text rendering via fontdue
// ---------------------------------------------------------------------------

fn render_text(
    pixmap: &mut Pixmap,
    font: &Font,
    text: &str,
    x: f32,
    y: f32,
    size: f32,
    color: [u8; 4],
) {
    use fontdue::layout::{CoordinateSystem, Layout, LayoutSettings, TextStyle};

    let mut layout: Layout<()> = Layout::new(CoordinateSystem::PositiveYDown);
    layout.reset(&LayoutSettings {
        x,
        y,
        ..LayoutSettings::default()
    });
    layout.append(&[font], &TextStyle::new(text, size, 0));

    let pw = pixmap.width() as i32;
    let ph = pixmap.height() as i32;

    for glyph in layout.glyphs() {
        if glyph.char_data.is_whitespace() {
            continue;
        }
        let (metrics, bitmap) = font.rasterize_config(glyph.key);
        if bitmap.is_empty() {
            continue;
        }
        let gx = glyph.x as i32;
        let gy = glyph.y as i32;
        let bw = metrics.width as i32;

        for (i, &coverage) in bitmap.iter().enumerate() {
            if coverage == 0 {
                continue;
            }
            let px = gx + (i as i32 % bw);
            let py = gy + (i as i32 / bw);
            if px < 0 || py < 0 || px >= pw || py >= ph {
                continue;
            }
            blend_pixel(pixmap, px as u32, py as u32, color, coverage);
        }
    }
}

/// Premultiplied src-over composite of a single font pixel onto the pixmap.
fn blend_pixel(pixmap: &mut Pixmap, x: u32, y: u32, color: [u8; 4], coverage: u8) {
    let idx = ((y * pixmap.width() + x) * 4) as usize;
    let data = pixmap.data_mut();

    let src_a = ((color[3] as u32 * coverage as u32) / 255) as u8;
    let src_r = ((color[0] as u32 * src_a as u32) / 255) as u8;
    let src_g = ((color[1] as u32 * src_a as u32) / 255) as u8;
    let src_b = ((color[2] as u32 * src_a as u32) / 255) as u8;

    let inv = 255u32 - src_a as u32;
    data[idx] = (src_r as u32 + (data[idx] as u32 * inv / 255)) as u8;
    data[idx + 1] = (src_g as u32 + (data[idx + 1] as u32 * inv / 255)) as u8;
    data[idx + 2] = (src_b as u32 + (data[idx + 2] as u32 * inv / 255)) as u8;
    data[idx + 3] = (src_a as u32 + (data[idx + 3] as u32 * inv / 255)) as u8;
}

// ---------------------------------------------------------------------------
// Utility (shared with snake_map)
// ---------------------------------------------------------------------------

/// Parse "#RRGGBB" → `[r, g, b, 255]`. Defaults to green on invalid input.
pub(crate) fn parse_hex_color(hex: &str) -> [u8; 4] {
    let hex = hex.trim_start_matches('#');
    if hex.len() >= 6 {
        let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
        let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(255);
        let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
        [r, g, b, 255]
    } else {
        [0, 255, 0, 255]
    }
}
