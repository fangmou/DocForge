use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

use crate::models::config::AppState;
use crate::services::ai_client;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub kind: String,
    pub content: String,
}

#[tauri::command]
pub async fn stream_chat_completion(
    app: tauri::AppHandle,
    state: State<'_, std::sync::Mutex<AppState>>,
    prompt: String,
    system_prompt: Option<String>,
) -> Result<String, String> {
    let config = state.lock().map_err(|e| format!("获取配置失败: {}", e))?.ai.clone();

    let full_response = ai_client::stream_completion_realtime(
        &config,
        &prompt,
        system_prompt.as_deref(),
        |token| {
            let _ = app.emit("ai-stream-chunk", StreamEvent {
                kind: "token".into(),
                content: token.to_string(),
            });
        },
    )
    .await
    .map_err(|e| format!("AI请求失败: {}", e))?;

    let _ = app.emit("ai-stream-chunk", StreamEvent {
        kind: "done".into(),
        content: full_response.clone(),
    });

    Ok(full_response)
}

#[tauri::command]
pub async fn test_ai_connection(
    state: State<'_, std::sync::Mutex<AppState>>,
) -> Result<bool, String> {
    let config = state.lock().map_err(|e| format!("获取配置失败: {}", e))?.ai.clone();
    ai_client::test_connection(&config)
        .await
        .map_err(|e| format!("连接测试失败: {}", e))
}
