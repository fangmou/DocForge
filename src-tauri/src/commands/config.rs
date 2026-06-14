use crate::models::config::{AppState, AppConfig, EditorConfig, RecentFile, ExportRecord, ExportRecordView, PandocConfig, PdfConfig, DocxConfig, WorkspaceState, TabState};
use crate::utils::normalize_path;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

macro_rules! lock_config {
    ($state:expr) => {
        $state.lock().map_err(|e| format!("获取配置失败: {}", e))?
    };
}

/// 应用配置目录；解析失败时回退到当前工作目录（与历史行为一致）。
/// 统一收口 app_config_dir 解析，供 config / secrets / draft 等复用。
pub fn app_config_dir_or_cwd(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default())
}

/// 获取配置文件路径
pub fn config_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app_config_dir_or_cwd(app);
    std::fs::create_dir_all(&dir).ok();
    dir.join("docforge-config.json")
}

/// 将当前配置持久化到磁盘
pub fn persist_to_disk(app: &tauri::AppHandle, config: &AppConfig) {
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
    let mut guard = lock_config!(state);
    guard.editor = config;
    let snapshot = guard.clone();
    drop(guard);
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
    workspace_path: Option<String>,
) -> Result<(), String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let entry = RecentFile { path, opened_at: now };
    if let Some(ref ws) = workspace_path {
        if !ws.is_empty() {
            // 写入 workspace 状态文件
            let sp = workspace_state_path(&app, ws);
            let mut ws_state = if sp.exists() {
                let json = std::fs::read_to_string(&sp).unwrap_or_default();
                serde_json::from_str::<WorkspaceState>(&json).unwrap_or_default()
            } else {
                WorkspaceState::default()
            };
            ws_state.recent_files.retain(|f| f.path != entry.path);
            ws_state.recent_files.insert(0, entry.clone());
            ws_state.recent_files.truncate(20);
            let json = serde_json::to_string_pretty(&ws_state).unwrap_or_default();
            let _ = std::fs::write(&sp, json);
            return Ok(());
        }
    }
    // 兼容：无 workspace_path 时写全局
    let mut config = lock_config!(state);
    config.recent_files.retain(|f| f.path != entry.path);
    config.recent_files.insert(0, entry);
    config.recent_files.truncate(20);
    let snapshot = config.clone();
    drop(config);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn get_recent_files(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    workspace_path: Option<String>,
) -> Result<Vec<RecentFile>, String> {
    if let Some(ref ws) = workspace_path {
        if !ws.is_empty() {
            let sp = workspace_state_path(&app, ws);
            if sp.exists() {
                let json = std::fs::read_to_string(&sp).unwrap_or_default();
                if let Ok(ws_state) = serde_json::from_str::<WorkspaceState>(&json) {
                    return Ok(ws_state.recent_files);
                }
            }
            return Ok(Vec::new());
        }
    }
    Ok(lock_config!(state).recent_files.clone())
}

