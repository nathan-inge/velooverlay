mod commands;

/// Entry point for the Tauri application.
/// Called by main.rs on desktop and by the mobile entry point on iOS/Android (future).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::check_ffmpeg,
            commands::get_video_metadata,
            commands::process_telemetry,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VeloOverlay");
}
