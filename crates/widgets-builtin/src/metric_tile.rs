use fontdue::Font;
use tiny_skia::{Paint, Pixmap, Rect, Transform};

use velo_core::model::{SignalStatus, TelemetryFrame};
use velo_core::render::layout::{Theme, WidgetInstance};

// ---------------------------------------------------------------------------
// Public widget entry points
// ---------------------------------------------------------------------------

pub fn draw_elevation(
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
        .unwrap_or("m");

    let (value_str, is_lost) = if frame.signal_status == SignalStatus::Lost {
        ("--".to_string(), true)
    } else if let Some(alt) = frame.data.altitude_m {
        let v = if unit == "ft" { alt * 3.28084 } else { alt };
        (format!("{}", v.round() as i32), false)
    } else {
        ("--".to_string(), true)
    };

    draw_metric_horizontal(pixmap, widget, &value_str, unit, is_lost, theme, font);
}

pub fn draw_gradient(
    pixmap: &mut Pixmap,
    widget: &WidgetInstance,
    frame: &TelemetryFrame,
    all_frames: &[TelemetryFrame],
    theme: &Theme,
    font: Option<&Font>,
) {
    let window_m = widget
        .config
        .get("windowM")
        .and_then(|v| v.as_f64())
        .unwrap_or(100.0) as f32;

    let (value_str, is_lost) = if frame.signal_status == SignalStatus::Lost {
        ("--".to_string(), true)
    } else {
        match compute_gradient(all_frames, frame.frame_index as usize, window_m) {
            Some(pct) => (format_pct(pct), false),
            None => ("--".to_string(), true),
        }
    };

    draw_metric_horizontal(pixmap, widget, &value_str, "%", is_lost, theme, font);
}

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

    let x = widget.position.x as f32;
    let y = widget.position.y as f32;
    let w = widget.size.width as f32;
    let h = widget.size.height as f32;

    draw_background(pixmap, x, y, w, h, theme.background_opacity);

    let Some(font) = font else { return };

    let primary = parse_hex_color(&theme.primary_color);

    if frame.signal_status == SignalStatus::Lost || frame.data.speed_ms.is_none() {
        // "NO SIGNAL" centred, rgba(255,255,255,0.4)
        let size = h * 0.2;
        let cy = y + h * 0.5 - size * 0.35;
        render_text_centered_shadowed(pixmap, font, "NO SIGNAL", x, w, cy, size, [255, 255, 255, 102]);
        return;
    }

    let speed = frame.data.speed_ms.unwrap_or(0.0);
    let speed_converted = if unit == "mph" { speed * 2.237 } else { speed * 3.6 };

    // Speed value: bold, height*0.5, centred at height*0.45
    let value_size = h * 0.5;
    let value_y = y + h * 0.45 - value_size * 0.35;
    render_text_centered_shadowed(
        pixmap, font, &format!("{:.1}", speed_converted),
        x, w, value_y, value_size, primary,
    );

    // Unit label: height*0.2, centred at height*0.78
    let unit_size = h * 0.2;
    let unit_y = y + h * 0.78 - unit_size * 0.35;
    render_text_centered_shadowed(
        pixmap, font, &unit.to_uppercase(),
        x, w, unit_y, unit_size, primary,
    );
}

pub fn draw_heart_rate(
    pixmap: &mut Pixmap,
    widget: &WidgetInstance,
    frame: &TelemetryFrame,
    theme: &Theme,
    font: Option<&Font>,
) {
    let value = if frame.signal_status == SignalStatus::Lost {
        None
    } else {
        frame.data.heart_rate.map(|v| v as f64)
    };
    draw_metric_centered(pixmap, widget, "HEART RATE", value, "BPM", theme, font);
}

pub fn draw_cadence(
    pixmap: &mut Pixmap,
    widget: &WidgetInstance,
    frame: &TelemetryFrame,
    theme: &Theme,
    font: Option<&Font>,
) {
    let value = if frame.signal_status == SignalStatus::Lost {
        None
    } else {
        frame.data.cadence.map(|v| v as f64)
    };
    draw_metric_centered(pixmap, widget, "CADENCE", value, "RPM", theme, font);
}

pub fn draw_power(
    pixmap: &mut Pixmap,
    widget: &WidgetInstance,
    frame: &TelemetryFrame,
    theme: &Theme,
    font: Option<&Font>,
) {
    let value = if frame.signal_status == SignalStatus::Lost {
        None
    } else {
        frame.data.power.map(|v| v as f64)
    };
    draw_metric_centered(pixmap, widget, "POWER", value, "W", theme, font);
}

