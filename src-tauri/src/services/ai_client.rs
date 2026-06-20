use crate::models::config::AiConfig;
use reqwest::Client;
use serde_json::json;
use once_cell::sync::Lazy;
use futures_util::StreamExt;
use crate::services::net::validate_ai_endpoint;
use serde::Deserialize;

/// 一轮对话消息（role: "user"|"assistant"）。前端传入完整历史，AI 跨轮记忆。
#[derive(Debug, Clone, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// 流式补全结果：content 为完整文本，truncated 标记是否因撞到 max_tokens 上限被截断
///（finish_reason == "length"）。供上层在 UI 上提示用户，而非默默截断。
#[derive(Debug, Clone)]
pub struct StreamResult {
    pub content: String,
    pub truncated: bool,
}

static HTTP_CLIENT: Lazy<Client> = Lazy::new(Client::new);

fn build_url(endpoint: &str, path: &str) -> String {
    let base = endpoint.trim_end_matches('/');
    // 分离 base 尾部的 query/fragment，避免「?team=x」干扰版本段判断；
    // 拼接时把 query/fragment 移到 path 之后（请求参数属于 path 而非 base 路径）。
    let (main, suffix) = match base.find(|c| c == '?' || c == '#') {
        Some(i) => (&base[..i], &base[i..]),
        None => (base, ""),
    };
    // main 已含版本段（如 /v1、/v4）时，path 去掉 /v1 前缀避免重复拼接。
    // 例：main ".../paas/v4" + path "/v1/chat/completions" -> ".../paas/v4/chat/completions"
    let has_version = main
        .rsplit('/')
        .next()
        .map(|seg| {
            seg.starts_with('v')
                && seg.len() > 1
                && seg[1..].chars().all(|c| c.is_ascii_digit())
        })
        .unwrap_or(false);
    let path = if has_version && path.starts_with("/v1/") {
        &path[3..]
    } else {
        path
    };
    format!("{}{}{}", main, path, suffix)
}

/// 解析一行 SSE 的 data 负载（已去掉 "data: " 前缀）。
/// 返回 (增量内容, finish_reason)，二者皆可能为 None：
/// - `[DONE]` 哨兵或解析失败 → (None, None)
/// - 普通增量 chunk → (Some(content), None)
/// - 末尾收尾 chunk → (None, Some("stop"|"length"|...))
fn parse_sse_data(data: &str) -> Option<(Option<String>, Option<String>)> {
    if data == "[DONE]" {
        return Some((None, None));
    }
    let parsed: serde_json::Value = serde_json::from_str(data).ok()?;
    let content = parsed["choices"][0]["delta"]["content"]
        .as_str()
        .map(|s| s.to_string());
    let finish = parsed["choices"][0]["finish_reason"]
        .as_str()
        .map(|s| s.to_string());
    Some((content, finish))
}

/// 真流式：每个token立即通过回调推送
pub async fn stream_completion_realtime<F>(
    config: &AiConfig,
    messages: &[ChatMessage],
    system_prompt: Option<&str>,
    mut on_token: F,
) -> Result<StreamResult, Box<dyn std::error::Error + Send + Sync>>
where
    F: FnMut(&str) + Send,
{
    validate_ai_endpoint(&config.endpoint).await?;
    let url = build_url(&config.endpoint, "/v1/chat/completions");

    let mut req_messages = vec![];
    if let Some(sys) = system_prompt {
        req_messages.push(json!({"role": "system", "content": sys}));
    }
    for m in messages {
        req_messages.push(json!({"role": m.role, "content": m.content}));
    }

    let mut body = json!({
        "model": config.model,
        "messages": req_messages,
        "temperature": config.temperature,
        "stream": true,
    });
    // max_tokens = 0 表示不限（交由模型上限），避免长输出被截断
    if config.max_tokens > 0 {
        body["max_tokens"] = json!(config.max_tokens);
    }

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
    let mut truncated = false;
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
            if let Some((content, finish)) = parse_sse_data(data) {
                if let Some(c) = content {
                    if !c.is_empty() {
                        on_token(&c);
                        full_response.push_str(&c);
                    }
                }
                // finish_reason == "length" 表示撞到 max_tokens 上限被截断（而非自然结束）
                if finish.as_deref() == Some("length") {
                    truncated = true;
                }
            }
        }
    }

    Ok(StreamResult {
        content: full_response,
        truncated,
    })
}

pub async fn test_connection(config: &AiConfig) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    validate_ai_endpoint(&config.endpoint).await?;
    let url = build_url(&config.endpoint, "/v1/models");

    let response = HTTP_CLIENT
        .get(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .send()
        .await?;

    Ok(response.status().is_success())
}

#[cfg(test)]
mod tests {
    use super::{build_url, parse_sse_data};

    #[test]
    fn parse_sse_data_token_chunk() {
        let (content, finish) =
            parse_sse_data(r#"{"choices":[{"delta":{"content":"你好"}}]}"#).unwrap();
        assert_eq!(content.as_deref(), Some("你好"));
        assert_eq!(finish, None);
    }

    #[test]
    fn parse_sse_data_finish_length_marks_truncation() {
        let data = r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#;
        let (content, finish) = parse_sse_data(data).unwrap();
        assert_eq!(content, None);
        assert_eq!(finish.as_deref(), Some("length"));
    }

    #[test]
    fn parse_sse_data_finish_stop() {
        let data = r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#;
        let (_, finish) = parse_sse_data(data).unwrap();
        assert_eq!(finish.as_deref(), Some("stop"));
    }

    #[test]
    fn parse_sse_data_done_and_invalid() {
        assert_eq!(parse_sse_data("[DONE]"), Some((None, None)));
        assert_eq!(parse_sse_data("not json"), None);
    }

    #[test]
    fn build_url_plain_base_keeps_v1() {
        // OpenAI 默认 base（无版本段），path 保留 /v1
        assert_eq!(
            build_url("https://api.openai.com", "/v1/chat/completions"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            build_url("https://api.openai.com/", "/v1/models"),
            "https://api.openai.com/v1/models"
        );
    }

    #[test]
    fn build_url_versioned_endpoint_strips_v1() {
        // 智谱 v4 endpoint（已含版本段），path 去掉 /v1 前缀
        assert_eq!(
            build_url("https://open.bigmodel.cn/api/coding/paas/v4", "/v1/chat/completions"),
            "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions"
        );
        assert_eq!(
            build_url("https://open.bigmodel.cn/api/coding/paas/v4", "/v1/models"),
            "https://open.bigmodel.cn/api/coding/paas/v4/models"
        );
    }

    #[test]
    fn build_url_explicit_v1_no_duplicate() {
        // endpoint 显式含 /v1，不重复拼接
        assert_eq!(
            build_url("https://api.openai.com/v1", "/v1/chat/completions"),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    #[test]
    fn build_url_endpoint_with_query_or_fragment() {
        // endpoint 带 query/fragment：版本段判断不被参数误判，参数移到 path 之后
        assert_eq!(
            build_url("https://gateway.example.com/v1?team=x", "/v1/chat/completions"),
            "https://gateway.example.com/v1/chat/completions?team=x"
        );
        assert_eq!(
            build_url("https://host.com?k=v", "/v1/models"),
            "https://host.com/v1/models?k=v"
        );
        // fragment 同理
        assert_eq!(
            build_url("https://host.com/v1#frag", "/v1/models"),
            "https://host.com/v1/models#frag"
        );
    }
}
