use crate::models::config::AiConfig;
use reqwest::Client;
use serde_json::json;
use once_cell::sync::Lazy;
use futures_util::StreamExt;

static HTTP_CLIENT: Lazy<Client> = Lazy::new(Client::new);

fn build_url(endpoint: &str, path: &str) -> String {
    format!("{}{}", endpoint.trim_end_matches('/'), path)
}

/// 真流式：每个token立即通过回调推送
pub async fn stream_completion_realtime<F>(
    config: &AiConfig,
    prompt: &str,
    system_prompt: Option<&str>,
    mut on_token: F,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>>
where
    F: FnMut(&str) + Send,
{
    let url = build_url(&config.endpoint, "/v1/chat/completions");

    let mut messages = vec![];
    if let Some(sys) = system_prompt {
        messages.push(json!({"role": "system", "content": sys}));
    }
    messages.push(json!({"role": "user", "content": prompt}));

    let body = json!({
        "model": config.model,
        "messages": messages,
        "max_tokens": config.max_tokens,
        "temperature": config.temperature,
        "stream": true,
    });

    let response = HTTP_CLIENT
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API返回错误 {}: {}", status, text).into());
    }

    let mut full_response = String::new();
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // 按行解析SSE
        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim_end_matches('\r').to_string();
            buffer = buffer[pos + 1..].to_string();

            if !line.starts_with("data: ") {
                continue;
            }
            let data = &line[6..];
            if data == "[DONE]" {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                    if !content.is_empty() {
                        on_token(content);
                        full_response.push_str(content);
                    }
                }
            }
        }
    }

    Ok(full_response)
}

pub async fn test_connection(config: &AiConfig) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let url = build_url(&config.endpoint, "/v1/models");

    let response = HTTP_CLIENT
        .get(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .send()
        .await?;

    Ok(response.status().is_success())
}