#[tauri::command]
pub async fn clear_recent_files(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<(), String> {
    let mut guard = lock_config!(state);
    guard.recent_files.clear();
    let snapshot = guard.clone();
    drop(guard);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn remove_recent_file(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    path: String,
    workspace_path: Option<String>,
) -> Result<(), String> {
    if let Some(ref ws) = workspace_path {
        if !ws.is_empty() {
            let sp = workspace_state_path(&app, ws);
            if sp.exists() {
                let json = std::fs::read_to_string(&sp).unwrap_or_default();
                let mut ws_state: WorkspaceState =
                    serde_json::from_str(&json).unwrap_or_default();
                let before = ws_state.recent_files.len();
                ws_state.recent_files.retain(|f| f.path != path);
                if ws_state.recent_files.len() != before {
                    let json = serde_json::to_string_pretty(&ws_state).unwrap_or_default();
                    let _ = std::fs::write(&sp, json);
                }
            }
            return Ok(());
        }
    }
    let mut guard = lock_config!(state);
    let before = guard.recent_files.len();
    guard.recent_files.retain(|f| f.path != path);
    if guard.recent_files.len() != before {
        let snapshot = guard.clone();
        drop(guard);
        persist_to_disk(&app, &snapshot);
    }
    Ok(())
}

// === 导出配置命令 ===

/// 保存导出通用配置（output_dir, output_naming）
#[tauri::command]
pub async fn save_export_config(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    output_dir: String,
    output_naming: String,
) -> Result<(), String> {
    let mut guard = lock_config!(state);
    guard.export.output_dir = output_dir;
    guard.export.output_naming = output_naming;
    let snapshot = guard.clone();
    drop(guard);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

/// 加载导出通用配置 + pandoc 配置
#[tauri::command]
pub async fn load_export_config(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let guard = lock_config!(state);
    Ok(serde_json::json!({
        "output_dir": guard.export.output_dir,
        "output_naming": guard.export.output_naming,
        "pandoc": guard.export.pandoc,
    }))
}

/// 保存 pandoc 配置
#[tauri::command]
pub async fn save_pandoc_config(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    config: PandocConfig,
) -> Result<(), String> {
    let mut guard = lock_config!(state);
    if guard.export.pandoc.command_path != config.command_path {
        guard.export.pandoc.command_resolved = String::new();
    }
    guard.export.pandoc = config;
    let snapshot = guard.clone();
    drop(guard);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

/// 保存 AsciiDoc 导出引擎配置
#[tauri::command]
pub async fn save_asciidoc_export_config(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    enable_diagram: bool,
    extra_args: String,
) -> Result<(), String> {
    let mut guard = lock_config!(state);
    guard.export.asciidoc.enable_diagram = enable_diagram;
    guard.export.asciidoc.extra_args = extra_args;
    let snapshot = guard.clone();
    drop(guard);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

/// 加载 AsciiDoc 导出引擎配置
#[tauri::command]
pub async fn load_asciidoc_export_config(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let guard = lock_config!(state);
    Ok(serde_json::json!({
        "enable_diagram": guard.export.asciidoc.enable_diagram,
        "extra_args": guard.export.asciidoc.extra_args,
    }))
}

#[tauri::command]
pub async fn save_pdf_config(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    config: PdfConfig,
) -> Result<(), String> {
    let mut guard = lock_config!(state);
    if guard.export.asciidoc.pdf.command_path != config.command_path {
        guard.export.asciidoc.pdf.command_resolved = String::new();
    }
    guard.export.asciidoc.pdf = config;
    let snapshot = guard.clone();
    drop(guard);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn load_pdf_config(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<PdfConfig, String> {
    Ok(lock_config!(state).export.asciidoc.pdf.clone())
}

#[tauri::command]
pub async fn save_docx_config(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    config: DocxConfig,
) -> Result<(), String> {
    let mut guard = lock_config!(state);
    guard.export.asciidoc.docx = config;
    let snapshot = guard.clone();
    drop(guard);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn load_docx_config(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<DocxConfig, String> {
    Ok(lock_config!(state).export.asciidoc.docx.clone())
}

/// 根据指定语言返回 PDF 导出的默认额外参数（唯一来源）
#[tauri::command]
pub async fn get_default_extra_args(
    language: String,
) -> Result<String, String> {
    let mut args = vec![
        "-a !chapter-signifier",
        "-a version-label=v",
        "-a compress",
        "-a sectnums",
        "-a sectnumlevels=5",
        "-a pagenums",
        "-a title-separator=-",
        "-a icons=font",
        "-a reproducible",
        "-a source-highlighter=rouge",
    ];
    if language == "zh" {
        args.extend_from_slice(&[
            "-a toc-title=目录",
            "-a table-caption=表",
            "-a figure-caption=图",
            "-a example-caption=例",
            "-a lang=zh_CN",
        ]);
    }
    Ok(args.join(" "))
}

#[tauri::command]
pub async fn save_ai_config(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    config: crate::models::config::AiConfig,
) -> Result<(), String> {
    let mut guard = lock_config!(state);
    guard.ai = config;
    let snapshot = guard.clone();
    drop(guard);
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
    let mut config = if path.exists() {
        if let Ok(json) = std::fs::read_to_string(&path) {
            if let Ok(mut c) = serde_json::from_str::<AppConfig>(&json) {
                // 兼容旧版 Windows 配置中的 \ 分隔路径
                c.current_workspace = normalize_path(&c.current_workspace);
                for f in &mut c.recent_files {
                    f.path = normalize_path(&f.path);
                }
                for w in &mut c.recent_workspaces {
                    w.path = normalize_path(&w.path);
                }
                c
            } else {
                AppConfig::default()
            }
        } else {
            AppConfig::default()
        }
    } else {
        AppConfig::default()
    };

    // 迁移：旧版明文 api_key → 钥匙串，成功后清空配置文件中的 api_key。
    // 幂等：钥匙串已有非空 key 时视为已迁移，不覆盖——避免每次启动用残留的旧明文
    // （备份还原 / 多设备同步 / persist 失败未清空）覆盖用户新设的 key。
    if !config.ai.api_key.is_empty() {
        let dir = app_config_dir_or_cwd(app);
        let already = matches!(
            crate::services::secrets::get_ai_key(&dir),
            Ok(Some(k)) if !k.is_empty()
        );
        let migrated = already
            || crate::services::secrets::set_ai_key(&dir, &config.ai.api_key).is_ok();
        if migrated {
            config.ai.api_key = String::new();
            persist_to_disk(app, &config);
        }
    }

    config
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
    let mut guard = lock_config!(state);
    guard.recent_workspaces.clear();
    let snapshot = guard.clone();
    drop(guard);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn remove_recent_workspace(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    path: String,
) -> Result<(), String> {
    let mut guard = lock_config!(state);
    guard.recent_workspaces.retain(|w| w.path != path);
    let snapshot = guard.clone();
    drop(guard);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

// === 快捷键配置 ===

#[tauri::command]
pub async fn save_shortcuts(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    shortcuts: HashMap<String, String>,
) -> Result<(), String> {
    let mut guard = lock_config!(state);
    guard.shortcuts = shortcuts;
    let snapshot = guard.clone();
    drop(guard);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn load_shortcuts(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<HashMap<String, String>, String> {
    Ok(lock_config!(state).shortcuts.clone())
}

// === 自定义标记片段 ===

#[tauri::command]
pub async fn save_custom_snippets(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    snippets: Vec<crate::models::config::CustomSnippet>,
) -> Result<(), String> {
    let mut guard = lock_config!(state);
    guard.custom_snippets = snippets;
    let snapshot = guard.clone();
    drop(guard);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn load_custom_snippets(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<Vec<crate::models::config::CustomSnippet>, String> {
    Ok(lock_config!(state).custom_snippets.clone())
}

// === 自定义 AI 场景 ===

#[tauri::command]
pub async fn save_custom_ai_scenes(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    scenes: Vec<crate::models::config::CustomAiScene>,
) -> Result<(), String> {
    let mut guard = lock_config!(state);
    guard.custom_ai_scenes = scenes;
    let snapshot = guard.clone();
    drop(guard);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn load_custom_ai_scenes(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<Vec<crate::models::config::CustomAiScene>, String> {
    Ok(lock_config!(state).custom_ai_scenes.clone())
}

// === 导出历史 ===

#[tauri::command]
pub async fn add_export_history(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    path: String,
    format: String,
    workspace_path: Option<String>,
) -> Result<(), String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let record = ExportRecord { path: path.clone(), format, exported_at: now };
    if let Some(ref ws) = workspace_path {
        if !ws.is_empty() {
            let sp = workspace_state_path(&app, ws);
            let mut ws_state = if sp.exists() {
                let json = std::fs::read_to_string(&sp).unwrap_or_default();
                serde_json::from_str::<WorkspaceState>(&json).unwrap_or_default()
            } else {
                WorkspaceState::default()
            };
            ws_state.export_history.retain(|r| r.path != path);
            ws_state.export_history.insert(0, record);
            ws_state.export_history.retain(|r| Path::new(&r.path).exists());
            ws_state.export_history.truncate(20);
            let json = serde_json::to_string_pretty(&ws_state).unwrap_or_default();
            let _ = std::fs::write(&sp, json);
            return Ok(());
        }
    }
    let mut config = lock_config!(state);
    config.export_history.retain(|r| r.path != path);
    config.export_history.insert(0, record);
    config.export_history.retain(|r| Path::new(&r.path).exists());
    config.export_history.truncate(20);
    let snapshot = config.clone();
    drop(config);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn get_export_history(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    workspace_path: Option<String>,
) -> Result<Vec<ExportRecordView>, String> {
    let history = if let Some(ref ws) = workspace_path {
        if !ws.is_empty() {
            let sp = workspace_state_path(&app, ws);
            if sp.exists() {
                let json = std::fs::read_to_string(&sp).unwrap_or_default();
                if let Ok(ws_state) = serde_json::from_str::<WorkspaceState>(&json) {
                    ws_state.export_history
                } else {
                    Vec::new()
                }
            } else {
                Vec::new()
            }
        } else {
            lock_config!(state).export_history.clone()
        }
    } else {
        lock_config!(state).export_history.clone()
    };
    Ok(history.into_iter().map(|r| {
        let exists = Path::new(&r.path).exists();
        ExportRecordView { record: r, exists }
    }).collect())
}

#[tauri::command]
pub async fn remove_export_history(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    path: String,
    workspace_path: Option<String>,
) -> Result<(), String> {
    if let Some(ref ws) = workspace_path {
        if !ws.is_empty() {
            let sp = workspace_state_path(&app, ws);
            if sp.exists() {
                let json = std::fs::read_to_string(&sp).unwrap_or_default();
                if let Ok(mut ws_state) = serde_json::from_str::<WorkspaceState>(&json) {
                    ws_state.export_history.retain(|r| r.path != path);
                    let out = serde_json::to_string_pretty(&ws_state).unwrap_or_default();
                    let _ = std::fs::write(&sp, out);
                    return Ok(());
                }
            }
            return Ok(());
        }
    }
    let mut config = lock_config!(state);
    config.export_history.retain(|r| r.path != path);
    let snapshot = config.clone();
    drop(config);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub async fn clear_export_history(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    workspace_path: Option<String>,
) -> Result<(), String> {
    if let Some(ref ws) = workspace_path {
        if !ws.is_empty() {
            let sp = workspace_state_path(&app, ws);
            if sp.exists() {
                let json = std::fs::read_to_string(&sp).unwrap_or_default();
                if let Ok(mut ws_state) = serde_json::from_str::<WorkspaceState>(&json) {
                    ws_state.export_history.clear();
                    let out = serde_json::to_string_pretty(&ws_state).unwrap_or_default();
                    let _ = std::fs::write(&sp, out);
                    return Ok(());
                }
            }
            return Ok(());
        }
    }
    let mut guard = lock_config!(state);
    guard.export_history.clear();
    let snapshot = guard.clone();
    drop(guard);
    persist_to_disk(&app, &snapshot);
    Ok(())
}

// === 工作区状态（独立文件存储） ===

/// 计算 workspace 路径的 hash，用于生成独立文件名
fn workspace_hash(path: &str) -> String {
    use std::hash::{Hash, Hasher};
    // 统一去除尾随 `/`，避免同一路径产生不同 hash
    let normalized = path.trim_end_matches('/');
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    normalized.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// 返回 workspace 状态文件路径
fn workspace_state_path(app: &tauri::AppHandle, ws_path: &str) -> PathBuf {
    let dir = app_config_dir_or_cwd(app);
    let ws_dir = dir.join("workspaces");
    std::fs::create_dir_all(&ws_dir).ok();
    ws_dir.join(format!("{}.json", workspace_hash(ws_path)))
}

/// 返回 draft 目录
pub fn draft_dir(app: &tauri::AppHandle, ws_path: &str) -> PathBuf {
    let dir = app_config_dir_or_cwd(app);
    let d = dir.join("workspace-drafts").join(workspace_hash(ws_path));
    std::fs::create_dir_all(&d).ok();
    d
}

#[tauri::command]
pub async fn save_workspace_state(
    app: tauri::AppHandle,
    workspace_path: String,
    state: WorkspaceState,
) -> Result<(), String> {
    let path = workspace_state_path(&app, &workspace_path);
    let json = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("写入失败: {}", e))?;
    // 清理该 workspace 的 draft 目录中无用的 draft 文件
    let active_drafts: std::collections::HashSet<String> = state.tabs.iter()
        .filter(|t| !t.draft_path.is_empty())
        .map(|t| normalize_path(&t.draft_path))
        .collect();
    let dd = draft_dir(&app, &workspace_path);
    if dd.exists() {
        if let Ok(entries) = std::fs::read_dir(&dd) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().map_or(false, |e| e == "adoc") {
                    let p_str = normalize_path(&p.to_string_lossy());
                    if !active_drafts.contains(&p_str) {
                        let _ = std::fs::remove_file(&p);
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn load_workspace_state(
    app: tauri::AppHandle,
    workspace_path: String,
) -> Result<Option<WorkspaceState>, String> {
    let path = workspace_state_path(&app, &workspace_path);
    if !path.exists() {
        return Ok(None);
    }
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取失败: {}", e))?;
    let state: WorkspaceState = serde_json::from_str(&json)
        .map_err(|e| format!("解析失败: {}", e))?;
    // 过滤掉不存在的磁盘文件（draft 文件不在此过滤范围）
    let valid_tabs: Vec<TabState> = state.tabs.into_iter().filter(|t| {
        if t.path.starts_with("__untitled_") {
            // untitled 文件需要 draft 存在
            if t.draft_path.is_empty() { return false; }
            return Path::new(&t.draft_path).exists();
        }
        if t.is_dirty && !t.draft_path.is_empty() {
            // dirty 文件：真实文件或 draft 至少一个存在
            return Path::new(&t.path).exists() || Path::new(&t.draft_path).exists();
        }
        Path::new(&t.path).exists()
    }).collect();
    Ok(Some(WorkspaceState { tabs: valid_tabs, ..state }))
}

/// 返回指定工作区的 draft 目录路径（前端用于直接读写 draft 文件）
#[tauri::command]
pub async fn get_draft_dir(
    app: tauri::AppHandle,
    workspace_path: String,
) -> Result<String, String> {
    let dir = draft_dir(&app, &workspace_path);
    Ok(crate::utils::normalize_path(&dir.to_string_lossy()))
}
