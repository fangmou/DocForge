use std::path::Path;
use tokio::fs;
use crate::models::config::AppState;
use tauri::State;

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
    let title = Path::new(&dest_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Document")
        .to_string();

    let full_html = HTML_TEMPLATE
        .replace("{{title}}", &title)
        .replace("{{content}}", &html_content);

    if let Some(parent) = Path::new(&dest_path).parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }

    fs::write(&dest_path, &full_html)
        .await
        .map_err(|e| format!("写入HTML失败: {}", e))?;

    Ok(dest_path)
}

#[tauri::command]
pub async fn pick_save_path(
    app: tauri::AppHandle,
    file_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("HTML", &["html"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("选择路径失败: {}", e))?;
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn pick_save_path_pdf(
    app: tauri::AppHandle,
    file_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("PDF", &["pdf"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("选择路径失败: {}", e))?;
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn check_asciidoctor_pdf() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        which::which("asciidoctor-pdf").is_ok()
    })
    .await
    .map_err(|e| format!("检查失败: {}", e))
}

/// 从 adoc 内容解析文件头属性
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
        if trimmed.starts_with('=') || trimmed.starts_with("include::") {
            continue;
        }
    }
    attrs
}

/// 从 adoc 内容提取文档标题（第一个 `= Title` 行）
fn extract_doc_title(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("= ") {
            let title = rest.trim();
            if !title.is_empty() {
                // 去掉空格，替换为下划线，保留安全文件名字符
                let safe: String = title
                    .chars()
                    .map(|c| if c.is_whitespace() || c == '/' || c == '\\' { '_' } else { c })
                    .collect();
                return Some(safe);
            }
        }
        // 标题必须是第一行非空非注释内容
        if !trimmed.is_empty() && !trimmed.starts_with("//") {
            break;
        }
    }
    None
}

