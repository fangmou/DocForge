use tauri::State;

use crate::services::link_db::{self, LinkDb};

/// 全量构建链接索引（工作区打开时调用）
#[tauri::command]
pub async fn build_link_index(
    workspace_root: String,
    state: State<'_, std::sync::Mutex<LinkDb>>,
) -> Result<(), String> {
    let files = link_db::collect_adoc_files(&workspace_root).await?;

    let mut parsed = Vec::new();
    for file_path in &files {
        if let Ok(content) = tokio::fs::read_to_string(file_path).await {
            parsed.push(link_db::parse_file(file_path, &content, &workspace_root));
        }
    }

    let db = state.lock().map_err(|e| e.to_string())?;
    db.rebuild(parsed);
    Ok(())
}

/// 增量更新单文件索引（保存时调用）
#[tauri::command]
pub async fn update_link_file(
    file_path: String,
    content: String,
    workspace_root: String,
    state: State<'_, std::sync::Mutex<LinkDb>>,
) -> Result<(), String> {
    let result = link_db::parse_file(&file_path, &content, &workspace_root);
    let db = state.lock().map_err(|e| e.to_string())?;
    db.update_file(&result);
    Ok(())
}

/// 追加标签到文件（返回修改后的内容，前端用 CodeMirror 替换）
#[tauri::command]
pub async fn add_tag_to_file(
    file_path: String,
    content: String,
    tag: String,
) -> Result<String, String> {
    Ok(link_db::add_tag_to_content(&content, &tag, &file_path))
}

/// 从文件中移除标签（返回修改后的内容，前端用 CodeMirror 替换）
#[tauri::command]
pub async fn remove_tag_from_file(
    file_path: String,
    content: String,
    tag: String,
) -> Result<String, String> {
    Ok(link_db::remove_tag_from_content(&content, &tag, &file_path))
}

/// 查询反向链接
#[tauri::command]
pub fn query_backlinks(
    file_path: String,
    state: State<'_, std::sync::Mutex<LinkDb>>,
) -> Result<Vec<link_db::LinkEntry>, String> {
    let db = state.lock().map_err(|e| e.to_string())?;
    Ok(db.get_backlinks(&file_path))
}

/// 查询正向链接
#[tauri::command]
pub fn query_forward_links(
    file_path: String,
    state: State<'_, std::sync::Mutex<LinkDb>>,
) -> Result<Vec<link_db::LinkEntry>, String> {
    let db = state.lock().map_err(|e| e.to_string())?;
    Ok(db.get_forward_links(&file_path))
}

/// 查询文件标题
#[tauri::command]
pub fn query_title(
    file_path: String,
    state: State<'_, std::sync::Mutex<LinkDb>>,
) -> Result<Option<String>, String> {
    let db = state.lock().map_err(|e| e.to_string())?;
    Ok(db.get_title(&file_path))
}

/// 查询所有标签（含计数）
#[tauri::command]
pub fn query_all_tags(
    state: State<'_, std::sync::Mutex<LinkDb>>,
) -> Result<Vec<link_db::TagCount>, String> {
    let db = state.lock().map_err(|e| e.to_string())?;
    Ok(db.get_all_tags())
}

/// 查询文件的所有标签
#[tauri::command]
pub fn query_tags_for_file(
    file_path: String,
    state: State<'_, std::sync::Mutex<LinkDb>>,
) -> Result<Vec<String>, String> {
    let db = state.lock().map_err(|e| e.to_string())?;
    Ok(db.get_tags_for_file(&file_path))
}

/// 按标签查文件
#[tauri::command]
pub fn query_files_by_tag(
    tag: String,
    state: State<'_, std::sync::Mutex<LinkDb>>,
) -> Result<Vec<String>, String> {
    let db = state.lock().map_err(|e| e.to_string())?;
    Ok(db.get_files_by_tag(&tag))
}

/// 查询所有文件（路径+标题）
#[tauri::command]
pub fn query_all_files(
    state: State<'_, std::sync::Mutex<LinkDb>>,
) -> Result<Vec<link_db::FileMeta>, String> {
    let db = state.lock().map_err(|e| e.to_string())?;
    Ok(db.get_all_files())
}

/// 查询图谱数据
#[tauri::command]
pub fn query_graph_data(
    state: State<'_, std::sync::Mutex<LinkDb>>,
) -> Result<link_db::GraphData, String> {
    let db = state.lock().map_err(|e| e.to_string())?;
    Ok(db.get_graph_data())
}

/// 查询文件大纲
#[tauri::command]
pub fn query_headings(
    file_path: String,
    state: State<'_, std::sync::Mutex<LinkDb>>,
) -> Result<Vec<link_db::HeadingEntry>, String> {
    let db = state.lock().map_err(|e| e.to_string())?;
    Ok(db.get_headings(&file_path))
}
