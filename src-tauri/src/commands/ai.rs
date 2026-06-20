use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

use crate::models::config::AppState;
use crate::services::ai_client;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub kind: String,
    pub content: String,
}

/// 钥匙串文件 store 所在目录（Linux 用），与配置文件同目录
fn secrets_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    crate::commands::config::app_config_dir_or_cwd(app)
}

/// 仅当 config.api_key 为空时从钥匙串补 key。
/// 迁移后配置文件不再持有明文 key，钥匙串是唯一权威源；非空则保留（如调用方传入的
/// 临时测试配置），避免钥匙串里的旧值覆盖调用方明确传入的新值。
fn fill_api_key(app: &tauri::AppHandle, config: &mut crate::models::config::AiConfig) {
    if !config.api_key.is_empty() {
        return;
    }
    if let Ok(Some(k)) = crate::services::secrets::get_ai_key(&secrets_dir(app)) {
        if !k.is_empty() {
            config.api_key = k;
        }
    }
}

#[tauri::command]
pub async fn stream_chat_completion(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    messages: Vec<ai_client::ChatMessage>,
    system_prompt: Option<String>,
) -> Result<String, String> {
    let mut config = state
        .lock()
        .map_err(|e| format!("获取配置失败: {}", e))?
        .ai
        .clone();
    fill_api_key(&app, &mut config);

    let result = ai_client::stream_completion_realtime(
        &config,
        &messages,
        system_prompt.as_deref(),
        |token| {
            let _ = app.emit(
                "ai-stream-chunk",
                StreamEvent {
                    kind: "token".into(),
                    content: token.to_string(),
                },
            );
        },
    )
    .await
    .map_err(|e| format!("AI请求失败: {}", e))?;

    // 撞到 max_tokens 上限被截断：先通知前端标记当前消息，再发 done 收尾
    if result.truncated {
        let _ = app.emit(
            "ai-stream-chunk",
            StreamEvent {
                kind: "truncated".into(),
                content: String::new(),
            },
        );
    }

    let _ = app.emit(
        "ai-stream-chunk",
        StreamEvent {
            kind: "done".into(),
            content: result.content.clone(),
        },
    );

    Ok(result.content)
}

#[tauri::command]
pub async fn test_ai_connection(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    config: Option<crate::models::config::AiConfig>,
) -> Result<bool, String> {
    // 传入 config（设置面板当前 UI 值）时基于它测试，不持久化；
    // 未传时用已保存的 AppState（兼容旧调用）。api_key 为空则从钥匙串补。
    let mut cfg = if let Some(c) = config {
        c
    } else {
        state
            .lock()
            .map_err(|e| format!("获取配置失败: {}", e))?
            .ai
            .clone()
    };
    fill_api_key(&app, &mut cfg);
    ai_client::test_connection(&cfg)
        .await
        .map_err(|e| format!("连接测试失败: {}", e))
}

#[tauri::command]
pub async fn secrets_get_ai_key(app: tauri::AppHandle) -> Result<Option<String>, String> {
    crate::services::secrets::get_ai_key(&secrets_dir(&app))
}

#[tauri::command]
pub async fn secrets_set_ai_key(app: tauri::AppHandle, value: String) -> Result<(), String> {
    crate::services::secrets::set_ai_key(&secrets_dir(&app), &value)
}

#[tauri::command]
pub async fn secrets_remove_ai_key(app: tauri::AppHandle) -> Result<(), String> {
    crate::services::secrets::remove_ai_key(&secrets_dir(&app))
}
