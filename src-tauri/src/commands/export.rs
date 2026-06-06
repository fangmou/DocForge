use std::path::Path;
use tokio::fs;
use crate::models::config::AppState;
use crate::commands::config::persist_to_disk;
use crate::utils::{normalize_path, is_wsl_path, wsl_to_linux_path, windows_to_wsl_path, wsl_distro};
#[cfg(target_os = "windows")]
use crate::utils::wsl_to_windows_path;
use serde::Serialize;
use tauri::State;

/// 将配置中的路径统一为当前平台可用格式（双向转换）
/// 仅用于前端路径提示（resolve_export_path 命令），不用于导出函数内部
fn resolve_config_path(path: &str) -> String {
    if path.is_empty() {
        return String::new();
    }
    let normalized = normalize_path(path);
    #[cfg(not(target_os = "windows"))]
    { windows_to_wsl_path(&normalized) }
    #[cfg(target_os = "windows")]
    { wsl_to_windows_path(&normalized) }
}

/// 将任意格式的路径统一为 Linux 路径（WSL 分支内使用）
/// 处理三种输入：Windows 盘符路径、WSL UNC 路径、已是 Linux 路径
fn to_linux_path(path: &str) -> String {
    let normalized = normalize_path(path);
    if is_wsl_path(&normalized) { wsl_to_linux_path(&normalized) }
    else { windows_to_wsl_path(&normalized) }
}

/// 计算输出路径（不预转换，返回归一化后的原始格式）
fn compute_output_path(output_dir: &str, source_path: &str, ext: &str, name: &str) -> String {
    let output_dir_norm = normalize_path(output_dir);
    if output_dir_norm.is_empty() {
        let parent = Path::new(source_path).parent()
            .map(|p| p.join(format!("{}.{}", name, ext)))
            .unwrap_or_else(|| std::path::PathBuf::from(format!("{}.{}", name, ext)));
        normalize_path(&parent.to_string_lossy())
    } else {
        format!("{}/{}.{}", output_dir_norm.trim_end_matches('/'), name, ext)
    }
}

/// 确保输出路径的父目录存在
fn ensure_parent_dir(path: &str) {
    if let Some(parent) = Path::new(path).parent() {
        let _ = std::fs::create_dir_all(parent.to_string_lossy().to_string());
    }
}

#[tauri::command]
pub async fn resolve_export_path(path: String) -> Result<String, String> {
    Ok(resolve_config_path(&path))
}

/// 创建子进程命令，Windows 上抑制控制台黑窗口
fn silent_cmd(program: &str) -> std::process::Command {
    #[cfg(not(target_os = "windows"))]
    { std::process::Command::new(program) }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new(program);
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        cmd
    }
}

