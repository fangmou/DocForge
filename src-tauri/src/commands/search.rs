use serde::Serialize;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub line: usize,
    pub col: usize,
    pub text: String,
}

#[tauri::command]
pub async fn search_files(
    directory: String,
    query: String,
    case_sensitive: Option<bool>,
) -> Result<Vec<SearchResult>, String> {
    let case_sensitive = case_sensitive.unwrap_or(false);
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    search_dir_recursive(&directory, &query, &query_lower, case_sensitive, &mut results)
        .await?;
    Ok(results)
}

fn search_dir_recursive<'a>(
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
            if name.starts_with('.') {
                continue;
            }

            let path_str = entry.path().to_string_lossy().to_string();
            let is_dir = entry
                .file_type()
                .await
                .map(|ft| ft.is_dir())
                .unwrap_or(false);

            if is_dir {
                search_dir_recursive(&path_str, query, query_lower, case_sensitive, results)
                    .await?;
            } else {
                // 只搜索文本文件
                let ext = std::path::Path::new(&path_str)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("");
                let is_text = matches!(
                    ext,
                    "adoc" | "asc" | "txt" | "md" | "rst" | "html" | "css"
                        | "js" | "ts" | "json" | "yaml" | "yml" | "toml" | "rs"
                        | "py" | "go" | "java" | "sh"
                );
                if !is_text {
                    continue;
                }

                let file = fs::File::open(&path_str)
                    .await
                    .map_err(|e| format!("打开文件失败: {}", e))?;
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
                        let text = if line.len() > 200 {
                            let mut s: String = line.chars().take(200).collect();
                            s.push_str("...");
                            s
                        } else {
                            line
                        };
                        results.push(SearchResult {
                            path: path_str.clone(),
                            line: line_num,
                            col,
                            text,
                        });
                        // 每个文件最多返回 50 条
                        if results.len() >= 500 {
                            return Ok(());
                        }
                    }
                }
            }
        }
        Ok(())
    })
}
