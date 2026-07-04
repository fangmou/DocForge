use crate::utils::normalize_path;
use base64::{engine::general_purpose::STANDARD, Engine as _};
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

/// 读取二进制文件并返回 base64 编码 + 推断的 MIME 类型
#[tauri::command]
pub async fn read_binary_file(path: String) -> Result<BinaryFileData, String> {
    let bytes = fs::read(&path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;
    let mime = infer_mime(&path);
    let b64 = STANDARD.encode(&bytes);
    Ok(BinaryFileData { base64: b64, mime })
}

#[derive(Debug, Clone, Serialize)]
pub struct BinaryFileData {
    pub base64: String,
    pub mime: String,
}

fn infer_mime(path: &str) -> String {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "tiff" | "tif" => "image/tiff",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "m4a" => "audio/mp4",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
    .into()
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
pub async fn list_directory(path: String, show_hidden: Option<bool>) -> Result<Vec<FileEntry>, String> {
    list_dir_recursive(path, 1, show_hidden.unwrap_or(false)).await
}

/// 按需加载单个目录的子项（用于文件树懒加载）
#[tauri::command]
pub async fn list_sub_directory(path: String, show_hidden: Option<bool>) -> Result<Vec<FileEntry>, String> {
    // 与 list_directory 行为一致：均按 max_depth=1 展开，更深层级由前端按需调用本命令懒加载
    list_directory(path, show_hidden).await
}

fn list_dir_recursive(
    path: String,
    max_depth: usize,
    show_hidden: bool,
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
            if !show_hidden && name.starts_with('.') {
                continue;
            }

            let path_str = normalize_path(&entry.path().to_string_lossy());
            let is_dir = entry
                .file_type()
                .await
                .map(|ft| ft.is_dir())
                .unwrap_or(false);

            let children = if is_dir && max_depth > 0 {
                Some(list_dir_recursive(path_str.clone(), max_depth - 1, show_hidden).await?)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[tokio::test]
    async fn list_dir_recursive_hides_dotfiles_by_default() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("visible.adoc"), "").unwrap();
        fs::write(root.join(".hidden"), "").unwrap();
        fs::create_dir(root.join(".gitdir")).unwrap();
        fs::create_dir(root.join("sub")).unwrap();

        let entries = list_dir_recursive(root.to_string_lossy().to_string(), 1, false)
            .await
            .unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"visible.adoc"));
        assert!(names.contains(&"sub"));
        assert!(!names.contains(&".hidden"));
        assert!(!names.contains(&".gitdir"));
    }

    #[tokio::test]
    async fn list_dir_recursive_shows_dotfiles_when_enabled() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("visible.adoc"), "").unwrap();
        fs::write(root.join(".hidden"), "").unwrap();
        fs::create_dir(root.join(".gitdir")).unwrap();
        fs::write(root.join(".gitdir").join(".innerhidden"), "").unwrap();
        fs::write(root.join(".gitdir").join("inner"), "").unwrap();

        let entries = list_dir_recursive(root.to_string_lossy().to_string(), 1, true)
            .await
            .unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"visible.adoc"));
        assert!(names.contains(&".hidden"));
        assert!(names.contains(&".gitdir"));

        // 递归传播：隐藏目录内部的隐藏文件也应列出（验证 show_hidden 传给了深层递归）
        let gitdir = entries.iter().find(|e| e.name == ".gitdir").unwrap();
        let children = gitdir.children.as_ref().unwrap();
        let child_names: Vec<&str> = children.iter().map(|e| e.name.as_str()).collect();
        assert!(child_names.contains(&"inner"));
        assert!(child_names.contains(&".innerhidden"));
    }
}
