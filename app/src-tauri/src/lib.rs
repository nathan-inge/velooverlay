mod commands;
mod render;
mod video_meta;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(render::ExportState::new())
        .invoke_handler(tauri::generate_handler![
            commands::check_ffmpeg,
            commands::get_video_metadata,
            commands::process_telemetry,
            commands::compute_auto_sync,
            commands::start_export_session,
            commands::write_frame,
            commands::finish_export,
            commands::abort_export,
            commands::save_layout_file,
            commands::read_layout_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VeloOverlay");
}
