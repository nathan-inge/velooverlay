mod commands;
mod render;
mod video_meta;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::check_ffmpeg,
            commands::get_video_metadata,
            commands::process_telemetry,
            commands::compute_auto_sync,
            commands::export_video,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VeloOverlay");
}
