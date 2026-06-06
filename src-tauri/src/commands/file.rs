use crate::utils::normalize_path;
use serde::Serialize;
use std::path::Path;
use tokio::fs;

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(&path, &content)
        .await
        .map_err(|e| format!("写入文件失败: {}", e))
}

#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    list_dir_recursive(path, 1).await
}

/// 按需加载单个目录的子项（用于文件树懒加载）
#[tauri::command]
pub async fn list_sub_directory(path: String) -> Result<Vec<FileEntry>, String> {
    list_dir_recursive(path, 1).await
}

fn list_dir_recursive(
    path: String,
    max_depth: usize,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<FileEntry>, String>> + Send>> {
    Box::pin(async move {
        let mut entries = Vec::new();
        let mut dir_entries = fs::read_dir(&path)
            .await
            .map_err(|e| format!("读取目录失败: {}", e))?;

        while let Some(entry) = dir_entries
            .next_entry()
            .await
            .map_err(|e| format!("遍历目录失败: {}", e))?
        {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }

            let path_str = normalize_path(&entry.path().to_string_lossy());
            let is_dir = entry
                .file_type()
                .await
                .map(|ft| ft.is_dir())
                .unwrap_or(false);

            let children = if is_dir && max_depth > 0 {
                Some(list_dir_recursive(path_str.clone(), max_depth - 1).await?)
            } else {
                None
            };

            entries.push(FileEntry {
                name,
                path: path_str,
                is_dir,
                children,
            });
        }

        entries.sort_by(|a, b| {
            b.is_dir.cmp(&a.is_dir).then_with(|| {
                let a_lower = a.name.to_lowercase();
                let b_lower = b.name.to_lowercase();
                a_lower.cmp(&b_lower)
            })
        });

        Ok(entries)
    })
}

#[tauri::command]
pub async fn pick_directory(
    app: tauri::AppHandle,
    ) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let dir = tokio::task::spawn_blocking(move || {
        app.dialog().file().blocking_pick_folder()
    }).await.map_err(|e| format!("选择目录失败: {}", e))?;
    Ok(dir.map(|p| normalize_path(&p.to_string())))
}

#[tauri::command]
pub async fn create_file(path: String) -> Result<(), String> {
    fs::write(&path, "")
        .await
        .map_err(|e| format!("创建文件失败: {}", e))
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    // 先尝试删除文件，失败则尝试删除目录，避免 TOCTOU
    if fs::remove_file(&path).await.is_ok() {
        return Ok(());
    }
    fs::remove_dir_all(&path)
        .await
        .map_err(|e| format!("删除失败: {}", e))
}

#[tauri::command]
pub async fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path)
        .await
        .map_err(|e| format!("重命名失败: {}", e))
}

#[tauri::command]
pub async fn create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path)
        .await
        .map_err(|e| format!("创建目录失败: {}", e))
}

/// 递归列出目录下所有 .adoc/.asciidoc/.txt/.md 文件（用于 include/链接补全）
#[tauri::command]
pub async fn list_all_adoc_files(path: String) -> Result<Vec<String>, String> {
    list_adoc_recursive(path).await
}

fn list_adoc_recursive(
    path: String,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<String>, String>> + Send>> {
    Box::pin(async move {
        let mut files = Vec::new();
        let mut entries = fs::read_dir(&path)
            .await
            .map_err(|e| format!("读取目录失败: {}", e))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("遍历目录失败: {}", e))?
        {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let path_str = normalize_path(&entry.path().to_string_lossy());
            let is_dir = entry
                .file_type()
                .await
                .map(|ft| ft.is_dir())
                .unwrap_or(false);
            if is_dir {
                let sub = list_adoc_recursive(path_str).await?;
                files.extend(sub);
            } else if name.ends_with(".adoc")
                || name.ends_with(".asciidoc")
                || name.ends_with(".txt")
                || name.ends_with(".md")
                || name.ends_with(".markdown")
            {
                files.push(path_str);
            }
        }
        Ok(files)
    })
}

/// 获取文件修改时间（毫秒级 Unix 时间戳），用于检测外部修改
#[tauri::command]
pub async fn get_file_mtime(path: String) -> Result<u64, String> {
    let meta = fs::metadata(&path)
        .await
        .map_err(|e| format!("获取文件信息失败: {}", e))?;
    let modified = meta
        .modified()
        .map_err(|e| format!("获取修改时间失败: {}", e))?;
    let duration = modified
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    Ok(duration.as_millis() as u64)
}

#[tauri::command]
pub async fn pick_save_file(
    app: tauri::AppHandle,
    dir: String,
    file_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    // 将前端统一路径（/分隔）还原为原生路径，供原生对话框使用
    let native_dir = dir.replace('/', std::path::MAIN_SEPARATOR.encode_utf8(&mut [0u8; 4]));
    let path = tokio::task::spawn_blocking(move || {
        let mut dialog = app.dialog().file()
            .set_file_name(&file_name)
            .add_filter("AsciiDoc", &["adoc", "asciidoc", "txt"])
            .add_filter("Markdown", &["md", "markdown"]);
        if !native_dir.is_empty() {
            dialog = dialog.set_directory(&native_dir);
        }
        dialog.blocking_save_file()
    })
    .await
    .map_err(|e| format!("选择路径失败: {}", e))?;
    Ok(path.map(|p| normalize_path(&p.to_string())))
}

/// 用系统默认程序打开文件
#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("文件不存在".into());
    }
    #[cfg(target_os = "linux")]
    {
        tokio::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        tokio::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        tokio::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    }
    Ok(())
}

/// 在系统文件管理器中显示文件
#[tauri::command]
pub async fn reveal_in_shell(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("文件不存在".into());
    }
    #[cfg(target_os = "linux")]
    {
        tokio::process::Command::new("xdg-open")
            .arg(p.parent().unwrap_or(p))
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        tokio::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        // explorer 需要 \ 分隔的本地路径
        let native_path = path.replace('/', "\\");
        tokio::process::Command::new("explorer")
            .args(["/select,", &native_path])
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    }
    Ok(())
}