const HTML_TEMPLATE: &str = r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{title}}</title>
<style>
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  max-width: 800px;
  margin: 0 auto;
  padding: 2em;
  line-height: 1.7;
  color: #333;
}
h1 { font-size: 1.8em; margin: 0.5em 0 0.3em; border-bottom: 1px solid #ddd; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; margin: 0.5em 0 0.3em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
h3 { font-size: 1.3em; margin: 0.5em 0 0.3em; }
h4 { font-size: 1.1em; margin: 0.5em 0 0.3em; }
p { margin: 0.5em 0; }
ul, ol { padding-left: 2em; margin: 0.5em 0; }
code {
  font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: #f4f4f4;
  padding: 2px 4px;
  border-radius: 3px;
}
pre {
  background: #f8f8f8;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 12px;
  overflow-x: auto;
  margin: 0.8em 0;
}
pre code { background: transparent; padding: 0; }
blockquote {
  border-left: 3px solid #c27418;
  padding-left: 1em;
  margin: 0.5em 0;
  color: #666;
}
table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
th, td { border: 1px solid #ddd; padding: 6px 12px; text-align: left; }
th { background: #f4f4f4; font-weight: 600; }
a { color: #c27418; text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; border-radius: 4px; }
</style>
</head>
<body>
{{content}}
</body>
</html>"#;

#[tauri::command]
pub async fn save_rendered_html(html_content: String, dest_path: String) -> Result<String, String> {
    let resolved_path = resolve_config_path(&dest_path);
    let title = Path::new(&resolved_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Document")
        .to_string();
    let full_html = HTML_TEMPLATE
        .replace("{{title}}", &title)
        .replace("{{content}}", &html_content);
    if let Some(parent) = Path::new(&resolved_path).parent() {
        fs::create_dir_all(parent).await.map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(&resolved_path, &full_html).await.map_err(|e| format!("写入HTML失败: {}", e))?;
    Ok(normalize_path(&resolved_path))
}

#[tauri::command]
pub async fn pick_save_path(
    app: tauri::AppHandle,
    file_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = tokio::task::spawn_blocking(move || {
        app.dialog().file().set_file_name(&file_name)
            .add_filter("HTML", &["html"]).blocking_save_file()
    }).await.map_err(|e| format!("选择路径失败: {}", e))?;
    Ok(path.map(|p| normalize_path(&p.to_string())))
}

#[tauri::command]
pub async fn pick_save_path_pdf(
    app: tauri::AppHandle,
    file_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = tokio::task::spawn_blocking(move || {
        app.dialog().file().set_file_name(&file_name)
            .add_filter("PDF", &["pdf"]).blocking_save_file()
    }).await.map_err(|e| format!("选择路径失败: {}", e))?;
    Ok(path.map(|p| normalize_path(&p.to_string())))
}

#[tauri::command]
pub async fn pick_save_path_docx(
    app: tauri::AppHandle,
    file_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = tokio::task::spawn_blocking(move || {
        app.dialog().file().set_file_name(&file_name)
            .add_filter("Word", &["docx"]).blocking_save_file()
    }).await.map_err(|e| format!("选择路径失败: {}", e))?;
    Ok(path.map(|p| normalize_path(&p.to_string())))
}

// === 通用命令检测 ===

#[derive(Debug, Clone, Serialize)]
pub struct CommandDetectInfo {
    pub available: bool,
    pub resolved: String,
    pub display: String,
}

fn detect_command_inner(command_path: &str) -> CommandDetectInfo {
    if let Ok(full_path) = which::which(command_path) {
        let resolved = full_path.to_string_lossy().to_string();
        return CommandDetectInfo {
            available: true,
            display: format!("✓ {}", resolved),
            resolved,
        };
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = silent_cmd("wsl")
            .args(["which", command_path]).output()
        {
            if output.status.success() {
                let wsl_which = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !wsl_which.is_empty() {
                    return CommandDetectInfo {
                        available: true,
                        display: format!("✓ WSL {} ({})", command_path, wsl_which),
                        resolved: format!("wsl {}", wsl_which),
                    };
                }
            }
        }
    }
    CommandDetectInfo {
        available: false,
        display: format!("✗ {} 未找到", command_path),
        resolved: String::new(),
    }
}

/// 检测 asciidoctor-pdf 命令
#[tauri::command]
pub async fn detect_pdf_command(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<CommandDetectInfo, String> {
    let command_path = state.lock().map_err(|e| format!("获取配置失败: {}", e))?.export.asciidoc.pdf.command_path.clone();
    let info = tokio::task::spawn_blocking(move || detect_command_inner(&command_path))
        .await.map_err(|e| format!("检测失败: {}", e))?;
    let result = info.clone();
    {
        let mut guard = state.lock().map_err(|e| format!("获取配置失败: {}", e))?;
        guard.export.asciidoc.pdf.command_resolved = info.resolved.clone();
        let snapshot = guard.clone();
        drop(guard);
        persist_to_disk(&app, &snapshot);
    }
    Ok(result)
}

#[tauri::command]
pub async fn check_asciidoctor_pdf(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<bool, String> {
    let (resolved, command_path) = {
        let guard = state.lock().map_err(|e| format!("获取配置失败: {}", e))?;
        (guard.export.asciidoc.pdf.command_resolved.clone(), guard.export.asciidoc.pdf.command_path.clone())
    };
    if !resolved.is_empty() { return Ok(true); }
    let info = tokio::task::spawn_blocking(move || detect_command_inner(&command_path))
        .await.map_err(|e| format!("检测失败: {}", e))?;
    {
        let mut guard = state.lock().map_err(|e| format!("获取配置失败: {}", e))?;
        guard.export.asciidoc.pdf.command_resolved = info.resolved.clone();
    }
    Ok(info.available)
}

/// 检测 pandoc 命令
#[tauri::command]
pub async fn detect_pandoc_command(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<CommandDetectInfo, String> {
    let command_path = state.lock().map_err(|e| format!("获取配置失败: {}", e))?.export.pandoc.command_path.clone();
    let info = tokio::task::spawn_blocking(move || detect_command_inner(&command_path))
        .await.map_err(|e| format!("检测失败: {}", e))?;
    let result = info.clone();
    {
        let mut guard = state.lock().map_err(|e| format!("获取配置失败: {}", e))?;
        guard.export.pandoc.command_resolved = info.resolved.clone();
        let snapshot = guard.clone();
        drop(guard);
        persist_to_disk(&app, &snapshot);
    }
    Ok(result)
}

#[tauri::command]
pub async fn check_pandoc(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<bool, String> {
    let (resolved, command_path) = {
        let guard = state.lock().map_err(|e| format!("获取配置失败: {}", e))?;
        (guard.export.pandoc.command_resolved.clone(), guard.export.pandoc.command_path.clone())
    };
    if !resolved.is_empty() { return Ok(true); }
    let info = tokio::task::spawn_blocking(move || detect_command_inner(&command_path))
        .await.map_err(|e| format!("检测失败: {}", e))?;
    {
        let mut guard = state.lock().map_err(|e| format!("获取配置失败: {}", e))?;
        guard.export.pandoc.command_resolved = info.resolved.clone();
    }
    Ok(info.available)
}

// === 辅助函数 ===

fn parse_adoc_attrs(content: &str) -> std::collections::HashMap<String, String> {
    let mut attrs = std::collections::HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(':') {
            if let Some(colon_pos) = rest.find(':') {
                let key = &rest[..colon_pos];
                let value = rest[colon_pos + 1..].trim().to_string();
                attrs.insert(key.to_string(), value);
            }
        }
        if trimmed.starts_with('=') || trimmed.starts_with("include::") { continue; }
    }
    attrs
}

fn expand_attrs(s: &str, attrs: &std::collections::HashMap<String, String>) -> String {
    let mut result = s.to_string();
    for _ in 0..3 {
        let prev = result.clone();
        for (key, value) in attrs {
            result = result.replace(&format!("{{{}}}", key), value);
        }
        if result == prev { break; }
    }
    result
}

fn extract_doc_title(content: &str) -> Option<String> {
    let attrs = parse_adoc_attrs(content);
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("= ") {
            let title = rest.trim();
            if !title.is_empty() {
                let expanded = expand_attrs(title, &attrs);
                let collapsed = expanded
                    .replace(" - ", "-").replace(" | ", "-")
                    .replace(" —— ", "-").replace("——", "-")
                    .replace(" — ", "—").replace(" + ", "+")
                    .replace("：", "-");
                let safe: String = collapsed.chars().map(|c| {
                    if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' }
                    else if c.is_whitespace() { '_' }
                    else { c }
                }).collect();
                return Some(safe);
            }
        }
        if !trimmed.is_empty() && !trimmed.starts_with("//") { break; }
    }
    None
}

fn extract_md_title(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("# ") {
            let title = rest.trim();
            if !title.is_empty() {
                let safe: String = title.chars().map(|c| {
                    if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' }
                    else if c.is_whitespace() { '_' }
                    else { c }
                }).collect();
                return Some(safe);
            }
        }
        if !trimmed.is_empty() && !trimmed.starts_with('#') && !trimmed.starts_with("<!--") { break; }
    }
    None
}

// === 导出 PDF ===

#[tauri::command]
pub async fn export_to_pdf(
    state: State<'_, std::sync::Mutex<AppState>>,
    source_path: String,
) -> Result<String, String> {
    // Markdown 文件直接用 pandoc 导出
    let is_md = source_path.ends_with(".md") || source_path.ends_with(".markdown");
    if is_md {
        return export_md_to_pdf_inner(state, source_path).await;
    }

    let (export_cfg, pdf_config, language) = {
        let guard = state.lock().map_err(|e| format!("获取配置失败: {}", e))?;
        (guard.export.clone(), guard.export.asciidoc.pdf.clone(), guard.editor.language.clone())
    };
    let content = fs::read_to_string(&source_path).await.map_err(|e| format!("读取文件失败: {}", e))?;

    let file_stem = Path::new(&source_path).file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let name = if export_cfg.output_naming == "title" {
        extract_doc_title(&content).unwrap_or_else(|| file_stem.to_string())
    } else { file_stem.to_string() };

    let output_path = compute_output_path(&export_cfg.output_dir, &source_path, "pdf", &name);
    ensure_parent_dir(&output_path);

    let adoc_attrs = parse_adoc_attrs(&content);
    let mut args: Vec<String> = Vec::new();
    args.push("-o".into()); args.push(output_path.clone());

    if export_cfg.asciidoc.enable_diagram {
        args.push("-r".into()); args.push("asciidoctor-diagram".into());
    }
    if language == "zh" {
        for (k, v) in [("toc-title", "目录"), ("table-caption", "表"), ("figure-caption", "图"), ("example-caption", "例"), ("lang", "zh_CN")] {
            args.push("-a".into()); args.push(format!("{}={}", k, v));
        }
    }
    let lang_default_theme = if language == "zh" { "default-ext-notoserif-cjk-sc" } else { "" };
    let theme = adoc_attrs.get("pdf-theme").cloned().filter(|v| !v.is_empty())
        .or_else(|| if !pdf_config.theme.is_empty() { Some(pdf_config.theme.clone()) } else { None })
        .or_else(|| if !lang_default_theme.is_empty() { Some(lang_default_theme.to_string()) } else { None })
        .unwrap_or_default();
    if !theme.is_empty() { args.push("-a".into()); args.push(format!("pdf-theme={}", theme)); }
    let page_size = adoc_attrs.get("pdf-page-size").cloned().unwrap_or_else(|| pdf_config.page_size.clone());
    if !page_size.is_empty() { args.push("-a".into()); args.push(format!("pdf-page-size={}", page_size)); }
    let fonts_dir = pdf_config.fonts_dir.clone();
    if !fonts_dir.is_empty() { args.push("-a".into()); args.push(format!("pdf-fontsdir={}", fonts_dir)); }
    if !pdf_config.footer_center.is_empty() { args.push("-a".into()); args.push(format!("pdf-footer-center={}", pdf_config.footer_center)); }
    let cover_image = pdf_config.cover_image.clone();
    if !cover_image.is_empty() { args.push("-a".into()); args.push(format!("pdf-cover-image=image:{}[]", cover_image)); }
    let title_logo = pdf_config.title_logo_image.clone();
    if !title_logo.is_empty() { args.push("-a".into()); args.push(format!("title-logo-image=image:{}[top=2in,align=center,pdfwidth=4in]", title_logo)); }
    let watermark = pdf_config.page_foreground_image.clone();
    if !watermark.is_empty() { args.push("-a".into()); args.push(format!("page-foreground-image=image:{}[]", watermark)); }
    if !export_cfg.asciidoc.extra_args.is_empty() {
        for arg in shell_words_split(&export_cfg.asciidoc.extra_args) { args.push(arg); }
    }
    for key in ["toc-title", "table-caption", "figure-caption", "example-caption", "lang"] {
        if let Some(value) = adoc_attrs.get(key) { args.push("-a".into()); args.push(format!("{}={}", key, value)); }
    }
    args.push(source_path.clone());

    let command_path = pdf_config.command_path.clone();
    let command_resolved = pdf_config.command_resolved.clone();
    let source_is_wsl = is_wsl_path(&source_path);
    let distro = wsl_distro(&source_path).map(|s| s.to_string());

    tokio::task::spawn_blocking(move || {
        let use_wsl = if source_is_wsl { true }
            else if command_resolved.starts_with("wsl ") { true }
            else if !command_resolved.is_empty() { false }
            else { detect_command_inner(&command_path).resolved.starts_with("wsl ") };

        let output = if use_wsl {
            let linux_args: Vec<String> = args.iter().map(|a| to_linux_path(a)).collect();
            let mut wsl_args: Vec<String> = Vec::new();
            if let Some(ref d) = distro { wsl_args.push("-d".into()); wsl_args.push(d.clone()); }
            wsl_args.push(command_path.clone()); wsl_args.extend(linux_args);
            silent_cmd("wsl").args(&wsl_args).output()
                .map_err(|e| format!("执行失败: {}. 请确保 WSL 中已安装 asciidoctor-pdf", e))?
        } else {
            silent_cmd(&command_path).args(&args).output()
                .map_err(|e| format!("执行失败: {}. 请确保已安装: gem install asciidoctor-pdf", e))?
        };
        if !output.status.success() {
            return Err(format!("PDF生成失败: {}", String::from_utf8_lossy(&output.stderr)));
        }
        Ok(output_path)
    }).await.map_err(|e| format!("任务失败: {}", e))?
}

/// Markdown → PDF（通过 pandoc 直接导出，无需 asciidoctor 中间步骤）
async fn export_md_to_pdf_inner(
    state: State<'_, std::sync::Mutex<AppState>>,
    source_path: String,
) -> Result<String, String> {
    let (export_cfg,) = {
        let guard = state.lock().map_err(|e| format!("获取配置失败: {}", e))?;
        (guard.export.clone(),)
    };
    let content = fs::read_to_string(&source_path).await.map_err(|e| format!("读取文件失败: {}", e))?;

    let file_stem = Path::new(&source_path).file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let name = if export_cfg.output_naming == "title" {
        extract_md_title(&content).unwrap_or_else(|| file_stem.to_string())
    } else { file_stem.to_string() };

    let output_path = compute_output_path(&export_cfg.output_dir, &source_path, "pdf", &name);
    ensure_parent_dir(&output_path);

    let pandoc_command_path = export_cfg.pandoc.command_path.clone();
    let pandoc_command_resolved = export_cfg.pandoc.command_resolved.clone();

    let source_is_wsl = is_wsl_path(&source_path);
    let distro = wsl_distro(&source_path).map(|s| s.to_string());

    tokio::task::spawn_blocking(move || {
        let mut args: Vec<String> = vec![
            "-f".into(), "markdown".into(),
            "-t".into(), "pdf".into(),
            "--pdf-engine=xelatex".into(),
            "-o".into(), output_path.clone(),
        ];
        args.push(source_path.clone());

        let use_wsl = if source_is_wsl { true }
            else if pandoc_command_resolved.starts_with("wsl ") { true }
            else if !pandoc_command_resolved.is_empty() { false }
            else { detect_command_inner(&pandoc_command_path).resolved.starts_with("wsl ") };

        let output = if use_wsl {
            let linux_args: Vec<String> = args.iter().map(|a| to_linux_path(a)).collect();
            let mut wsl_args: Vec<String> = Vec::new();
            if let Some(ref d) = distro { wsl_args.push("-d".into()); wsl_args.push(d.clone()); }
            wsl_args.push(pandoc_command_path.clone()); wsl_args.extend(linux_args);
            silent_cmd("wsl").args(&wsl_args).output()
                .map_err(|e| format!("执行失败: {}. 请确保 WSL 中已安装 pandoc 和 xelatex", e))?
        } else {
            silent_cmd(&pandoc_command_path).args(&args).output()
                .map_err(|e| format!("执行失败: {}. 请确保已安装 pandoc 和 xelatex", e))?
        };
        if !output.status.success() {
            return Err(format!("PDF生成失败: {}", String::from_utf8_lossy(&output.stderr)));
        }
        Ok(output_path)
    }).await.map_err(|e| format!("任务失败: {}", e))?
}

// === 导出 DOCX ===

#[tauri::command]
pub async fn export_to_docx(
    state: State<'_, std::sync::Mutex<AppState>>,
    source_path: String,
) -> Result<String, String> {
    // Markdown 文件直接用 pandoc 导出
    let is_md = source_path.ends_with(".md") || source_path.ends_with(".markdown");
    if is_md {
        return export_md_to_docx_inner(state, source_path).await;
    }

    let (export_cfg, language) = {
        let guard = state.lock().map_err(|e| format!("获取配置失败: {}", e))?;
        (guard.export.clone(), guard.editor.language.clone())
    };
    let content = fs::read_to_string(&source_path).await.map_err(|e| format!("读取文件失败: {}", e))?;

    let file_stem = Path::new(&source_path).file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let name = if export_cfg.output_naming == "title" {
        extract_doc_title(&content).unwrap_or_else(|| file_stem.to_string())
    } else { file_stem.to_string() };

    let output_path = compute_output_path(&export_cfg.output_dir, &source_path, "docx", &name);
    ensure_parent_dir(&output_path);

    // 临时 DocBook 文件
    let docbook_path = std::env::temp_dir().join(format!("docforge_docbook_{}_{}_{}.xml",
        file_stem, std::process::id(), std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()));
    let docbook_path_str = docbook_path.to_string_lossy().to_string();

    // 阶段 1: asciidoctor → DocBook
    let mut adoc_args: Vec<String> = Vec::new();
    adoc_args.push("-b".into()); adoc_args.push("docbook".into());
    adoc_args.push("-o".into()); adoc_args.push(docbook_path_str.clone());
    if export_cfg.asciidoc.enable_diagram { adoc_args.push("-r".into()); adoc_args.push("asciidoctor-diagram".into()); }

    let adoc_attrs = parse_adoc_attrs(&content);
    if language == "zh" {
        for (k, v) in [("toc-title", "目录"), ("table-caption", "表"), ("figure-caption", "图"), ("example-caption", "例"), ("lang", "zh_CN")] {
            adoc_args.push("-a".into()); adoc_args.push(format!("{}={}", k, v));
        }
    }
    if !export_cfg.asciidoc.extra_args.is_empty() {
        for arg in shell_words_split(&export_cfg.asciidoc.extra_args) { adoc_args.push(arg); }
    }
    for key in ["toc-title", "table-caption", "figure-caption", "example-caption", "lang"] {
        if let Some(value) = adoc_attrs.get(key) { adoc_args.push("-a".into()); adoc_args.push(format!("{}={}", key, value)); }
    }
    adoc_args.push(source_path.clone());

    // asciidoctor 路径推导：从 asciidoctor-pdf 的 resolved 推导
    let pdf_resolved = export_cfg.asciidoc.pdf.command_resolved.clone();

    // 阶段 2: pandoc
    let pandoc_command_path = export_cfg.pandoc.command_path.clone();
    let pandoc_command_resolved = export_cfg.pandoc.command_resolved.clone();
    let reference_doc = export_cfg.asciidoc.docx.reference_doc.clone();

    let source_is_wsl = is_wsl_path(&source_path);
    let distro = wsl_distro(&source_path).map(|s| s.to_string());

    tokio::task::spawn_blocking(move || {
        // asciidoctor WSL 检测
        let use_wsl_adoc = if source_is_wsl { true }
            else if pdf_resolved.starts_with("wsl ") { true }
            else { !detect_command_inner("asciidoctor").available };

        let result = (|| -> Result<String, String> {
            let adoc_output = if use_wsl_adoc {
                let linux_args: Vec<String> = adoc_args.iter().map(|a| to_linux_path(a)).collect();
                let mut wsl_args: Vec<String> = Vec::new();
                if let Some(ref d) = distro { wsl_args.push("-d".into()); wsl_args.push(d.clone()); }
                wsl_args.push("asciidoctor".into()); wsl_args.extend(linux_args);
                silent_cmd("wsl").args(&wsl_args).output()
                    .map_err(|e| format!("asciidoctor 执行失败: {}. 请确保已安装 asciidoctor", e))?
            } else {
                silent_cmd("asciidoctor").args(&adoc_args).output()
                    .map_err(|e| format!("asciidoctor 执行失败: {}. 请确保已安装: gem install asciidoctor", e))?
            };
            if !adoc_output.status.success() {
                return Err(format!("DocBook 生成失败: {}", String::from_utf8_lossy(&adoc_output.stderr)));
            }

            // pandoc DocBook → docx
            let use_wsl_pandoc = if source_is_wsl { true }
                else if pandoc_command_resolved.starts_with("wsl ") { true }
                else if !pandoc_command_resolved.is_empty() { false }
                else { detect_command_inner(&pandoc_command_path).resolved.starts_with("wsl ") };

            let mut pandoc_args: Vec<String> = Vec::new();
            pandoc_args.push("-f".into()); pandoc_args.push("docbook".into());
            pandoc_args.push("-t".into()); pandoc_args.push("docx".into());
            pandoc_args.push("-o".into()); pandoc_args.push(output_path.clone());
            if !reference_doc.is_empty() { pandoc_args.push("--reference-doc".into()); pandoc_args.push(reference_doc.clone()); }
            pandoc_args.push(docbook_path_str.clone());

            let pandoc_output = if use_wsl_pandoc {
                let linux_args: Vec<String> = pandoc_args.iter().map(|a| to_linux_path(a)).collect();
                let mut wsl_args: Vec<String> = Vec::new();
                if let Some(ref d) = distro { wsl_args.push("-d".into()); wsl_args.push(d.clone()); }
                wsl_args.push(pandoc_command_path.clone()); wsl_args.extend(linux_args);
                silent_cmd("wsl").args(&wsl_args).output()
                    .map_err(|e| format!("pandoc 执行失败: {}. 请确保已安装 pandoc", e))?
            } else {
                silent_cmd(&pandoc_command_path).args(&pandoc_args).output()
                    .map_err(|e| format!("pandoc 执行失败: {}. 请确保已安装: https://pandoc.org/installing.html", e))?
            };
            if !pandoc_output.status.success() {
                return Err(format!("Word 生成失败: {}", String::from_utf8_lossy(&pandoc_output.stderr)));
            }
            Ok(output_path)
        })();
        let _ = std::fs::remove_file(&docbook_path);
        result
    }).await.map_err(|e| format!("任务失败: {}", e))?
}

/// Markdown → DOCX（通过 pandoc 直接导出，无需 asciidoctor 中间步骤）
async fn export_md_to_docx_inner(
    state: State<'_, std::sync::Mutex<AppState>>,
    source_path: String,
) -> Result<String, String> {
    let (export_cfg,) = {
        let guard = state.lock().map_err(|e| format!("获取配置失败: {}", e))?;
        (guard.export.clone(),)
    };
    let content = fs::read_to_string(&source_path).await.map_err(|e| format!("读取文件失败: {}", e))?;

    let file_stem = Path::new(&source_path).file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let name = if export_cfg.output_naming == "title" {
        extract_md_title(&content).unwrap_or_else(|| file_stem.to_string())
    } else { file_stem.to_string() };

    let output_path = compute_output_path(&export_cfg.output_dir, &source_path, "docx", &name);
    ensure_parent_dir(&output_path);

    let pandoc_command_path = export_cfg.pandoc.command_path.clone();
    let pandoc_command_resolved = export_cfg.pandoc.command_resolved.clone();
    let reference_doc = export_cfg.asciidoc.docx.reference_doc.clone();

    let source_is_wsl = is_wsl_path(&source_path);
    let distro = wsl_distro(&source_path).map(|s| s.to_string());

    tokio::task::spawn_blocking(move || {
        let mut args: Vec<String> = vec![
            "-f".into(), "markdown".into(),
            "-t".into(), "docx".into(),
            "-o".into(), output_path.clone(),
        ];
        if !reference_doc.is_empty() {
            args.push("--reference-doc".into());
            args.push(reference_doc.clone());
        }
        args.push(source_path.clone());

        let use_wsl = if source_is_wsl { true }
            else if pandoc_command_resolved.starts_with("wsl ") { true }
            else if !pandoc_command_resolved.is_empty() { false }
            else { detect_command_inner(&pandoc_command_path).resolved.starts_with("wsl ") };

        let output = if use_wsl {
            let linux_args: Vec<String> = args.iter().map(|a| to_linux_path(a)).collect();
            let mut wsl_args: Vec<String> = Vec::new();
            if let Some(ref d) = distro { wsl_args.push("-d".into()); wsl_args.push(d.clone()); }
            wsl_args.push(pandoc_command_path.clone()); wsl_args.extend(linux_args);
            silent_cmd("wsl").args(&wsl_args).output()
                .map_err(|e| format!("pandoc 执行失败: {}. 请确保 WSL 中已安装 pandoc", e))?
        } else {
            silent_cmd(&pandoc_command_path).args(&args).output()
                .map_err(|e| format!("pandoc 执行失败: {}. 请确保已安装: https://pandoc.org/installing.html", e))?
        };
        if !output.status.success() {
            return Err(format!("Word 生成失败: {}", String::from_utf8_lossy(&output.stderr)));
        }
        Ok(output_path)
    }).await.map_err(|e| format!("任务失败: {}", e))?
}

// === 导入 DOCX ===

/// 打开文件选择对话框，仅允许选择 .docx 文件
#[tauri::command]
pub async fn pick_docx_file(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = tokio::task::spawn_blocking(move || {
        app.dialog().file()
            .add_filter("Word", &["docx"])
            .blocking_pick_file()
    }).await.map_err(|e| format!("选择文件失败: {}", e))?;
    Ok(path.map(|p| normalize_path(&p.to_string())))
}

/// 将 .docx 文件通过 pandoc 转换为 .adoc 文件
#[tauri::command]
pub async fn import_docx(
    state: State<'_, std::sync::Mutex<AppState>>,
    docx_path: String,
    dest_dir: String,
) -> Result<String, String> {
    let (pandoc_command_path, pandoc_command_resolved) = {
        let guard = state.lock().map_err(|e| format!("获取配置失败: {}", e))?;
        (guard.export.pandoc.command_path.clone(), guard.export.pandoc.command_resolved.clone())
    };

    let file_stem = Path::new(&docx_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("imported");
    let output_path = format!("{}/{}.adoc", dest_dir.trim_end_matches('/'), file_stem);

    if let Some(parent) = Path::new(&output_path).parent() {
        let _ = std::fs::create_dir_all(parent.to_string_lossy().to_string());
    }

    let source_is_wsl = is_wsl_path(&docx_path) || is_wsl_path(&dest_dir);
    let distro = if is_wsl_path(&docx_path) { wsl_distro(&docx_path).map(|s| s.to_string()) }
                 else { wsl_distro(&dest_dir).map(|s| s.to_string()) };

    let use_wsl = if source_is_wsl { true }
        else if pandoc_command_resolved.starts_with("wsl ") { true }
        else if !pandoc_command_resolved.is_empty() { false }
        else { detect_command_inner(&pandoc_command_path).resolved.starts_with("wsl ") };

    let output_path_clone = output_path.clone();
    tokio::task::spawn_blocking(move || {
        let args: Vec<String> = vec![
            "-f".into(), "docx".into(),
            "-t".into(), "asciidoc".into(),
            "-o".into(), output_path_clone.clone(),
            docx_path.clone(),
        ];

        let output = if use_wsl {
            let linux_args: Vec<String> = args.iter().map(|a| to_linux_path(a)).collect();
            let mut wsl_args: Vec<String> = Vec::new();
            if let Some(ref d) = distro { wsl_args.push("-d".into()); wsl_args.push(d.clone()); }
            wsl_args.push(pandoc_command_path.clone()); wsl_args.extend(linux_args);
            silent_cmd("wsl").args(&wsl_args).output()
                .map_err(|e| format!("pandoc 执行失败: {}. 请确保 WSL 中已安装 pandoc", e))?
        } else {
            silent_cmd(&pandoc_command_path).args(&args).output()
                .map_err(|e| format!("pandoc 执行失败: {}. 请确保已安装: https://pandoc.org/installing.html", e))?
        };
        if !output.status.success() {
            return Err(format!("Word 导入失败: {}", String::from_utf8_lossy(&output.stderr)));
        }
        Ok(output_path_clone)
    }).await.map_err(|e| format!("任务失败: {}", e))?
}

// === 其他命令 ===

#[tauri::command]
pub async fn open_in_browser(html_content: String) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join("docforge_export.html");
    fs::write(&temp_path, &html_content).await.map_err(|e| format!("写入临时文件失败: {}", e))?;
    let path_str = temp_path.to_string_lossy().to_string();
    #[cfg(target_os = "linux")]
    tokio::process::Command::new("xdg-open").arg(&path_str).spawn().ok();
    #[cfg(target_os = "macos")]
    tokio::process::Command::new("open").arg(&path_str).spawn().ok();
    #[cfg(target_os = "windows")]
    tokio::process::Command::new("cmd").args(["/c", "start", &path_str]).spawn().ok();
    Ok(())
}

fn shell_words_split(s: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;
    for c in s.chars() {
        if c == '"' || c == '\'' { in_quote = !in_quote; }
        else if c == ' ' && !in_quote { if !current.is_empty() { result.push(std::mem::take(&mut current)); } }
        else { current.push(c); }
    }
    if !current.is_empty() { result.push(current); }
    result
}

fn resolve_includes_inner(content: &str, base_dir: &Path, depth: u32) -> String {
    let mut result = String::new();
    for line in content.lines() {
        if let Some(rest) = line.trim().strip_prefix("include::") {
            if let Some(end) = rest.find('[') {
                let full_path = base_dir.join(&rest[..end]);
                if depth < 5 {
                    if let Ok(included) = std::fs::read_to_string(&full_path) {
                        if let Some(parent) = full_path.parent() {
                            result.push_str(&resolve_includes_inner(&included, parent, depth + 1));
                        } else { result.push_str(&included); }
                        result.push('\n'); continue;
                    }
                }
            }
        }
        result.push_str(line); result.push('\n');
    }
    result
}

#[tauri::command]
pub async fn resolve_includes(content: String, base_dir: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        Ok(resolve_includes_inner(&content, Path::new(&base_dir), 0))
    }).await.map_err(|e| format!("解析失败: {}", e))?
}
