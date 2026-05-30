use once_cell::sync::Lazy;
use serde::Serialize;
use tokio::fs;

// 预编译正则，避免每行重复编译
static RE_XREF: Lazy<regex::Regex> = Lazy::new(|| {
    regex::Regex::new(r"xref:([^\[\s\]]+?)(?:#([^\[\s\]]+))?\[").unwrap()
});
static RE_ANGLE: Lazy<regex::Regex> = Lazy::new(|| {
    regex::Regex::new(r"<<([^,>#]+?)(?:#([^,>]+))?(?:,[^>]*)?>>").unwrap()
});
static RE_INCLUDE: Lazy<regex::Regex> = Lazy::new(|| {
    regex::Regex::new(r"include:([^\[]+)\[").unwrap()
});

#[derive(Debug, Clone, Serialize)]
pub struct LinkEntry {
    pub source: String,
    pub target: String,
    pub anchor: Option<String>,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileMeta {
    pub path: String,
    pub title: String,
    pub keywords: Vec<String>,
}

/// 构建 Rust 侧的链接索引（比 JS 快）
#[tauri::command]
pub async fn build_link_index(workspace_root: String) -> Result<Vec<LinkEntry>, String> {
    let files = collect_adoc_files(workspace_root.clone()).await?;

    let mut entries = Vec::new();
    for file_path in files {
        if let Ok(content) = fs::read_to_string(&file_path).await {
            parse_links(&file_path, &content, &workspace_root, &mut entries);
        }
    }
    Ok(entries)
}

/// 获取所有文件的元数据（标题、关键词）
#[tauri::command]
pub async fn get_files_meta(workspace_root: String) -> Result<Vec<FileMeta>, String> {
    let files = collect_adoc_files(workspace_root.clone()).await?;

    let mut metas = Vec::new();
    for file_path in files {
        if let Ok(content) = fs::read_to_string(&file_path).await {
            let title = extract_title(&content)
                .unwrap_or_else(|| {
                    std::path::Path::new(&file_path)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("untitled")
                        .to_string()
                });
            let keywords = extract_keywords(&content);
            metas.push(FileMeta {
                path: file_path,
                title,
                keywords,
            });
        }
    }
    Ok(metas)
}

/// 查询反向链接
#[tauri::command]
pub async fn get_backlinks(file_path: String, workspace_root: String) -> Result<Vec<LinkEntry>, String> {
    let files = collect_adoc_files(workspace_root.clone()).await?;

    let mut backlinks = Vec::new();
    for file in files {
        if file == file_path { continue; }
        if let Ok(content) = fs::read_to_string(&file).await {
            let mut entries = Vec::new();
            parse_links(&file, &content, &workspace_root, &mut entries);
            for e in entries {
                if e.target == file_path {
                    backlinks.push(e);
                }
            }
        }
    }
    Ok(backlinks)
}

fn collect_adoc_files(
    dir: String,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<String>, String>> + Send>> {
    Box::pin(async move {
        let mut result = Vec::new();
        let mut entries = fs::read_dir(&dir)
            .await
            .map_err(|e| format!("读取目录失败: {}", e))?;
        while let Some(entry) = entries.next_entry().await.map_err(|e| format!("遍历失败: {}", e))? {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') { continue; }
            let path = entry.path().to_string_lossy().to_string();
            let is_dir = entry.file_type().await.map(|ft| ft.is_dir()).unwrap_or(false);
            if is_dir {
                let sub = collect_adoc_files(path).await?;
                result.extend(sub);
            } else if name.ends_with(".adoc") || name.ends_with(".asciidoc") || name.ends_with(".txt") {
                result.push(path);
            }
        }
        Ok(result)
    })
}

fn parse_links(file_path: &str, content: &str, workspace_root: &str, entries: &mut Vec<LinkEntry>) {
    let dir = std::path::Path::new(file_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    for (i, line) in content.lines().enumerate() {
        // xref:target.adoc[...] or xref:target.adoc#anchor[...]
        for cap in RE_XREF.captures_iter(line) {
            if let Some(target) = cap.get(1) {
                let target_str = target.as_str();
                if target_str.starts_with("http") || target_str.starts_with('#') { continue; }
                let resolved = resolve_path(&dir, workspace_root, target_str);
                entries.push(LinkEntry {
                    source: file_path.to_string(),
                    target: resolved,
                    anchor: cap.get(2).map(|m| m.as_str().to_string()),
                    line: i + 1,
                });
            }
        }

        // <<target#anchor,text>> or <<target,text>>
        for cap in RE_ANGLE.captures_iter(line) {
            if let Some(target) = cap.get(1) {
                let target_str = target.as_str().trim();
                if target_str.starts_with("http") { continue; }
                let resolved = resolve_path(&dir, workspace_root, target_str);
                entries.push(LinkEntry {
                    source: file_path.to_string(),
                    target: resolved,
                    anchor: cap.get(2).map(|m| m.as_str().to_string()),
                    line: i + 1,
                });
            }
        }

        // include::target.adoc[]
        for cap in RE_INCLUDE.captures_iter(line) {
            if let Some(target) = cap.get(1) {
                let resolved = resolve_path(&dir, workspace_root, target.as_str());
                entries.push(LinkEntry {
                    source: file_path.to_string(),
                    target: resolved,
                    anchor: None,
                    line: i + 1,
                });
            }
        }
    }
}

fn resolve_path(dir: &str, workspace_root: &str, target: &str) -> String {
    let resolved = if target.starts_with('/') {
        normalize_path(target)
    } else {
        normalize_path(&format!("{}/{}", dir, target))
    };
    // 限制在工作区内
    if resolved.starts_with(workspace_root) {
        resolved
    } else {
        format!("{}/{}", workspace_root, normalize_path(target))
    }
}

fn normalize_path(p: &str) -> String {
    let parts: Vec<&str> = p.split('/').collect();
    let mut result = Vec::new();
    for part in parts {
        if part == ".." { result.pop(); }
        else if part != "." && !part.is_empty() { result.push(part); }
    }
    result.join("/")
}

fn extract_title(content: &str) -> Option<String> {
    for line in content.lines().take(10) {
        if let Some(rest) = line.trim().strip_prefix("= ") {
            let title = rest.trim();
            if !title.is_empty() { return Some(title.to_string()); }
        }
    }
    None
}

fn extract_keywords(content: &str) -> Vec<String> {
    for line in content.lines() {
        if let Some(rest) = line.trim().strip_prefix(':') {
            if let Some(val) = rest.strip_prefix("keywords:") {
                return val.split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
        }
    }
    Vec::new()
}