// ---------------------------------------------------------------------------
// Centred 3-line metric tile: LABEL (top) / VALUE (centre) / UNIT (bottom)
// Used by HR, cadence, power.  Matches the TypeScript makeMetricTileWidget layout.
// ---------------------------------------------------------------------------

fn draw_metric_centered(
    pixmap: &mut Pixmap,
    widget: &WidgetInstance,
    label: &str,
    value: Option<f64>,   // None → lost signal ("--" + dimmed)
    unit: &str,
    theme: &Theme,
    font: Option<&Font>,
) {
    let x = widget.position.x as f32;
    let y = widget.position.y as f32;
    let w = widget.size.width as f32;
    let h = widget.size.height as f32;

    draw_background(pixmap, x, y, w, h, theme.background_opacity);

    let Some(font) = font else { return };

    let primary = parse_hex_color(&theme.primary_color);

    // Label: rgba(255,255,255,0.6), height*0.18, top aligned at height*0.08
    let label_size = h * 0.18;
    let label_y = y + h * 0.08;
    render_text_centered_shadowed(pixmap, font, label, x, w, label_y, label_size, [255, 255, 255, 153]);

    // Value: primary (or dim if lost), bold, height*0.42, middle at height*0.55
    let value_str = match value {
        Some(v) => format!("{}", v.round() as i64),
        None => "--".to_string(),
    };
    let value_color: [u8; 4] = if value.is_some() { primary } else { [255, 255, 255, 76] };
    let value_size = h * 0.42;
    let value_y = y + h * 0.55 - value_size * 0.35;
    render_text_centered_shadowed(pixmap, font, &value_str, x, w, value_y, value_size, value_color);

    // Unit: primary, height*0.16, bottom aligned at height*0.97
    let unit_size = h * 0.16;
    let unit_y = y + h * 0.97 - unit_size * 0.75;
    render_text_centered_shadowed(pixmap, font, unit, x, w, unit_y, unit_size, primary);
}

fn draw_background(pixmap: &mut Pixmap, x: f32, y: f32, w: f32, h: f32, opacity: f32) {
    let alpha = (opacity * 255.0).round() as u8;
    let mut paint = Paint::default();
    paint.set_color_rgba8(0, 0, 0, alpha);
    if let Some(rect) = Rect::from_xywh(x, y, w, h) {
        pixmap.fill_rect(rect, &paint, Transform::identity(), None);
    }
}

// ---------------------------------------------------------------------------
// Horizontal metric tile (elevation / gradient): value + unit side-by-side,
// both centred vertically and horizontally in the widget bounds.
// ---------------------------------------------------------------------------

fn draw_metric_horizontal(
    pixmap: &mut Pixmap,
    widget: &WidgetInstance,
    value_str: &str,
    unit_str: &str,
    is_lost: bool,
    theme: &Theme,
    font: Option<&Font>,
) {
    let x = widget.position.x as f32;
    let y = widget.position.y as f32;
    let w = widget.size.width as f32;
    let h = widget.size.height as f32;

    draw_background(pixmap, x, y, w, h, theme.background_opacity);

    let Some(font) = font else { return };

    let primary = parse_hex_color(&theme.primary_color);
    let value_color: [u8; 4] = if is_lost { [255, 255, 255, 76] } else { primary };

    let value_size = h * 0.55;
    let unit_size = h * 0.28;
    let gap = h * 0.06;

    let value_w = measure_text(font, value_str, value_size);
    let unit_w = measure_text(font, unit_str, unit_size);
    let start_x = x + (w - value_w - gap - unit_w) / 2.0;

    let mid_y = y + h / 2.0;
    let value_y = mid_y - value_size * 0.40;
    let unit_y = mid_y - unit_size * 0.40;

    // Shadow passes, then main passes.
    render_text(pixmap, font, value_str, start_x + 1.0, value_y + 1.0, value_size, [0, 0, 0, 180]);
    render_text(pixmap, font, unit_str, start_x + value_w + gap + 1.0, unit_y + 1.0, unit_size, [0, 0, 0, 180]);
    render_text(pixmap, font, value_str, start_x, value_y, value_size, value_color);
    render_text(pixmap, font, unit_str, start_x + value_w + gap, unit_y, unit_size, primary);
}

// ---------------------------------------------------------------------------
// Gradient calculation (ported from packages/widgets-builtin/src/metric-tile-gradient.ts)
// ---------------------------------------------------------------------------

