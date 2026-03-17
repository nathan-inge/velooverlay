// Tauri requires this build script to generate code at compile time
// (e.g. embedding the tauri.conf.json configuration into the binary).
fn main() {
    tauri_build::build()
}
