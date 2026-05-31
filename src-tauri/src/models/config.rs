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
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            endpoint: "https://api.openai.com".into(),
            api_key: String::new(),
            model: "gpt-4o".into(),
            max_tokens: 2048,
            temperature: 0.7,
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
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            font_size: 14,
            tab_size: 4,
            theme: "light".into(),
            word_wrap: false,
            auto_save_interval: 3000,
            language: "zh".into(),
            sidebar_width: 240,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PdfConfig {
    pub command_path: String,
    pub output_dir: String,
    pub output_naming: String,
    pub enable_diagram: bool,
    pub extra_args: String,
    pub theme: String,
    pub page_size: String,
    pub fonts_dir: String,
    pub footer_center: String,
    pub cover_image: String,
}

impl Default for PdfConfig {
    fn default() -> Self {
        Self {
            command_path: "asciidoctor-pdf".into(),
            output_dir: String::new(),
            output_naming: "title".into(),
            enable_diagram: false,
            extra_args: String::new(),
            theme: String::new(),
            page_size: "A4".into(),
            fonts_dir: String::new(),
            footer_center: String::new(),
            cover_image: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentFile {
    pub path: String,
    pub opened_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub ai: AiConfig,
    pub editor: EditorConfig,
    pub pdf: PdfConfig,
    pub recent_files: Vec<RecentFile>,
    pub current_workspace: String,
    pub recent_workspaces: Vec<RecentFile>,
    pub shortcuts: HashMap<String, String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            ai: AiConfig::default(),
            editor: EditorConfig::default(),
            pdf: PdfConfig::default(),
            recent_files: Vec::new(),
            current_workspace: String::new(),
            recent_workspaces: Vec::new(),
            shortcuts: HashMap::new(),
        }
    }
}

pub type AppState = AppConfig;
