use crate::utils::normalize_path;
use serde::Serialize;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub line: usize,
    pub col: usize,
    pub text: String,
    pub match_start: usize,
    pub match_end: usize,
}

#[tauri::command]
pub async fn search_files(
    directory: String,
    query: String,
    case_sensitive: Option<bool>,
    use_regex: Option<bool>,
) -> Result<Vec<SearchResult>, String> {
    let case_sensitive = case_sensitive.unwrap_or(false);
    let use_regex = use_regex.unwrap_or(false);

    if use_regex {
        let re = regex::RegexBuilder::new(&query)
            .case_insensitive(!case_sensitive)
            .build()
            .map_err(|e| format!("正则表达式错误: {}", e))?;
        let mut results = Vec::new();
        search_dir_regex(&directory, &re, &mut results).await?;
        Ok(results)
    } else {
        let query_lower = query.to_lowercase();
        let mut results = Vec::new();
        search_dir_plain(&directory, &query, &query_lower, case_sensitive, &mut results).await?;
        Ok(results)
    }
}

fn search_dir_plain<'a>(
    dir: &'a str,
    query: &'a str,
    query_lower: &'a str,
    case_sensitive: bool,
    results: &'a mut Vec<SearchResult>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        let mut entries = fs::read_dir(dir)
            .await
            .map_err(|e| format!("读取目录失败: {}", e))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("遍历目录失败: {}", e))?
        {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') { continue; }
            let path_str = normalize_path(&entry.path().to_string_lossy());
            let is_dir = entry.file_type().await.map(|ft| ft.is_dir()).unwrap_or(false);

            if is_dir {
                search_dir_plain(&path_str, query, query_lower, case_sensitive, results).await?;
            } else if is_text_file(&path_str) {
                search_file_plain(&path_str, query, query_lower, case_sensitive, results).await?;
            }
            if results.len() >= 500 { return Ok(()); }
        }
        Ok(())
    })
}

async fn search_file_plain(
    path_str: &str,
    query: &str,
    query_lower: &str,
    case_sensitive: bool,
    results: &mut Vec<SearchResult>,
) -> Result<(), String> {
    let file = fs::File::open(path_str).await.map_err(|e| format!("打开文件失败: {}", e))?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    let mut line_num = 0;
    while let Ok(Some(line)) = lines.next_line().await {
        line_num += 1;
        let (matches, col) = if case_sensitive {
            (line.contains(query), line.find(query).unwrap_or(0))
        } else {
            let lower = line.to_lowercase();
            let found = lower.contains(query_lower);
            let col = lower.find(query_lower).unwrap_or(0);
            (found, col)
        };
        if matches {
            let end = col + query.len();
            results.push(SearchResult {
                path: path_str.to_string(),
                line: line_num,
                col,
                text: truncate_line(&line),
                match_start: col,
                match_end: end,
            });
            if results.len() >= 500 { return Ok(()); }
        }
    }
    Ok(())
}

fn search_dir_regex<'a>(
    dir: &'a str,
    re: &'a regex::Regex,
    results: &'a mut Vec<SearchResult>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        let mut entries = fs::read_dir(dir)
            .await
            .map_err(|e| format!("读取目录失败: {}", e))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("遍历目录失败: {}", e))?
        {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') { continue; }
            let path_str = normalize_path(&entry.path().to_string_lossy());
            let is_dir = entry.file_type().await.map(|ft| ft.is_dir()).unwrap_or(false);
            if is_dir {
                search_dir_regex(&path_str, re, results).await?;
            } else if is_text_file(&path_str) {
                search_file_regex(&path_str, re, results).await?;
            }
            if results.len() >= 500 { return Ok(()); }
        }
        Ok(())
    })
}

async fn search_file_regex(
    path_str: &str,
    re: &regex::Regex,
    results: &mut Vec<SearchResult>,
) -> Result<(), String> {
    let file = fs::File::open(path_str).await.map_err(|e| format!("打开文件失败: {}", e))?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    let mut line_num = 0;
    while let Ok(Some(line)) = lines.next_line().await {
        line_num += 1;
        if let Some(m) = re.find(&line) {
            results.push(SearchResult {
                path: path_str.to_string(),
                line: line_num,
                col: m.start(),
                text: truncate_line(&line),
                match_start: m.start(),
                match_end: m.end(),
            });
            if results.len() >= 500 { return Ok(()); }
        }
    }
    Ok(())
}

fn is_text_file(path: &str) -> bool {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    matches!(
        ext,
        "adoc" | "asc" | "txt" | "md" | "rst" | "html" | "css"
            | "js" | "ts" | "json" | "yaml" | "yml" | "toml" | "rs"
            | "py" | "go" | "java" | "sh"
    )
}

fn truncate_line(line: &str) -> String {
    if line.len() > 200 {
        let mut s: String = line.chars().take(200).collect();
        s.push_str("...");
        s
    } else {
        line.to_string()
    }
}