/// Compute road gradient (%) from the interpolated frame history.
///
/// Uses a least-squares regression over `window_m` metres of history,
/// matching the TypeScript distance-based path.  Falls back to `None` when
/// there is insufficient history or when distance data is absent.
fn compute_gradient(all_frames: &[TelemetryFrame], current_idx: usize, window_m: f32) -> Option<f32> {
    if current_idx == 0 || all_frames.is_empty() {
        return None;
    }

    let current = &all_frames[current_idx];
    let current_dist = current.data.distance_m?;
    let current_alt = current.data.altitude_m?;

    const MIN_POINTS: usize = 20;

    // Collect (distance, altitude) pairs from frames *before* the current one.
    let before: Vec<(f32, f32)> = all_frames[..current_idx]
        .iter()
        .filter_map(|f| Some((f.data.distance_m?, f.data.altitude_m?)))
        .collect();

    if before.is_empty() {
        return None;
    }

    // Walk backwards until we have `window_m` metres AND `MIN_POINTS` samples.
    let mut start_idx = before.len() - 1;
    loop {
        let covered = current_dist - before[start_idx].0;
        let count = before.len() - start_idx + 1; // +1 for current frame
        if covered >= window_m && count >= MIN_POINTS {
            break;
        }
        if start_idx == 0 {
            break;
        }
        start_idx -= 1;
    }

    let window = &before[start_idx..];
    let span = current_dist - window[0].0;
    if window.len() < 4 || span < 10.0 {
        return None;
    }

    let start_dist = window[0].0;

    let mut xs: Vec<f32> = window.iter().map(|(d, _)| d - start_dist).collect();
    xs.push(current_dist - start_dist);

    let mut raw_ys: Vec<f32> = window.iter().map(|(_, a)| *a).collect();
    raw_ys.push(current_alt);

    let ys = box_filter(&raw_ys, 5);
    let slope = ls_slope(&xs, &ys)?;

    Some(slope * 100.0)
}

fn box_filter(arr: &[f32], k: usize) -> Vec<f32> {
    let half = k / 2;
    arr.iter()
        .enumerate()
        .map(|(i, _)| {
            let lo = i.saturating_sub(half);
            let hi = (i + half).min(arr.len() - 1);
            let sum: f32 = arr[lo..=hi].iter().sum();
            sum / (hi - lo + 1) as f32
        })
        .collect()
}

fn ls_slope(xs: &[f32], ys: &[f32]) -> Option<f32> {
    let n = xs.len() as f32;
    if n < 2.0 {
        return None;
    }
    let sum_x: f32 = xs.iter().sum();
    let sum_y: f32 = ys.iter().sum();
    let sum_xy: f32 = xs.iter().zip(ys.iter()).map(|(x, y)| x * y).sum();
    let sum_x2: f32 = xs.iter().map(|x| x * x).sum();
    let denom = n * sum_x2 - sum_x * sum_x;
    if denom.abs() < 1e-9 {
        None
    } else {
        Some((n * sum_xy - sum_x * sum_y) / denom)
    }
}

fn format_pct(pct: f32) -> String {
    let abs = pct.abs();
    if abs < 0.1 {
        "0.0".to_string()
    } else if pct > 0.0 {
        format!("+{:.1}", pct)
    } else {
        format!("{:.1}", pct)
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

/// Render `text` horizontally centred within [`widget_x`, `widget_x + widget_w`],
/// with a 1 px drop shadow, at the given vertical position.
fn render_text_centered_shadowed(
    pixmap: &mut Pixmap,
    font: &Font,
    text: &str,
    widget_x: f32,
    widget_w: f32,
    y: f32,
    size: f32,
    color: [u8; 4],
) {
    let text_w = measure_text(font, text, size);
    let x = widget_x + (widget_w - text_w) / 2.0;
    // Shadow pass
    render_text(pixmap, font, text, x + 1.0, y + 1.0, size, [0, 0, 0, 180]);
    // Main pass
    render_text(pixmap, font, text, x, y, size, color);
}

/// Measure the rendered width of `text` at `size` px using fontdue layout.
fn measure_text(font: &Font, text: &str, size: f32) -> f32 {
    use fontdue::layout::{CoordinateSystem, Layout, LayoutSettings, TextStyle};

    let mut layout: Layout<()> = Layout::new(CoordinateSystem::PositiveYDown);
    layout.reset(&LayoutSettings {
        x: 0.0,
        y: 0.0,
        ..LayoutSettings::default()
    });
    layout.append(&[font], &TextStyle::new(text, size, 0));

    layout
        .glyphs()
        .iter()
        .map(|g| g.x + g.width as f32)
        .fold(0.0_f32, f32::max)
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
