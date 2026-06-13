use tauri::Manager;

/// 切换 DevTools（仅在 devtools feature 启用时编译）
#[cfg(feature = "devtools")]
#[tauri::command]
pub async fn toggle_devtools(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_devtools_open() {
            win.close_devtools();
        } else {
            win.open_devtools();
        }
    }
}
