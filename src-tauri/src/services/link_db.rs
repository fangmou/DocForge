use crate::utils::normalize_path as to_forward_slash;
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::sync::Mutex;

// 预编译正则
static RE_XREF: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"xref:([^\[\s\]]+?)(?:#([^\[\s\]]+))?\[").unwrap()
});
static RE_ANGLE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"<<([^,>#]+?)(?:#([^,>]+))?(?:,[^>]*)?>>").unwrap()
});
static RE_INCLUDE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"include::([^\[]+)\[").unwrap()
});
static RE_HEADING: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(={1,6})\s+(.+)").unwrap()
});
/// 块分隔符：4 个及以上相同字符（表格用 |=== 单独处理）
static RE_BLOCK_DELIM: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(-{4,}|\.{4,}|_{4,}|\*{4,}|/{4,}|={4,}|`{3,}|~{3,})\s*$").unwrap()
});

#[derive(Debug, Clone, Serialize)]
pub struct LinkEntry {
    pub source: String,
    pub target: String,
    pub anchor: Option<String>,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct HeadingEntry {
    pub line: usize,
    pub level: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileMeta {
    pub path: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub links: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

/// 单文件解析结果
pub struct FileParseResult {
    pub path: String,
    pub title: String,
    pub links: Vec<LinkEntry>,
    pub keywords: Vec<String>,
    pub headings: Vec<HeadingEntry>,
}

pub struct LinkDb {
    conn: Mutex<Connection>,
}

impl LinkDb {
    pub fn new() -> Result<Self, rusqlite::Error> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "PRAGMA journal_mode = OFF;
             PRAGMA synchronous = OFF;
             PRAGMA cache_size = -64000;

             CREATE TABLE IF NOT EXISTS files (
                 path  TEXT PRIMARY KEY,
                 title TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS links (
                 id     INTEGER PRIMARY KEY,
                 source TEXT NOT NULL,
                 target TEXT NOT NULL,
                 anchor TEXT,
                 line   INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_links_source ON links(source);
             CREATE INDEX IF NOT EXISTS idx_links_target ON links(target);
             CREATE TABLE IF NOT EXISTS tags (
                 file_path TEXT NOT NULL,
                 tag       TEXT NOT NULL,
                 PRIMARY KEY (file_path, tag)
             );
             CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
             CREATE TABLE IF NOT EXISTS headings (
                 file_path TEXT NOT NULL,
                 line      INTEGER NOT NULL,
                 level     INTEGER NOT NULL,
                 text      TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_headings_file ON headings(file_path);
            ",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// 全量重建索引
    pub fn rebuild(&self, data: Vec<FileParseResult>) {
        let conn = &mut *self.conn.lock().unwrap();
        let tx = conn.transaction().unwrap();
        tx.execute_batch("DELETE FROM links; DELETE FROM files; DELETE FROM tags; DELETE FROM headings;")
            .unwrap();

        {
            let mut ins_file = tx
                .prepare("INSERT OR REPLACE INTO files (path, title) VALUES (?1, ?2)")
                .unwrap();
            let mut ins_link = tx
                .prepare("INSERT INTO links (source, target, anchor, line) VALUES (?1, ?2, ?3, ?4)")
                .unwrap();
            let mut ins_tag = tx
                .prepare("INSERT OR REPLACE INTO tags (file_path, tag) VALUES (?1, ?2)")
                .unwrap();
            let mut ins_head = tx
                .prepare("INSERT INTO headings (file_path, line, level, text) VALUES (?1, ?2, ?3, ?4)")
                .unwrap();

            for f in &data {
                ins_file
                    .execute(params![f.path, f.title])
                    .unwrap();
                for l in &f.links {
                    ins_link
                        .execute(params![l.source, l.target, l.anchor, l.line])
                        .unwrap();
                }
                for t in &f.keywords {
                    ins_tag.execute(params![f.path, t]).unwrap();
                }
                for h in &f.headings {
                    ins_head
                        .execute(params![f.path, h.line, h.level, h.text])
                        .unwrap();
                }
            }
        }
        tx.commit().unwrap();
    }

    /// 增量更新单文件
    pub fn update_file(&self, result: &FileParseResult) {
        let conn = &mut *self.conn.lock().unwrap();
        let tx = conn.transaction().unwrap();
        tx.execute("DELETE FROM links WHERE source = ?1", params![result.path])
            .unwrap();
        tx.execute("DELETE FROM tags WHERE file_path = ?1", params![result.path])
            .unwrap();
        tx.execute("DELETE FROM headings WHERE file_path = ?1", params![result.path])
            .unwrap();
        tx.execute(
            "INSERT OR REPLACE INTO files (path, title) VALUES (?1, ?2)",
            params![result.path, result.title],
        )
        .unwrap();
        {
            let mut ins_link = tx
                .prepare("INSERT INTO links (source, target, anchor, line) VALUES (?1, ?2, ?3, ?4)")
                .unwrap();
            for l in &result.links {
                ins_link
                    .execute(params![l.source, l.target, l.anchor, l.line])
                    .unwrap();
            }
            let mut ins_tag = tx
                .prepare("INSERT OR REPLACE INTO tags (file_path, tag) VALUES (?1, ?2)")
                .unwrap();
            for t in &result.keywords {
                ins_tag.execute(params![result.path, t]).unwrap();
            }
            let mut ins_head = tx
                .prepare("INSERT INTO headings (file_path, line, level, text) VALUES (?1, ?2, ?3, ?4)")
                .unwrap();
            for h in &result.headings {
                ins_head
                    .execute(params![result.path, h.line, h.level, h.text])
                    .unwrap();
            }
        }
        tx.commit().unwrap();
    }

    // -- 查询方法 --

    pub fn get_backlinks(&self, file_path: &str) -> Vec<LinkEntry> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT source, target, anchor, line FROM links WHERE target = ?1")
            .unwrap();
        stmt.query_map(params![file_path], |row| {
            Ok(LinkEntry {
                source: row.get(0)?,
                target: row.get(1)?,
                anchor: row.get(2)?,
                line: row.get(3)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    pub fn get_forward_links(&self, file_path: &str) -> Vec<LinkEntry> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT source, target, anchor, line FROM links WHERE source = ?1")
            .unwrap();
        stmt.query_map(params![file_path], |row| {
            Ok(LinkEntry {
                source: row.get(0)?,
                target: row.get(1)?,
                anchor: row.get(2)?,
                line: row.get(3)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    pub fn get_title(&self, file_path: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT title FROM files WHERE path = ?1")
            .unwrap();
        stmt.query_row(params![file_path], |row| row.get(0))
            .ok()
    }

    pub fn get_all_tags(&self) -> Vec<TagCount> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT tag, COUNT(*) as cnt FROM tags GROUP BY tag ORDER BY cnt DESC")
            .unwrap();
        stmt.query_map([], |row| {
            Ok(TagCount {
                tag: row.get(0)?,
                count: row.get::<_, usize>(1)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    pub fn get_tags_for_file(&self, file_path: &str) -> Vec<String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT tag FROM tags WHERE file_path = ?1")
            .unwrap();
        stmt.query_map(params![file_path], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }

    pub fn get_files_by_tag(&self, tag: &str) -> Vec<String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT file_path FROM tags WHERE tag = ?1")
            .unwrap();
        stmt.query_map(params![tag], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }

    pub fn get_all_files(&self) -> Vec<FileMeta> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT path, title FROM files ORDER BY path")
            .unwrap();
        stmt.query_map([], |row| {
            Ok(FileMeta {
                path: row.get(0)?,
                title: row.get(1)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    pub fn get_graph_data(&self) -> GraphData {
        let conn = self.conn.lock().unwrap();
        // 节点
        let mut stmt_files = conn.prepare("SELECT path, title FROM files").unwrap();
        let nodes: Vec<GraphNode> = stmt_files
            .query_map([], |row| {
                Ok(GraphNode {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    links: 0,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        // 边 + 连接数统计
        let mut stmt_links = conn
            .prepare("SELECT DISTINCT source, target FROM links")
            .unwrap();
        let edges: Vec<GraphEdge> = stmt_links
            .query_map([], |row| {
                Ok(GraphEdge {
                    source: row.get(0)?,
                    target: row.get(1)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        // 计算连接数
        let mut link_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for e in &edges {
            *link_counts.entry(e.source.clone()).or_insert(0) += 1;
            *link_counts.entry(e.target.clone()).or_insert(0) += 1;
        }
        let nodes: Vec<GraphNode> = nodes
            .into_iter()
            .map(|mut n| {
                n.links = *link_counts.get(&n.id).unwrap_or(&0);
                n
            })
            .collect();

        GraphData { nodes, edges }
    }

    pub fn get_headings(&self, file_path: &str) -> Vec<HeadingEntry> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT line, level, text FROM headings WHERE file_path = ?1 ORDER BY line")
            .unwrap();
        stmt.query_map(params![file_path], |row| {
            Ok(HeadingEntry {
                line: row.get(0)?,
                level: row.get(1)?,
                text: row.get(2)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

}

// -- 解析函数 --

pub fn parse_file(
    file_path: &str,
    content: &str,
    workspace_root: &str,
) -> FileParseResult {
    let dir = std::path::Path::new(file_path)
        .parent()
        .map(|p| to_forward_slash(&p.to_string_lossy()))
        .unwrap_or_default();

    let mut title = String::new();
    let mut links = Vec::new();
    let mut keywords = Vec::new();
    let mut headings = Vec::new();

    // 块上下文状态
    let mut in_block = false;
    let mut in_table = false;

    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();

        // --- 块边界检测 ---
        // 表格 |===（单独处理，不和其他块共用状态）
        if trimmed == "|===" {
            in_table = !in_table;
            continue;
        }
        // 通用块分隔符（代码块 ----、示例块 ====、说明块 **** 等）
        if RE_BLOCK_DELIM.is_match(trimmed) {
            in_block = !in_block;
            continue;
        }
        // 块内跳过标题和链接解析
        if in_table || in_block {
            continue;
        }

        // 标题（取第一个 = 开头的）
        if title.is_empty() {
            if let Some(rest) = trimmed.strip_prefix("= ") {
                let t = rest.trim();
                if !t.is_empty() {
                    title = t.to_string();
                }
            }
        }

        // 关键词
        if let Some(rest) = trimmed.strip_prefix(':') {
            if let Some(val) = rest.strip_prefix("keywords:") {
                keywords = val
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
        }

        // 大纲标题（仅 = 语法，. 不是大纲标题）
        if let Some(cap) = RE_HEADING.captures(line) {
            let level = cap.get(1).unwrap().as_str().len();
            let text = cap.get(2).unwrap().as_str().trim().to_string();
            headings.push(HeadingEntry {
                line: i + 1,
                level,
                text,
            });
        }

        // 链接
        for cap in RE_XREF.captures_iter(line) {
            if let Some(target) = cap.get(1) {
                let ts = target.as_str();
                if ts.starts_with("http") || ts.starts_with('#') {
                    continue;
                }
                links.push(LinkEntry {
                    source: file_path.to_string(),
                    target: resolve_path(&dir, workspace_root, ts),
                    anchor: cap.get(2).map(|m| m.as_str().to_string()),
                    line: i + 1,
                });
            }
        }
        for cap in RE_ANGLE.captures_iter(line) {
            if let Some(target) = cap.get(1) {
                let ts = target.as_str().trim();
                if ts.starts_with("http") {
                    continue;
                }
                links.push(LinkEntry {
                    source: file_path.to_string(),
                    target: resolve_path(&dir, workspace_root, ts),
                    anchor: cap.get(2).map(|m| m.as_str().to_string()),
                    line: i + 1,
                });
            }
        }
        for cap in RE_INCLUDE.captures_iter(line) {
            if let Some(target) = cap.get(1) {
                links.push(LinkEntry {
                    source: file_path.to_string(),
                    target: resolve_path(&dir, workspace_root, target.as_str()),
                    anchor: None,
                    line: i + 1,
                });
            }
        }
    }

    if title.is_empty() {
        title = std::path::Path::new(file_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("untitled")
            .to_string();
    }

    FileParseResult {
        path: file_path.to_string(),
        title,
        links,
        keywords,
        headings,
    }
}

/// 追加标签到文件内容，返回修改后的内容
pub fn add_tag_to_content(content: &str, tag: &str) -> String {
    let tag = tag.trim();
    if tag.is_empty() {
        return content.to_string();
    }
    let lines: Vec<&str> = content.lines().collect();
    let mut kw_idx: Option<usize> = None;
    for (i, line) in lines.iter().enumerate() {
        if line.trim().to_lowercase().starts_with(":keywords:") {
            kw_idx = Some(i);
            break;
        }
        if i > 0 && line.trim().is_empty() {
            break;
        }
    }

    let mut result: Vec<String> = lines.iter().map(|s| s.to_string()).collect();
    if let Some(idx) = kw_idx {
        let existing = result[idx]
            .trim()
            .trim_start_matches(":keywords:")
            .trim()
            .to_string();
        let mut tags: Vec<String> = if existing.is_empty() {
            Vec::new()
        } else {
            existing
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        };
        if !tags.contains(&tag.to_string()) {
            tags.push(tag.to_string());
        }
        result[idx] = format!(":keywords: {}", tags.join(", "));
    } else {
        // 在标题行后插入；无标题行时插入文件开头
        let mut insert_at = 0;
        for (i, line) in lines.iter().enumerate() {
            let trimmed = line.trim();
            // 检测 AsciiDoc 标题（= ）和 Markdown 标题（# ）
            if i == 0 && (trimmed.starts_with("= ") || trimmed.starts_with("# ")) {
                insert_at = i + 1;
                break;
            }
            // 跳过已有的头部属性行（:xxx:），在其后插入
            let prev = if i > 0 { lines[i - 1].trim() } else { "" };
            if i == 0 || prev.starts_with('=') || prev.starts_with('#') || prev.starts_with(':') {
                if trimmed.starts_with(':') {
                    insert_at = i + 1;
                    continue;
                }
            }
            break;
        }
        result.insert(insert_at, format!(":keywords: {}", tag));
    }
    result.join("\n")
}

fn resolve_path(dir: &str, workspace_root: &str, target: &str) -> String {
    let resolved = if target.starts_with('/') {
        normalize_path(target)
    } else {
        normalize_path(&format!("{}/{}", dir, target))
    };
    if resolved.starts_with(workspace_root) {
        resolved
    } else {
        format!(
            "{}/{}",
            workspace_root,
            normalize_path(target).trim_start_matches('/')
        )
    }
}

fn normalize_path(p: &str) -> String {
    let has_leading = p.starts_with('/');
    let parts: Vec<&str> = p.split('/').collect();
    let mut result = Vec::new();
    for part in parts {
        if part == ".." {
            result.pop();
        } else if part != "." && !part.is_empty() {
            result.push(part);
        }
    }
    let joined = result.join("/");
    if has_leading {
        format!("/{}", joined)
    } else {
        joined
    }
}

/// 递归收集所有 adoc 文件
pub fn collect_adoc_files<'a>(
    dir: &'a str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<String>, String>> + Send + 'a>> {
    Box::pin(async move {
        use tokio::fs;
        let mut result = Vec::new();
        let mut entries = fs::read_dir(dir)
            .await
            .map_err(|e| format!("读取目录失败: {}", e))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("遍历失败: {}", e))?
        {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let path = to_forward_slash(&entry.path().to_string_lossy());
            let is_dir = entry
                .file_type()
                .await
                .map(|ft| ft.is_dir())
                .unwrap_or(false);
            if is_dir {
                result.extend(collect_adoc_files(&path).await?);
            } else if name.ends_with(".adoc")
                || name.ends_with(".asciidoc")
                || name.ends_with(".txt")
            {
                result.push(path);
            }
        }
        Ok(result)
    })
}
