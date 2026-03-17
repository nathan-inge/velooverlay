use fontdue::{Font, FontSettings};

/// Try to load a TTF font from common system paths.
///
/// Returns `None` if no font is found — the renderer falls back to drawing
/// widgets without text labels. A warning is printed to stderr.
pub fn load_system_font() -> Option<Font> {
    let candidates: &[&str] = &[
        // macOS (Intel + Apple Silicon)
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Geneva.ttf",
        // Linux (Debian/Ubuntu)
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        // Linux (Fedora/RHEL)
        "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf",
        // Windows
        "C:\\Windows\\Fonts\\arial.ttf",
        "C:\\Windows\\Fonts\\segoeui.ttf",
    ];

    for &path in candidates {
        if let Ok(bytes) = std::fs::read(path) {
            if let Ok(font) = Font::from_bytes(bytes.as_slice(), FontSettings::default()) {
                return Some(font);
            }
        }
    }

    eprintln!(
        "Warning: no system font found — text labels will not be rendered.\n\
         Tip: install Arial or DejaVu Sans, or file an issue if your platform needs adding."
    );
    None
}
