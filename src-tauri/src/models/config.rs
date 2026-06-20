use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AiConfig {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub max_tokens: u32,
    pub temperature: f32,
    #[serde(default = "default_context_limit")]
    pub context_limit: u32,
}

fn default_context_limit() -> u32 {
    100000
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            endpoint: "https://api.openai.com".into(),
            api_key: String::new(),
            model: "gpt-4o".into(),
            max_tokens: 0,
            temperature: 0.7,
            context_limit: 100000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct EditorConfig {
    pub font_size: u32,
    pub tab_size: u32,
    pub theme: String,
    pub word_wrap: bool,
    pub auto_save_interval: u32,
    pub language: String,
    pub sidebar_width: u32,
    pub vim_mode: bool,
    pub vim_escape_seq: String,
    pub default_view_mode: String,
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            font_size: 14,
            tab_size: 4,
            theme: "light".into(),
            word_wrap: false,
            auto_save_interval: 0,
            language: "zh".into(),
            sidebar_width: 240,
            vim_mode: false,
            vim_escape_seq: "jk".into(),
            default_view_mode: "split".into(),
        }
    }
}

// === 导出配置树 ===

/// 全局 pandoc 工具配置（asciidoc→docx 和 markdown→docx 共用）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PandocConfig {
    pub command_path: String,
    pub command_resolved: String,
}

impl Default for PandocConfig {
    fn default() -> Self {
        Self {
            command_path: "pandoc".into(),
            command_resolved: String::new(),
        }
    }
}

/// PDF 输出配置（asciidoctor-pdf，asciidoc 专有工具）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PdfConfig {
    pub command_path: String,
    pub command_resolved: String,
    pub theme: String,
    pub page_size: String,
    pub fonts_dir: String,
    pub footer_center: String,
    pub cover_image: String,
    pub title_logo_image: String,
    pub page_foreground_image: String,
}

impl Default for PdfConfig {
    fn default() -> Self {
        Self {
            command_path: "asciidoctor-pdf".into(),
            command_resolved: String::new(),
            theme: String::new(),
            page_size: "A4".into(),
            fonts_dir: String::new(),
            footer_center: String::new(),
            cover_image: String::new(),
            title_logo_image: String::new(),
            page_foreground_image: String::new(),
        }
    }
}

/// DOCX 输出选项（command_path 在全局 PandocConfig）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DocxConfig {
    pub reference_doc: String,
}

impl Default for DocxConfig {
    fn default() -> Self {
        Self {
            reference_doc: String::new(),
        }
    }
}

/// AsciiDoc 导出配置（引擎 + 嵌套格式）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AsciidocExportConfig {
    pub enable_diagram: bool,
    pub extra_args: String,
    pub pdf: PdfConfig,
    pub docx: DocxConfig,
}

impl Default for AsciidocExportConfig {
    fn default() -> Self {
        Self {
            enable_diagram: false,
            extra_args: String::new(),
            pdf: PdfConfig::default(),
            docx: DocxConfig::default(),
        }
    }
}

/// 导出总配置（通用 + 按源格式分组）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ExportConfig {
    pub output_dir: String,
    pub output_naming: String,
    pub pandoc: PandocConfig,
    pub asciidoc: AsciidocExportConfig,
}

impl Default for ExportConfig {
    fn default() -> Self {
        Self {
            output_dir: String::new(),
            output_naming: "title".into(),
            pandoc: PandocConfig::default(),
            asciidoc: AsciidocExportConfig::default(),
        }
    }
}

// === 其他配置 ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentFile {
    pub path: String,
    pub opened_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportRecord {
    pub path: String,
    pub format: String,   // "html" | "pdf" | "docx"
    pub exported_at: u64, // Unix 秒
}

/// 返回给前端的导出记录（含文件是否存在标记）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportRecordView {
    #[serde(flatten)]
    pub record: ExportRecord,
    pub exists: bool,
}

/// 工作区标签页状态（用于持久化会话）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabState {
    pub path: String,
    pub scroll_top: u32,
    pub cursor_pos: u32,
    pub is_dirty: bool,
    #[serde(default)]
    pub draft_path: String,  // 有未保存内容时的 draft 文件路径，空串=无
}

/// 工作区会话状态（独立文件存储）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkspaceState {
    pub tabs: Vec<TabState>,
    pub active_file_path: String,
    pub recent_files: Vec<RecentFile>,
    pub export_history: Vec<ExportRecord>,
    pub view_mode: String,
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            tabs: Vec::new(),
            active_file_path: String::new(),
            recent_files: Vec::new(),
            export_history: Vec::new(),
            view_mode: String::new(),
        }
    }
}

/// 用户自定义标记片段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomSnippet {
    pub id: String,
    pub name: String,
    pub template: String,
    pub shortcut: String,
    pub is_inline: bool,
    #[serde(default)]
    pub format: String,  // "adoc" | "md" | "" (空=所有格式)
}

fn default_scene_icon() -> String {
    "✦".into()
}

fn default_scene_behavior() -> String {
    "rewrite".into()
}

/// 用户自定义 AI 场景（与前端内置 AI_ACTIONS 同构：systemPrompt + behavior）。
/// rename_all=camelCase 让 system_prompt ↔ systemPrompt，前端可统一按 camelCase 访问。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAiScene {
    pub id: String,
    pub name: String,
    #[serde(default = "default_scene_icon")]
    pub icon: String,  // emoji/字符，默认 "✦"
    pub system_prompt: String,
    #[serde(default = "default_scene_behavior")]
    pub behavior: String,  // "rewrite"（默认，有原文可对比修改）| "generate"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub ai: AiConfig,
    pub editor: EditorConfig,
    pub export: ExportConfig,
    pub recent_files: Vec<RecentFile>,
    pub current_workspace: String,
    pub recent_workspaces: Vec<RecentFile>,
    pub export_history: Vec<ExportRecord>,
    pub shortcuts: HashMap<String, String>,
    pub custom_snippets: Vec<CustomSnippet>,
    pub custom_ai_scenes: Vec<CustomAiScene>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            ai: AiConfig::default(),
            editor: EditorConfig::default(),
            export: ExportConfig::default(),
            recent_files: Vec::new(),
            current_workspace: String::new(),
            recent_workspaces: Vec::new(),
            export_history: Vec::new(),
            shortcuts: HashMap::new(),
            custom_snippets: Vec::new(),
            custom_ai_scenes: Vec::new(),
        }
    }
}

pub type AppState = AppConfig;
