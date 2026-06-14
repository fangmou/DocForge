//! AI endpoint 安全校验：在发起 AI 请求前拦截危险目标。
//!
//! 策略（适配本软件 BYOK + 本地模型场景）：
//! - 放行 Loopback（127/8、::1）与 Private（10/8、172.16/12、192.168/16）——
//!   本地推理服务 Ollama / LM Studio / MLX 运行在这些网段。
//! - 放行 Public——云端 API（OpenAI 等）正常使用。
//! - 封禁 LinkLocal（169.254.0.0/16、fe80::/10）——含云元数据 169.254.169.254，
//!   可被诱导窃取实例凭据。
//! - 拒绝非 http(s) scheme、URL userinfo（user:pass@host）。

use std::net::IpAddr;
use url::{Host, Url};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpKind {
    Public,
    Private,
    Loopback,
    LinkLocal,
}

/// 纯函数：对单个 IP 归类（手动按段判断，不依赖不稳定 API）
pub fn classify_ip(ip: &IpAddr) -> IpKind {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            if o[0] == 127 {
                IpKind::Loopback
            } else if o[0] == 169 && o[1] == 254 {
                IpKind::LinkLocal // 169.254.0.0/16，含云元数据
            } else if o[0] == 10
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168)
            {
                IpKind::Private
            } else {
                IpKind::Public
            }
        }
        IpAddr::V6(v6) => {
            // IPv4-mapped（::ffff:a.b.c.d）：提取内嵌 v4 走 v4 分类。
            // 否则攻击者可用 http://[::ffff:169.254.169.254] 绕过云元数据封禁。
            if let Some(v4) = v6.to_ipv4_mapped() {
                return classify_ip(&IpAddr::V4(v4));
            }
            let s = v6.segments();
            if v6.is_loopback() {
                IpKind::Loopback // ::1
            } else if (s[0] & 0xffc0) == 0xfe80 {
                IpKind::LinkLocal // fe80::/10
            } else {
                IpKind::Public
            }
        }
    }
}

/// 是否应拒绝：仅封 LinkLocal（云元数据风险），其余放行
fn is_blocked(ip: &IpAddr) -> bool {
    classify_ip(ip) == IpKind::LinkLocal
}

/// 纯函数：解析 endpoint 并做 scheme / userinfo / host 静态校验
fn parse_endpoint(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|e| format!("无效的 endpoint URL: {}", e))?;
    match url.scheme() {
        "http" | "https" => {}
        s => return Err(format!("不允许的 scheme「{}」（仅 http/https）", s)),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("endpoint URL 不允许携带用户名/密码".into());
    }
    if url.host_str().is_none() {
        return Err("endpoint 缺少 host".into());
    }
    Ok(url)
}

