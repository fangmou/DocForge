use crate::services::document_format::{self, RE_BLOCK_DELIM};
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

#[derive(Debug, Clone, Serialize)]
pub struct LinkEntry {
    pub source: String,
    pub target: String,
    pub anchor: Option<String>,
    pub line: usize,
}

pub use document_format::HeadingEntry;

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

    // 通过 DocumentFormat trait 提取标签/标题/大纲
    let fmt = document_format::detect_format(file_path);
    let title = fmt
        .as_ref()
        .and_then(|f| f.extract_title(content))
        .unwrap_or_else(|| {
            std::path::Path::new(file_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("untitled")
                .to_string()
        });
    let keywords = fmt
        .as_ref()
        .map(|f| f.extract_tags(content))
        .unwrap_or_default();
    let headings = fmt
        .as_ref()
        .map(|f| f.extract_headings(content))
        .unwrap_or_default();

    // 链接解析（AsciiDoc 专有）
    let mut links = Vec::new();
    let mut in_block = false;
    let mut in_table = false;

    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed == "|===" {
            in_table = !in_table;
            continue;
        }
        if RE_BLOCK_DELIM.is_match(trimmed) {
            in_block = !in_block;
            continue;
        }
        if in_table || in_block {
            continue;
        }

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

    FileParseResult {
        path: file_path.to_string(),
        title,
        links,
        keywords,
        headings,
    }
}

/// 追加标签到文件内容，返回修改后的内容
pub fn add_tag_to_content(content: &str, tag: &str, file_path: &str) -> String {
    let tag = tag.trim();
    if tag.is_empty() {
        return content.to_string();
    }
    if let Some(fmt) = document_format::detect_format(file_path) {
        fmt.write_tag(content, tag)
    } else {
        content.to_string()
    }
}

