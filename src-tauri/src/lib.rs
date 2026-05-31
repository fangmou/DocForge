mod commands;
mod models;
mod services;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // 从磁盘加载持久化配置
            let config = commands::config::load_config_from_disk(app.handle());
            app.manage(std::sync::Mutex::new(config));
            // 初始化链接索引数据库（内存 SQLite）
            let link_db = services::link_db::LinkDb::new().expect("Failed to init link DB");
            app.manage(std::sync::Mutex::new(link_db));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::file::read_file,
            commands::file::write_file,
            commands::file::list_directory,
            commands::file::list_sub_directory,
            commands::file::pick_directory,
            commands::file::create_file,
            commands::file::delete_file,
            commands::file::rename_file,
            commands::file::create_dir,
            commands::file::pick_save_file,
            commands::file::get_file_mtime,
            commands::file::list_all_adoc_files,
            commands::file::reveal_in_shell,
            commands::link::build_link_index,
            commands::link::update_link_file,
            commands::link::add_tag_to_file,
            commands::link::query_backlinks,
            commands::link::query_forward_links,
            commands::link::query_title,
            commands::link::query_all_tags,
            commands::link::query_files_by_tag,
            commands::link::query_all_files,
            commands::link::query_graph_data,
            commands::link::query_headings,
            commands::plugin::list_plugins,
            commands::plugin::read_plugin_file,
            commands::plugin::toggle_plugin,
            commands::ai::stream_chat_completion,
            commands::ai::test_ai_connection,
            commands::config::save_ai_config,
            commands::config::load_ai_config,
            commands::search::search_files,
            commands::export::save_rendered_html,
            commands::export::pick_save_path,
            commands::export::pick_save_path_pdf,
            commands::export::check_asciidoctor_pdf,
            commands::export::export_to_pdf,
            commands::export::open_in_browser,
            commands::export::resolve_includes,
            commands::config::save_editor_config,
            commands::config::load_editor_config,
            commands::config::save_pdf_config,
            commands::config::load_pdf_config,
            commands::config::add_recent_file,
            commands::config::get_recent_files,
            commands::config::clear_recent_files,
            commands::config::set_current_workspace,
            commands::config::get_current_workspace,
            commands::config::get_recent_workspaces,
            commands::config::clear_recent_workspaces,
        ])
        .run(tauri::generate_context!())
        .expect("error while running docforge");
}
