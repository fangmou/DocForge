#![allow(dead_code)]
//! document_format.rs — 文档格式抽象层
//!
//! 定义 DocumentFormat trait，每种格式（AsciiDoc、Markdown、Typst …）
//! 实现标签/标题/大纲的提取和写入。新增格式只需添加一个 impl 块。

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use std::path::Path;

static RE_MD_HEADING: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(#{1,6})\s+(.+)").unwrap());
static RE_AD_HEADING: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(={1,6})\s+(.+)").unwrap());
pub static RE_BLOCK_DELIM: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(-{4,}|\.{4,}|_{4,}|\*{4,}|/{4,}|={4,}|`{3,}|~{3,})\s*$").unwrap()
});

#[derive(Debug, Clone, Serialize)]
pub struct HeadingEntry {
    pub line: usize,
    pub level: usize,
    pub text: String,
}

// ─── trait ──────────────────────────────────────────────────

pub trait DocumentFormat {
    fn extract_tags(&self, content: &str) -> Vec<String>;
    fn write_tag(&self, content: &str, tag: &str) -> String;
    fn remove_tag(&self, content: &str, tag: &str) -> String;
    fn extract_title(&self, content: &str) -> Option<String>;
    fn extract_headings(&self, content: &str) -> Vec<HeadingEntry>;
}

// ─── 工厂函数 ──────────────────────────────────────────────

pub fn detect_format(path: &str) -> Option<Box<dyn DocumentFormat>> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "adoc" | "asciidoc" | "txt" => Some(Box::new(AsciidocFormat)),
        "md" | "markdown" => Some(Box::new(MarkdownFormat)),
        _ => None,
    }
}

// ═══════════════════════════════════════════════════════════
// AsciidocFormat
// ═══════════════════════════════════════════════════════════

pub struct AsciidocFormat;

impl DocumentFormat for AsciidocFormat {
    fn extract_tags(&self, content: &str) -> Vec<String> {
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix(':') {
                if let Some(val) = rest.strip_prefix("keywords:") {
                    return val
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                }
            }
        }
        Vec::new()
    }

    fn write_tag(&self, content: &str, tag: &str) -> String {
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
            let mut insert_at = 0;
            for (i, line) in lines.iter().enumerate() {
                let trimmed = line.trim();
                if i == 0 && (trimmed.starts_with("= ") || trimmed.starts_with("# ")) {
                    insert_at = i + 1;
                    break;
                }
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

    fn remove_tag(&self, content: &str, tag: &str) -> String {
        let tag_lower = tag.trim().to_lowercase();
        let lines: Vec<&str> = content.lines().collect();
        let mut result: Vec<String> = Vec::new();
        for line in &lines {
            let trimmed = line.trim();
            if trimmed.to_lowercase().starts_with(":keywords:") {
                // 从原始行提取 keywords 值（保留大小写）
                let colon_pos = trimmed.find(':').unwrap_or(0);
                let rest = &trimmed[colon_pos..];
                let val = rest.trim_start_matches(':').trim_start_matches("keywords:")
                    .trim_start_matches("Keywords:");
                let tags: Vec<String> = val
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty() && s.to_lowercase() != tag_lower)
                    .collect();
                if !tags.is_empty() {
                    let indent = line.match_prefix_whitespace();
                    result.push(format!("{}:keywords: {}", indent, tags.join(", ")));
                }
            } else {
                result.push(line.to_string());
            }
        }
        result.join("\n")
    }

    fn extract_title(&self, content: &str) -> Option<String> {
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("= ") {
                let t = rest.trim();
                if !t.is_empty() {
                    return Some(t.to_string());
                }
            }
        }
        None
    }

    fn extract_headings(&self, content: &str) -> Vec<HeadingEntry> {
        let mut headings = Vec::new();
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
            if let Some(cap) = RE_AD_HEADING.captures(line) {
                let level = cap.get(1).unwrap().as_str().len();
                let text = cap.get(2).unwrap().as_str().trim().to_string();
                headings.push(HeadingEntry {
                    line: i + 1,
                    level,
                    text,
                });
            }
        }
        headings
    }
}

trait MatchPrefixWhitespace {
    fn match_prefix_whitespace(&self) -> &str;
}

impl MatchPrefixWhitespace for str {
    fn match_prefix_whitespace(&self) -> &str {
        self.split_once(|c: char| !c.is_whitespace())
            .map(|(prefix, _)| prefix)
            .unwrap_or("")
    }
}

// ═══════════════════════════════════════════════════════════
// MarkdownFormat
// ═══════════════════════════════════════════════════════════

pub struct MarkdownFormat;

/// Front matter 解析结果
struct FrontMatter {
    /// 闭合 `---` 的行索引（0-based）
    end_idx: usize,
    /// 解析出的标签列表
    tags: Vec<String>,
    /// front matter 内非 tags 相关行的内容（保留原文本）
    other_lines: Vec<String>,
}

impl MarkdownFormat {
    /// 去除 YAML 值的引号包裹
    fn unquote(s: &str) -> String {
        s.trim().trim_matches('"').trim_matches('\'').to_string()
    }

    /// 解析内联数组 `tags: [a, b, c]` 中的标签
    fn parse_inline_array(s: &str) -> Vec<String> {
        let s = s.trim();
        if !(s.starts_with('[') && s.ends_with(']')) {
            return Vec::new();
        }
        let inner = &s[1..s.len() - 1];
        inner
            .split(',')
            .map(Self::unquote)
            .filter(|s| !s.is_empty())
            .collect()
    }

    /// 统一解析 YAML Front Matter，返回结构化结果。
    /// 无 front matter 或无闭合 `---` 时返回 None。
    fn parse_front_matter(content: &str) -> Option<FrontMatter> {
        let lines: Vec<&str> = content.lines().collect();
        if lines.first().map(|l| l.trim()) != Some("---") {
            return None;
        }
        let end_idx = lines[1..].iter().position(|l| l.trim() == "---")? + 1;

        let mut tags = Vec::new();
        let mut other_lines: Vec<String> = Vec::new();
        let mut in_tags_list = false;

        for line in &lines[1..end_idx] {
            let trimmed = line.trim();
            if trimmed.starts_with("tags:") {
                in_tags_list = true;
                let rest = trimmed[5..].trim();
                if rest.starts_with('[') {
                    tags = Self::parse_inline_array(rest);
                    in_tags_list = false;
                }
                continue;
            }
            if in_tags_list {
                if trimmed.starts_with("- ") {
                    let val = Self::unquote(trimmed[2..].trim());
                    if !val.is_empty() {
                        tags.push(val);
                    }
                    continue;
                }
                if trimmed.is_empty() {
                    continue;
                }
                in_tags_list = false;
            }
            other_lines.push(line.to_string());
        }

        Some(FrontMatter {
            end_idx,
            tags,
            other_lines,
        })
    }

    /// 跳过 front matter，返回 body 起始行索引（0-based）。
    fn skip_front_matter(content: &str) -> usize {
        let lines: Vec<&str> = content.lines().collect();
        if lines.first().map(|l| l.trim()) != Some("---") {
            return 0;
        }
        match lines[1..].iter().position(|l| l.trim() == "---") {
            Some(rel) => rel + 2, // 跳过开闭两个 ---
            None => 0,
        }
    }
}

impl DocumentFormat for MarkdownFormat {
    fn extract_tags(&self, content: &str) -> Vec<String> {
        Self::parse_front_matter(content)
            .map(|fm| fm.tags)
            .unwrap_or_default()
    }

    fn write_tag(&self, content: &str, tag: &str) -> String {
        let tag = tag.trim();
        if tag.is_empty() {
            return content.to_string();
        }

        let lines: Vec<&str> = content.lines().collect();

        if let Some(fm) = Self::parse_front_matter(content) {
            let mut existing_tags = fm.tags;
            if !existing_tags.contains(&tag.to_string()) {
                existing_tags.push(tag.to_string());
            }

            let mut result: Vec<String> = Vec::new();
            result.push("---".to_string());
            result.push(format!("tags: [{}]", existing_tags.join(", ")));
            for line in &fm.other_lines {
                result.push(line.clone());
            }
            result.push("---".to_string());
            for line in &lines[fm.end_idx + 1..] {
                result.push(line.to_string());
            }
            return result.join("\n");
        }

        // 无 front matter：在开头创建
        let mut result: Vec<String> = Vec::new();
        result.push("---".to_string());
        result.push(format!("tags: [{}]", tag));
        result.push("---".to_string());
        if !lines.is_empty() && !lines[0].trim().is_empty() {
            result.push(String::new());
        }
        for line in &lines {
            result.push(line.to_string());
        }
        result.join("\n")
    }

    fn remove_tag(&self, content: &str, tag: &str) -> String {
        let tag_lower = tag.trim().to_lowercase();
        let lines: Vec<&str> = content.lines().collect();
        let fm = match Self::parse_front_matter(content) {
            Some(fm) => fm,
            None => return content.to_string(),
        };

        let remaining: Vec<String> =
            fm.tags.into_iter().filter(|t| t.to_lowercase() != tag_lower).collect();

        let mut result: Vec<String> = Vec::new();
        result.push("---".to_string());
        if !remaining.is_empty() {
            result.push(format!("tags: [{}]", remaining.join(", ")));
        }
        for line in &fm.other_lines {
            result.push(line.clone());
        }
        result.push("---".to_string());
        for line in &lines[fm.end_idx + 1..] {
            result.push(line.to_string());
        }
        result.join("\n")
    }

    fn extract_title(&self, content: &str) -> Option<String> {
        let skip = Self::skip_front_matter(content);
        for line in content.lines().skip(skip) {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("# ") {
                let t = rest.trim();
                if !t.is_empty() && !t.starts_with('#') {
                    return Some(t.to_string());
                }
            }
        }
        None
    }

    fn extract_headings(&self, content: &str) -> Vec<HeadingEntry> {
        let mut headings = Vec::new();
        let skip = Self::skip_front_matter(content);

        for (i, line) in content.lines().skip(skip).enumerate() {
            if let Some(cap) = RE_MD_HEADING.captures(line) {
                let level = cap.get(1).unwrap().as_str().len();
                let text = cap.get(2).unwrap().as_str().trim().to_string();
                headings.push(HeadingEntry {
                    line: skip + i + 1,
                    level,
                    text,
                });
            }
        }
        headings
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── detect_format ───

    #[test]
    fn detect_adoc_variants() {
        assert!(detect_format("test.adoc").is_some());
        assert!(detect_format("test.asciidoc").is_some());
        assert!(detect_format("test.txt").is_some());
    }

    #[test]
    fn detect_md_variants() {
        assert!(detect_format("test.md").is_some());
        assert!(detect_format("test.markdown").is_some());
    }

    #[test]
    fn detect_unknown_returns_none() {
        assert!(detect_format("test.py").is_none());
        assert!(detect_format("test.rs").is_none());
        assert!(detect_format("test").is_none());
        assert!(detect_format("test.html").is_none());
    }

    // ─── AsciidocFormat ───

    #[test]
    fn adoc_extract_tags() {
        let fmt = AsciidocFormat;
        let content = "= Title\n:keywords: tag1, tag2, tag3\n\nBody";
        let tags = fmt.extract_tags(content);
        assert_eq!(tags, vec!["tag1", "tag2", "tag3"]);
    }

    #[test]
    fn adoc_extract_tags_empty() {
        let fmt = AsciidocFormat;
        assert!(fmt.extract_tags("= Title\n\nBody").is_empty());
    }

    #[test]
    fn adoc_extract_tags_no_keywords_line() {
        let fmt = AsciidocFormat;
        let content = "= Title\n:toc: auto\n\nBody";
        assert!(fmt.extract_tags(content).is_empty());
    }

    #[test]
    fn adoc_write_tag_new() {
        let fmt = AsciidocFormat;
        let content = "= My Title\n\nBody text";
        let result = fmt.write_tag(content, "newtag");
        assert!(result.contains(":keywords: newtag"));
        assert!(result.contains("Body text"));
    }

    #[test]
    fn adoc_write_tag_append() {
        let fmt = AsciidocFormat;
        let content = "= Title\n:keywords: existing\n\nBody";
        let result = fmt.write_tag(content, "newtag");
        assert!(result.contains("existing"));
        assert!(result.contains("newtag"));
    }

    #[test]
    fn adoc_write_tag_no_duplicate() {
        let fmt = AsciidocFormat;
        let content = "= Title\n:keywords: tag1\n\nBody";
        let result = fmt.write_tag(content, "tag1");
        // 不应重复添加
        assert_eq!(result.matches("tag1").count(), 1);
    }

    #[test]
    fn adoc_write_tag_empty_ignored() {
        let fmt = AsciidocFormat;
        let content = "= Title\n\nBody";
        let result = fmt.write_tag(content, "  ");
        assert_eq!(result, content);
    }

    #[test]
    fn adoc_remove_tag() {
        let fmt = AsciidocFormat;
        let content = "= Title\n:keywords: tag1, tag2\n\nBody";
        let result = fmt.remove_tag(content, "tag1");
        assert!(!result.contains("tag1"));
        assert!(result.contains("tag2"));
    }

    #[test]
    fn adoc_remove_tag_case_insensitive() {
        let fmt = AsciidocFormat;
        let content = "= Title\n:keywords: MyTag, OtherTag\n\nBody";
        let result = fmt.remove_tag(content, "mytag");
        // MyTag 被移除，OtherTag 应保留且保持原大小写
        assert!(!result.contains("MyTag"));
        assert!(result.contains("OtherTag"));
    }

    #[test]
    fn adoc_remove_last_tag_removes_line() {
        let fmt = AsciidocFormat;
        let content = "= Title\n:keywords: onlytag\n\nBody";
        let result = fmt.remove_tag(content, "onlytag");
        assert!(!result.contains(":keywords:"));
    }

    #[test]
    fn adoc_extract_title() {
        let fmt = AsciidocFormat;
        assert_eq!(
            fmt.extract_title("= My Document\n\nBody"),
            Some("My Document".into())
        );
        assert_eq!(fmt.extract_title("Body without title"), None);
    }

    #[test]
    fn adoc_extract_title_empty_after_prefix() {
        let fmt = AsciidocFormat;
        assert_eq!(fmt.extract_title("= \n\nBody"), None);
    }

    #[test]
    fn adoc_extract_headings_basic() {
        let fmt = AsciidocFormat;
        let content = "= Title\n\n== Section 1\n\n=== Subsection\n\n== Section 2";
        let headings = fmt.extract_headings(content);
        // "= Title" 也匹配 ^={1,6}\s+ 所以是 level 1 标题
        assert_eq!(headings.len(), 4);
        assert_eq!(headings[0].level, 1);
        assert_eq!(headings[0].text, "Title");
        assert_eq!(headings[1].level, 2);
        assert_eq!(headings[1].text, "Section 1");
        assert_eq!(headings[2].level, 3);
        assert_eq!(headings[3].level, 2);
    }

    #[test]
    fn adoc_headings_skip_block_content() {
        let fmt = AsciidocFormat;
        let content = "= Title\n\n----\n== Not a heading\n----\n\n== Real Heading";
        let headings = fmt.extract_headings(content);
        // "= Title" is level 1, "== Real Heading" is level 2
        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].text, "Title");
        assert_eq!(headings[1].text, "Real Heading");
    }

    #[test]
    fn adoc_headings_skip_table() {
        let fmt = AsciidocFormat;
        let content = "= Title\n\n|===\n== Not heading in table\n|===\n\n== Real Heading";
        let headings = fmt.extract_headings(content);
        // "= Title" is level 1, "== Real Heading" is level 2
        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].text, "Title");
        assert_eq!(headings[1].text, "Real Heading");
    }

    // ─── MarkdownFormat ───

    #[test]
    fn md_extract_tags_yaml_list() {
        let fmt = MarkdownFormat;
        let content = "---\ntags:\n  - tag1\n  - tag2\n---\n\n# Title";
        let tags = fmt.extract_tags(content);
        assert_eq!(tags, vec!["tag1", "tag2"]);
    }

    #[test]
    fn md_extract_tags_inline_array() {
        let fmt = MarkdownFormat;
        let content = "---\ntags: [alpha, beta, gamma]\n---\n\n# Title";
        let tags = fmt.extract_tags(content);
        assert_eq!(tags, vec!["alpha", "beta", "gamma"]);
    }

    #[test]
    fn md_extract_tags_quoted() {
        let fmt = MarkdownFormat;
        let content = "---\ntags:\n  - \"quoted tag\"\n  - 'single'\n---\n\n# Title";
        let tags = fmt.extract_tags(content);
        assert_eq!(tags, vec!["quoted tag", "single"]);
    }

    #[test]
    fn md_extract_tags_no_front_matter() {
        let fmt = MarkdownFormat;
        assert!(fmt.extract_tags("# Title\n\nBody").is_empty());
    }

    #[test]
    fn md_write_tag_creates_front_matter() {
        let fmt = MarkdownFormat;
        let content = "# Title\n\nBody";
        let result = fmt.write_tag(content, "newtag");
        assert!(result.starts_with("---"));
        assert!(result.contains("tags: [newtag]"));
        assert!(result.contains("# Title"));
    }

    #[test]
    fn md_write_tag_appends_to_existing() {
        let fmt = MarkdownFormat;
        let content = "---\ntags: [existing]\n---\n\n# Title";
        let result = fmt.write_tag(content, "newtag");
        assert!(result.contains("existing"));
        assert!(result.contains("newtag"));
    }

    #[test]
    fn md_write_tag_no_duplicate() {
        let fmt = MarkdownFormat;
        let content = "---\ntags: [tag1]\n---\n\n# Title";
        let result = fmt.write_tag(content, "tag1");
        assert_eq!(result.matches("tag1").count(), 1);
    }

    #[test]
    fn md_remove_tag() {
        let fmt = MarkdownFormat;
        let content = "---\ntags: [tag1, tag2]\n---\n\n# Title";
        let result = fmt.remove_tag(content, "tag1");
        assert!(!result.contains("tag1"));
        assert!(result.contains("tag2"));
    }

    #[test]
    fn md_remove_tag_case_insensitive() {
        let fmt = MarkdownFormat;
        let content = "---\ntags: [MyTag, other]\n---\n\n# Title";
        let result = fmt.remove_tag(content, "mytag");
        assert!(!result.contains("MyTag"));
        assert!(result.contains("other"));
    }

    #[test]
    fn md_remove_last_tag_removes_tags_line() {
        let fmt = MarkdownFormat;
        let content = "---\ntags: [onlytag]\n---\n\n# Title";
        let result = fmt.remove_tag(content, "onlytag");
        assert!(!result.contains("tags:"));
    }

    #[test]
    fn md_extract_title_skips_front_matter() {
        let fmt = MarkdownFormat;
        let content = "---\ntags: [test]\n---\n\n# Real Title\n\nBody";
        assert_eq!(fmt.extract_title(content), Some("Real Title".into()));
    }

    #[test]
    fn md_extract_title_none() {
        let fmt = MarkdownFormat;
        assert_eq!(fmt.extract_title("No heading here"), None);
    }

    #[test]
    fn md_extract_headings_skips_front_matter() {
        let fmt = MarkdownFormat;
        let content = "---\ntitle: test\n---\n\n# Heading 1\n\n## Heading 2";
        let headings = fmt.extract_headings(content);
        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].level, 1);
        assert_eq!(headings[0].text, "Heading 1");
        assert_eq!(headings[1].level, 2);
    }

    #[test]
    fn md_extract_headings_max_level_6() {
        let fmt = MarkdownFormat;
        let content = "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n####### Not heading";
        let headings = fmt.extract_headings(content);
        assert_eq!(headings.len(), 6);
    }
}