#[tauri::command]
pub async fn export_to_pdf(
    state: State<'_, std::sync::Mutex<AppState>>,
    source_path: String,
) -> Result<String, String> {
    let (config, language) = {
        let guard = state.lock().map_err(|e| format!("获取配置失败: {}", e))?;
        (guard.pdf.clone(), guard.editor.language.clone())
    };
    let content = fs::read_to_string(&source_path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    // 输出文件名：根据 output_naming 配置决定
    let file_stem = Path::new(&source_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");

    let name = if config.output_naming == "title" {
        extract_doc_title(&content).unwrap_or_else(|| file_stem.to_string())
    } else {
        file_stem.to_string()
    };

    let output_path = if config.output_dir.is_empty() {
        let parent = Path::new(&source_path).parent()
            .map(|p| p.join(format!("{}.pdf", name)))
            .unwrap_or_else(|| std::path::PathBuf::from(format!("{}.pdf", name)));
        parent.to_string_lossy().to_string()
    } else {
        format!("{}/{}.pdf", config.output_dir.trim_end_matches('/'), name)
    };

    // 解析 adoc 头属性（优先级高于全局默认）
    let adoc_attrs = parse_adoc_attrs(&content);

    // 构建命令行
    let mut args: Vec<String> = Vec::new();
    args.push("-o".into());
    args.push(output_path.clone());

    // asciidoctor-diagram 支持
    if config.enable_diagram {
        args.push("-r".into());
        args.push("asciidoctor-diagram".into());
    }

    // 语言默认值（最低优先级）
    if language == "zh" {
        for (k, v) in [("toc-title", "目录"), ("table-caption", "表"), ("figure-caption", "图"), ("example-caption", "例"), ("lang", "zh_CN")] {
            args.push("-a".into());
            args.push(format!("{}={}", k, v));
        }
    }

    // 主题：adoc 头 > 全局配置 > 语言默认值
    let lang_default_theme = if language == "zh" {
        "default-ext-notoserif-cjk-sc"
    } else {
        ""
    };
    let theme = adoc_attrs.get("pdf-theme")
        .cloned()
        .filter(|v| !v.is_empty())
        .or_else(|| if !config.theme.is_empty() { Some(config.theme.clone()) } else { None })
        .or_else(|| if !lang_default_theme.is_empty() { Some(lang_default_theme.to_string()) } else { None })
        .unwrap_or_default();
    if !theme.is_empty() {
        args.push("-a".into());
        args.push(format!("pdf-theme={}", theme));
    }

    // 页面大小：adoc 头 > 全局配置
    let page_size = adoc_attrs.get("pdf-page-size")
        .cloned()
        .unwrap_or_else(|| config.page_size.clone());
    if !page_size.is_empty() {
        args.push("-a".into());
        args.push(format!("pdf-page-size={}", page_size));
    }

    // 字体目录
    if !config.fonts_dir.is_empty() {
        args.push("-a".into());
        args.push(format!("pdf-fontsdir={}", config.fonts_dir));
    }

    // 页脚
    if !config.footer_center.is_empty() {
        args.push("-a".into());
        args.push(format!("pdf-footer-center={}", config.footer_center));
    }

    // 封面
    if !config.cover_image.is_empty() {
        args.push("-a".into());
        args.push(format!("pdf-cover-image={}", config.cover_image));
    }

    // 用户自定义额外参数（中等优先级，覆盖语言默认值）
    if !config.extra_args.is_empty() {
        for arg in shell_words_split(&config.extra_args) {
            args.push(arg);
        }
    }

    // adoc 头语言属性（最高优先级，覆盖 extra_args 和默认值）
    for key in ["toc-title", "table-caption", "figure-caption", "example-caption", "lang"] {
        if let Some(value) = adoc_attrs.get(key) {
            args.push("-a".into());
            args.push(format!("{}={}", key, value));
        }
    }

    args.push(source_path.clone());

    let command_path = config.command_path.clone();
    tokio::task::spawn_blocking(move || {
        let output = std::process::Command::new(&command_path)
            .args(&args)
            .output()
            .map_err(|e| format!("执行失败: {}. 请确保已安装: gem install asciidoctor-pdf", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("PDF生成失败: {}", stderr));
        }
        Ok(output_path)
    })
    .await
    .map_err(|e| format!("任务失败: {}", e))?
}

#[tauri::command]
pub async fn open_in_browser(html_content: String) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join("docforge_export.html");
    fs::write(&temp_path, &html_content)
        .await
        .map_err(|e| format!("写入临时文件失败: {}", e))?;

    let path_str = temp_path.to_string_lossy().to_string();
    #[cfg(target_os = "linux")]
    tokio::process::Command::new("xdg-open").arg(&path_str).spawn().ok();
    #[cfg(target_os = "macos")]
    tokio::process::Command::new("open").arg(&path_str).spawn().ok();
    #[cfg(target_os = "windows")]
    tokio::process::Command::new("cmd").args(["/c", "start", &path_str]).spawn().ok();

    Ok(())
}

/// 简单的 shell 参数分割（支持引号）
fn shell_words_split(s: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '"' || c == '\'' {
            in_quote = !in_quote;
        } else if c == ' ' && !in_quote {
            if !current.is_empty() {
                result.push(std::mem::take(&mut current));
            }
        } else {
            current.push(c);
        }
    }
    if !current.is_empty() {
        result.push(current);
    }
    result
}

/// 递归解析 adoc 内容中的 `include::` 指令
fn resolve_includes_inner(content: &str, base_dir: &Path, depth: u32) -> String {
    let mut result = String::new();
    for line in content.lines() {
        if let Some(rest) = line.trim().strip_prefix("include::") {
            if let Some(end) = rest.find('[') {
                let rel_path = &rest[..end];
                let full_path = base_dir.join(rel_path);
                if depth < 5 {
                    if let Ok(included) = std::fs::read_to_string(&full_path) {
                        if let Some(parent) = full_path.parent() {
                            result.push_str(&resolve_includes_inner(&included, parent, depth + 1));
                        } else {
                            result.push_str(&included);
                        }
                        result.push('\n');
                        continue;
                    }
                }
            }
        }
        result.push_str(line);
        result.push('\n');
    }
    result
}

#[tauri::command]
pub async fn resolve_includes(content: String, base_dir: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let base = Path::new(&base_dir);
        Ok(resolve_includes_inner(&content, base, 0))
    })
    .await
    .map_err(|e| format!("解析失败: {}", e))?
}
