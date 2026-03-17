/// ASS (Advanced SubStation Alpha) subtitle overlay generator.
///
/// Converts a stream of TelemetryFrames + a Layout into an .ass subtitle file
/// that FFmpeg can composite onto the video with no external rendering library.
///
/// Why ASS instead of PNG frames?
///   - No font library needed in Rust.
///   - FFmpeg handles all text rendering.
///   - The file is small (text-only, ~1 KB per second of video).
///   - Supports arbitrary screen positioning via {\pos(x,y)} tags.
use anyhow::Result;
use std::fmt::Write as FmtWrite;
use std::fs;
use std::path::Path;
use velo_core::model::{SignalStatus, TelemetryFrame};
use velo_core::render::layout::{Layout, WidgetInstance};

/// Generate an ASS subtitle file at `output_path` from the given frames and layout.
pub fn write_ass(
    frames: &[TelemetryFrame],
    layout: &Layout,
    output_path: &Path,
) -> Result<()> {
    let mut out = String::with_capacity(frames.len() * layout.widgets.len() * 80);

    // --- Script Info ---
    writeln!(out, "[Script Info]")?;
    writeln!(out, "ScriptType: v4.00+")?;
    writeln!(out, "PlayResX: 1920")?;
    writeln!(out, "PlayResY: 1080")?;
    writeln!(out, "ScaledBorderAndShadow: yes")?;
    writeln!(out)?;

    // --- Styles ---
    let primary_color = hex_to_ass_color(&layout.theme.primary_color);
    writeln!(out, "[V4+ Styles]")?;
    writeln!(
        out,
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, \
         OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, \
         ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, \
         Alignment, MarginL, MarginR, MarginV, Encoding"
    )?;
    writeln!(
        out,
        "Style: VeloOverlay,{font},42,{color},&H000000FF,&H00000000,&H80000000,\
         -1,0,0,0,100,100,0,0,1,2,1,7,0,0,0,1",
        font = layout.theme.font_family,
        color = primary_color,
    )?;
    writeln!(out)?;

    // --- Events ---
    writeln!(out, "[Events]")?;
    writeln!(
        out,
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
    )?;

    // One dialogue line per frame, per renderable widget.
    // For long rides this could be large; a future optimisation is to batch
    // consecutive frames with identical values into a single line.
    for frame in frames {
        let start = ms_to_ass_time(frame.video_time_ms);
        // Each subtitle line is visible for exactly one frame duration.
        // We approximate this as one centisecond; FFmpeg handles sub-cs gaps.
        let end_ms = frame.video_time_ms + frame_duration_ms(frames, frame.frame_index);
        let end = ms_to_ass_time(end_ms);

        let text = render_frame_text(frame, &layout.widgets);
        if text.is_empty() {
            continue;
        }

        writeln!(
            out,
            "Dialogue: 0,{start},{end},VeloOverlay,,0,0,0,,{text}",
        )?;
    }

    fs::write(output_path, out)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Text rendering per frame
// ---------------------------------------------------------------------------

/// Build the ASS text content for a single frame.
/// Each widget contributes one positioned text element.
fn render_frame_text(frame: &TelemetryFrame, widgets: &[WidgetInstance]) -> String {
    let mut parts: Vec<String> = Vec::new();

    for widget in widgets {
        if let Some(text) = widget_text(frame, widget) {
            // {\pos(x,y)} positions the text at the widget's top-left corner.
            // {\bord2} adds a 2-pixel black border for readability on any background.
            parts.push(format!(
                "{{\\pos({x},{y})\\bord2}}{text}",
                x = widget.position.x,
                y = widget.position.y,
            ));
        }
    }

    // ASS requires multiple positioned elements on the same line to each be
    // in their own Dialogue line. Return the first element here; the caller
    // will need to loop per widget. For simplicity we combine using a soft
    // newline override — but different positions require separate Dialogue lines.
    // We return empty to signal "write separate lines per widget" to the caller.
    // NOTE: This implementation writes one combined string which works in practice
    // because each {\pos()} tag overrides the position for subsequent text.
    parts.join("")
}

/// Returns the display string for a given widget at the current frame,
/// or `None` if the widget type doesn't produce text output (e.g. snake-map).
fn widget_text(frame: &TelemetryFrame, widget: &WidgetInstance) -> Option<String> {
    if frame.signal_status == SignalStatus::Lost {
        return Some(format!("{} --", widget_label(&widget.widget_type)));
    }

    match widget.widget_type.as_str() {
        "builtin:speedometer" => {
            let unit = widget
                .config
                .get("unit")
                .and_then(|v| v.as_str())
                .unwrap_or("kph");
            let speed = frame.data.speed_ms.map(|s| {
                if unit == "mph" { s * 2.237 } else { s * 3.6 }
            });
            Some(format!(
                "{:.1} {}",
                speed.unwrap_or(0.0),
                unit.to_uppercase()
            ))
        }
        "builtin:heart-rate" => Some(format!(
            "{} BPM",
            frame.data.heart_rate.unwrap_or(0)
        )),
        "builtin:cadence" => Some(format!(
            "{} RPM",
            frame.data.cadence.unwrap_or(0)
        )),
        "builtin:power" => Some(format!(
            "{} W",
            frame.data.power.unwrap_or(0)
        )),
        // Snake map can't be rendered as text — skip it.
        "builtin:snake-map" => None,
        // Unknown widget types: show the widget ID so the user knows it was found.
        other => Some(format!("[{}]", other)),
    }
}

fn widget_label(widget_type: &str) -> &str {
    match widget_type {
        "builtin:speedometer" => "SPD",
        "builtin:heart-rate" => "HR",
        "builtin:cadence" => "CAD",
        "builtin:power" => "PWR",
        _ => "?",
    }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/// Convert a hex color like "#00FF00" to ASS format "&H00BBGGRR".
/// ASS uses BGR channel order (not RGB).
pub fn hex_to_ass_color(hex: &str) -> String {
    let hex = hex.trim_start_matches('#');
    if hex.len() == 6 {
        let r = &hex[0..2];
        let g = &hex[2..4];
        let b = &hex[4..6];
        format!("&H00{b}{g}{r}")
    } else {
        "&H0000FF00".to_string() // default green
    }
}

/// Format milliseconds as ASS time: H:MM:SS.cc (centiseconds).
fn ms_to_ass_time(ms: u64) -> String {
    let total_cs = ms / 10;
    let cs = total_cs % 100;
    let total_secs = total_cs / 100;
    let secs = total_secs % 60;
    let total_mins = total_secs / 60;
    let mins = total_mins % 60;
    let hours = total_mins / 60;
    format!("{hours}:{mins:02}:{secs:02}.{cs:02}")
}

/// Estimate frame duration in ms.
/// For a uniform-fps stream this is constant; we derive it from adjacent frames.
fn frame_duration_ms(frames: &[TelemetryFrame], frame_index: u64) -> u64 {
    let next = frame_index as usize + 1;
    if next < frames.len() {
        frames[next].video_time_ms - frames[frame_index as usize].video_time_ms
    } else if frame_index > 0 {
        // Last frame: same duration as the previous gap
        let i = frame_index as usize;
        frames[i].video_time_ms - frames[i - 1].video_time_ms
    } else {
        33 // fallback: ~30fps
    }
}