/// 校验 AI endpoint：静态字段 + DNS 解析后封 LinkLocal。
///
/// 限制：基础版不防 DNS rebinding（校验与实际请求之间域名解析可能变化）。
/// 但 endpoint 由用户自配（BYOK），rebinding 需用户被诱导配置恶意域名，风险可接受。
/// IP 字面量形式的 endpoint 无此问题。
pub async fn validate_ai_endpoint(raw: &str) -> Result<(), String> {
    let url = parse_endpoint(raw)?;
    let port = url.port_or_known_default().unwrap_or(443);

    // IP 字面量直接分类（经 url::Host 直接取 IpAddr，规避 IPv6 方括号字符串解析问题）；
    // 域名走异步 DNS 解析后逐个分类
    let ips: Vec<IpAddr> = match url.host() {
        Some(Host::Ipv4(v4)) => vec![IpAddr::V4(v4)],
        Some(Host::Ipv6(v6)) => vec![IpAddr::V6(v6)],
        Some(Host::Domain(d)) => tokio::net::lookup_host((d.to_owned(), port))
            .await
            .map_err(|e| format!("无法解析主机「{}」: {}", d, e))?
            .map(|sa| sa.ip())
            .collect(),
        None => return Err("endpoint 缺少 host".into()),
    };

    if ips.is_empty() {
        return Err("主机未解析到任何地址".into());
    }
    for ip in &ips {
        if is_blocked(ip) {
            return Err(format!(
                "endpoint 解析到链路本地/云元数据地址 {}，已拒绝",
                ip
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_ipv4_categories() {
        assert_eq!(classify_ip(&"127.0.0.1".parse().unwrap()), IpKind::Loopback);
        assert_eq!(classify_ip(&"169.254.169.254".parse().unwrap()), IpKind::LinkLocal);
        assert_eq!(classify_ip(&"192.168.1.1".parse().unwrap()), IpKind::Private);
        assert_eq!(classify_ip(&"10.0.0.1".parse().unwrap()), IpKind::Private);
        assert_eq!(classify_ip(&"172.16.0.1".parse().unwrap()), IpKind::Private);
        assert_eq!(classify_ip(&"172.31.255.255".parse().unwrap()), IpKind::Private);
        assert_eq!(classify_ip(&"8.8.8.8".parse().unwrap()), IpKind::Public);
    }

    #[test]
    fn classify_ipv6_categories() {
        assert_eq!(classify_ip(&"::1".parse().unwrap()), IpKind::Loopback);
        assert_eq!(classify_ip(&"fe80::1".parse().unwrap()), IpKind::LinkLocal);
        assert_eq!(classify_ip(&"2606:4700::1".parse().unwrap()), IpKind::Public);
    }

    #[test]
    fn classify_ipv4_mapped_ipv6_is_inner_v4() {
        // IPv4-mapped 形式不应绕过 v4 云元数据封禁
        assert_eq!(
            classify_ip(&"::ffff:169.254.169.254".parse().unwrap()),
            IpKind::LinkLocal
        );
        // 映射到 loopback / private 同样按内嵌 v4 归类
        assert_eq!(classify_ip(&"::ffff:127.0.0.1".parse().unwrap()), IpKind::Loopback);
        assert_eq!(classify_ip(&"::ffff:192.168.1.1".parse().unwrap()), IpKind::Private);
        assert_eq!(classify_ip(&"::ffff:8.8.8.8".parse().unwrap()), IpKind::Public);
    }

    #[test]
    fn parse_rejects_bad_scheme() {
        assert!(parse_endpoint("file:///etc/passwd").is_err());
        assert!(parse_endpoint("ftp://example.com").is_err());
        assert!(parse_endpoint("gopher://x").is_err());
    }

    #[test]
    fn parse_accepts_http_https() {
        assert!(parse_endpoint("https://api.openai.com").is_ok());
        assert!(parse_endpoint("http://localhost:11434").is_ok());
    }

    #[test]
    fn parse_rejects_userinfo() {
        assert!(parse_endpoint("https://user:pass@api.openai.com").is_err());
        assert!(parse_endpoint("http://admin@api.example.com").is_err());
    }

    #[tokio::test]
    async fn validate_allows_loopback_and_private_ip() {
        // 本地模型常用地址（IP 字面量，无需 DNS）
        assert!(validate_ai_endpoint("http://127.0.0.1:11434").await.is_ok()); // Ollama
        assert!(validate_ai_endpoint("http://[::1]:11434").await.is_ok());
        assert!(validate_ai_endpoint("http://192.168.1.100:1234").await.is_ok()); // 局域网模型
    }

    #[tokio::test]
    async fn validate_blocks_metadata_ip() {
        assert!(validate_ai_endpoint("http://169.254.169.254").await.is_err()); // AWS/GCP 元数据
        assert!(validate_ai_endpoint("http://169.254.170.2").await.is_err());
    }

    #[tokio::test]
    async fn validate_blocks_bad_input() {
        assert!(validate_ai_endpoint("file:///etc/passwd").await.is_err());
        assert!(validate_ai_endpoint("https://user:pass@host.com").await.is_err());
    }
}
