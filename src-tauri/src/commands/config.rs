use crate::models::config::{AppState, AppConfig, EditorConfig, RecentFile};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

macro_rules! lock_config {
    ($state:expr) => {
        $state.lock().map_err(|e| format!("获取配置失败: {}", e))?
    };
}

/// 获取配置文件路径
fn config_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());
    std::fs::create_dir_all(&dir).ok();
    dir.join("docforge-config.json")
}

/// 将当前配置持久化到磁盘
fn persist_to_disk(app: &tauri::AppHandle, config: &AppConfig) {
    let path = config_path(app);
    if let Ok(json) = serde_json::to_string_pretty(config) {
        let _ = std::fs::write(&path, json);
    }
}

#[tauri::command]
pub async fn save_editor_config(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    config: EditorConfig,
) -> Result<(), String> {
    lock_config!(state).editor = config;
    let snapshot = lock_config!(state).clone();
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn load_editor_config(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<EditorConfig, String> {
    Ok(lock_config!(state).editor.clone())
}

#[tauri::command]
pub async fn add_recent_file(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    path: String,
) -> Result<(), String> {
    let mut config = lock_config!(state);
    config.recent_files.retain(|f| f.path != path);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    config.recent_files.insert(0, RecentFile { path, opened_at: now });
    config.recent_files.truncate(20);
    let snapshot = config.clone();
    drop(config);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn get_recent_files(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<Vec<RecentFile>, String> {
    Ok(lock_config!(state).recent_files.clone())
}

#[tauri::command]
pub async fn clear_recent_files(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<(), String> {
    lock_config!(state).recent_files.clear();
    let snapshot = lock_config!(state).clone();
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn save_pdf_config(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    config: crate::models::config::PdfConfig,
) -> Result<(), String> {
    lock_config!(state).pdf = config;
    let snapshot = lock_config!(state).clone();
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn load_pdf_config(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<crate::models::config::PdfConfig, String> {
    Ok(lock_config!(state).pdf.clone())
}

#[tauri::command]
pub async fn save_ai_config(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    config: crate::models::config::AiConfig,
) -> Result<(), String> {
    lock_config!(state).ai = config;
    let snapshot = lock_config!(state).clone();
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn load_ai_config(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<crate::models::config::AiConfig, String> {
    Ok(lock_config!(state).ai.clone())
}

/// 应用启动时调用：从磁盘加载配置
pub fn load_config_from_disk(app: &tauri::AppHandle) -> AppConfig {
    let path = config_path(app);
    if path.exists() {
        if let Ok(json) = std::fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str::<AppConfig>(&json) {
                return config;
            }
        }
    }
    AppConfig::default()
}

// === 工作区管理 ===

#[tauri::command]
pub async fn set_current_workspace(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    path: String,
) -> Result<(), String> {
    let mut config = lock_config!(state);
    config.current_workspace = path.clone();
    // 同时加入最近工作区列表
    config.recent_workspaces.retain(|w| w.path != path);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    config.recent_workspaces.insert(0, RecentFile { path, opened_at: now });
    config.recent_workspaces.truncate(10);
    let snapshot = config.clone();
    drop(config);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn get_current_workspace(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<String, String> {
    Ok(lock_config!(state).current_workspace.clone())
}

#[tauri::command]
pub async fn get_recent_workspaces(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<Vec<RecentFile>, String> {
    Ok(lock_config!(state).recent_workspaces.clone())
}

#[tauri::command]
pub async fn clear_recent_workspaces(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<(), String> {
    lock_config!(state).recent_workspaces.clear();
    let snapshot = lock_config!(state).clone();
    persist_to_disk(&app, &snapshot);
    Ok(())
}