/// 从文件内容中移除标签，返回修改后的内容
pub fn remove_tag_from_content(content: &str, tag: &str, file_path: &str) -> String {
    let tag = tag.trim();
    if tag.is_empty() {
        return content.to_string();
    }
    if let Some(fmt) = document_format::detect_format(file_path) {
        fmt.remove_tag(content, tag)
    } else {
        content.to_string()
    }
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
                || name.ends_with(".md")
                || name.ends_with(".markdown")
            {
                result.push(path);
            }
        }
        Ok(result)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── normalize_path（link_db 内部版本） ───

    #[test]
    fn normalize_path_dots() {
        assert_eq!(normalize_path("/a/b/../c"), "/a/c");
        assert_eq!(normalize_path("/a/./b"), "/a/b");
        assert_eq!(normalize_path("a/b/../../c"), "c");
        assert_eq!(normalize_path("/a/b/c/../../d"), "/a/d");
    }

    #[test]
    fn normalize_path_trailing_dots() {
        assert_eq!(normalize_path("/a/b/c/.."), "/a/b");
    }

    #[test]
    fn normalize_path_consecutive_slashes() {
        assert_eq!(normalize_path("/a//b///c"), "/a/b/c");
    }

    // ─── parse_file ───

    #[test]
    fn parse_file_extracts_xref_links() {
        let content = "= My Doc\n\nSee xref:other.adoc[Other] for details.\nAlso xref:chapter.adoc#section[Section].";
        let result = parse_file("/workspace/docs/index.adoc", content, "/workspace");
        assert_eq!(result.links.len(), 2);
        assert_eq!(result.links[0].target, "/workspace/docs/other.adoc");
        assert_eq!(result.links[1].anchor, Some("section".into()));
    }

    #[test]
    fn parse_file_extracts_angle_links() {
        let content = "= Doc\n\nSee <<other.adoc>> and <<chapter,Chapter>>.";
        let result = parse_file("/workspace/docs/index.adoc", content, "/workspace");
        assert_eq!(result.links.len(), 2);
    }

    #[test]
    fn parse_file_extracts_include() {
        let content = "= Doc\n\ninclude::shared.adoc[]";
        let result = parse_file("/workspace/docs/index.adoc", content, "/workspace");
        assert_eq!(result.links.len(), 1);
        assert_eq!(result.links[0].target, "/workspace/docs/shared.adoc");
    }

    #[test]
    fn parse_file_skips_links_in_blocks() {
        let content = "= Doc\n\n----\nxref:other.adoc[Link inside code block]\n----\n\nxref:real.adoc[Real link]";
        let result = parse_file("/workspace/docs/index.adoc", content, "/workspace");
        assert_eq!(result.links.len(), 1);
        assert_eq!(result.links[0].target, "/workspace/docs/real.adoc");
    }

    #[test]
    fn parse_file_skips_http_links() {
        let content = "= Doc\n\nxref:https://example.com[External]";
        let result = parse_file("/workspace/docs/index.adoc", content, "/workspace");
        assert!(result.links.is_empty());
    }

    #[test]
    fn parse_file_skips_hash_only_anchors() {
        let content = "= Doc\n\nxref:#section[Internal anchor]";
        let result = parse_file("/workspace/docs/index.adoc", content, "/workspace");
        assert!(result.links.is_empty());
    }

    #[test]
    fn parse_file_extracts_title_from_adoc() {
        let content = "= My Great Document\n\nBody text";
        let result = parse_file("/ws/test.adoc", content, "/ws");
        assert_eq!(result.title, "My Great Document");
    }

    #[test]
    fn parse_file_falls_back_to_filename() {
        let content = "No title here\nJust text";
        let result = parse_file("/ws/my-file.adoc", content, "/ws");
        assert_eq!(result.title, "my-file");
    }

    #[test]
    fn parse_file_extracts_tags() {
        let content = "= Title\n:keywords: alpha, beta\n\nBody";
        let result = parse_file("/ws/test.adoc", content, "/ws");
        assert_eq!(result.keywords, vec!["alpha", "beta"]);
    }

    #[test]
    fn parse_file_extracts_headings() {
        let content = "= Title\n\n== Section 1\n\n=== Sub\n\n== Section 2";
        let result = parse_file("/ws/test.adoc", content, "/ws");
        // "= Title" also matches as level 1 heading
        assert_eq!(result.headings.len(), 4);
        assert_eq!(result.headings[0].text, "Title");
        assert_eq!(result.headings[1].text, "Section 1");
    }

    #[test]
    fn parse_file_absolute_target() {
        let content = "= Doc\n\nxref:/abs/path.adoc[Absolute]";
        let result = parse_file("/ws/docs/index.adoc", content, "/ws");
        // 绝对路径不在 workspace 内，被拉回 workspace 根
        assert_eq!(result.links[0].target, "/ws/abs/path.adoc");
    }

    // ─── resolve_path ───

    #[test]
    fn resolve_path_relative() {
        assert_eq!(
            resolve_path("/workspace/docs", "/workspace", "other.adoc"),
            "/workspace/docs/other.adoc"
        );
    }

    #[test]
    fn resolve_path_absolute() {
        // 绝对路径不在 workspace 内时，会被拉回 workspace 根下
        assert_eq!(
            resolve_path("/workspace/docs", "/workspace", "/abs/path.adoc"),
            "/workspace/abs/path.adoc"
        );
    }

    // ─── LinkDb 生命周期 ───

    #[test]
    fn link_db_new_creates_tables() {
        let db = LinkDb::new();
        assert!(db.is_ok());
    }

    #[test]
    fn link_db_rebuild_and_query() {
        let db = LinkDb::new().unwrap();
        let data = vec![FileParseResult {
            path: "/ws/a.adoc".into(),
            title: "A".into(),
            links: vec![LinkEntry {
                source: "/ws/a.adoc".into(),
                target: "/ws/b.adoc".into(),
                anchor: None,
                line: 3,
            }],
            keywords: vec!["tag1".into()],
            headings: vec![HeadingEntry {
                line: 1,
                level: 1,
                text: "A".into(),
            }],
        }];
        db.rebuild(data);

        // 反向链接
        let backlinks = db.get_backlinks("/ws/b.adoc");
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].source, "/ws/a.adoc");

        // 正向链接
        let forward = db.get_forward_links("/ws/a.adoc");
        assert_eq!(forward.len(), 1);

        // 标题
        let title = db.get_title("/ws/a.adoc");
        assert_eq!(title, Some("A".into()));

        // 标签
        let tags = db.get_all_tags();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].tag, "tag1");

        // 大纲
        let headings = db.get_headings("/ws/a.adoc");
        assert_eq!(headings.len(), 1);
        assert_eq!(headings[0].text, "A");

        // 文件列表
        let files = db.get_all_files();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "/ws/a.adoc");
    }

    #[test]
    fn link_db_rebuild_clears_old_data() {
        let db = LinkDb::new().unwrap();
        // 先插入
        db.rebuild(vec![FileParseResult {
            path: "/ws/old.adoc".into(),
            title: "Old".into(),
            links: vec![],
            keywords: vec![],
            headings: vec![],
        }]);
        assert_eq!(db.get_all_files().len(), 1);

        // 重建为空
        db.rebuild(vec![]);
        assert_eq!(db.get_all_files().len(), 0);
        assert!(db.get_title("/ws/old.adoc").is_none());
    }

    #[test]
    fn link_db_update_file_incremental() {
        let db = LinkDb::new().unwrap();
        let initial = FileParseResult {
            path: "/ws/a.adoc".into(),
            title: "A".into(),
            links: vec![],
            keywords: vec!["old".into()],
            headings: vec![],
        };
        db.rebuild(vec![initial]);

        let updated = FileParseResult {
            path: "/ws/a.adoc".into(),
            title: "A Updated".into(),
            links: vec![LinkEntry {
                source: "/ws/a.adoc".into(),
                target: "/ws/b.adoc".into(),
                anchor: None,
                line: 5,
            }],
            keywords: vec!["new".into()],
            headings: vec![HeadingEntry {
                line: 1,
                level: 1,
                text: "A Updated".into(),
            }],
        };
        db.update_file(&updated);

        assert_eq!(db.get_title("/ws/a.adoc"), Some("A Updated".into()));
        let tags = db.get_all_tags();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].tag, "new");
        assert_eq!(db.get_forward_links("/ws/a.adoc").len(), 1);
        assert_eq!(db.get_headings("/ws/a.adoc").len(), 1);
    }

    #[test]
    fn link_db_tags_for_file() {
        let db = LinkDb::new().unwrap();
        db.rebuild(vec![FileParseResult {
            path: "/ws/a.adoc".into(),
            title: "A".into(),
            links: vec![],
            keywords: vec!["t1".into(), "t2".into()],
            headings: vec![],
        }]);
        let tags = db.get_tags_for_file("/ws/a.adoc");
        assert_eq!(tags.len(), 2);
    }

    #[test]
    fn link_db_files_by_tag() {
        let db = LinkDb::new().unwrap();
        db.rebuild(vec![
            FileParseResult {
                path: "/ws/a.adoc".into(),
                title: "A".into(),
                links: vec![],
                keywords: vec!["shared".into()],
                headings: vec![],
            },
            FileParseResult {
                path: "/ws/b.adoc".into(),
                title: "B".into(),
                links: vec![],
                keywords: vec!["shared".into(), "unique".into()],
                headings: vec![],
            },
        ]);
        let files = db.get_files_by_tag("shared");
        assert_eq!(files.len(), 2);
        let unique = db.get_files_by_tag("unique");
        assert_eq!(unique.len(), 1);
    }

    #[test]
    fn link_db_graph_data() {
        let db = LinkDb::new().unwrap();
        db.rebuild(vec![
            FileParseResult {
                path: "/ws/a.adoc".into(),
                title: "A".into(),
                links: vec![LinkEntry {
                    source: "/ws/a.adoc".into(),
                    target: "/ws/b.adoc".into(),
                    anchor: None,
                    line: 3,
                }],
                keywords: vec![],
                headings: vec![],
            },
            FileParseResult {
                path: "/ws/b.adoc".into(),
                title: "B".into(),
                links: vec![],
                keywords: vec![],
                headings: vec![],
            },
        ]);
        let graph = db.get_graph_data();
        assert_eq!(graph.nodes.len(), 2);
        assert_eq!(graph.edges.len(), 1);
        // a.adoc links out → link count = 1; b.adoc is linked to → link count = 1
        let a_node = graph.nodes.iter().find(|n| n.id == "/ws/a.adoc").unwrap();
        assert_eq!(a_node.links, 1);
    }

    // ─── add_tag_to_content / remove_tag_from_content ───

    #[test]
    fn add_tag_to_content_adoc() {
        let content = "= Title\n\nBody";
        let with_tag = add_tag_to_content(content, "test-tag", "doc.adoc");
        assert!(with_tag.contains(":keywords: test-tag"));
    }

    #[test]
    fn add_tag_to_content_md() {
        let content = "# Title\n\nBody";
        let with_tag = add_tag_to_content(content, "test-tag", "doc.md");
        assert!(with_tag.contains("tags: [test-tag]"));
    }

    #[test]
    fn add_tag_to_content_unknown_format_passthrough() {
        let content = "Some text";
        let result = add_tag_to_content(content, "tag", "doc.py");
        assert_eq!(result, content);
    }

    #[test]
    fn remove_tag_roundtrip() {
        let content = "= Title\n:keywords: tag1, tag2\n\nBody";
        let without_tag = super::remove_tag_from_content(content, "tag1", "doc.adoc");
        assert!(!without_tag.contains("tag1"));
        assert!(without_tag.contains("tag2"));
    }
}
