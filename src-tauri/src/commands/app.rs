use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::time::Duration;

/// 应用主页。编译期取自 Cargo.toml 的 `homepage` 字段（单一来源）。
pub const HOMEPAGE_URL: &str = env!("CARGO_PKG_HOMEPAGE");

/// 检查更新端点：发布者自行托管的 JSON，约定结构 `{ version, url, notes? }`。
/// 明文 http：端点可信性依赖网络环境（公共网络下存在中间人篡改风险），属已知权衡——
/// 保持 http 以适应当前服务器现状。
const UPDATE_CHECK_URL: &str = "http://www.fangmou.com/release/docforge/version.json";

/// version.json 反序列化结构。
/// url/notes 用 Option：既兼容字段缺失，也兼容显式 `null`——
/// `#[serde(default)]` 只在字段缺失时生效，对 `{"notes": null}` 这样的显式 null 会反序列化失败。
#[derive(Debug, Deserialize)]
struct UpdateManifest {
    version: String,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    notes: Option<String>,
}

/// 检查更新返回给前端的结果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: String,
    pub notes: String,
}

/// 检查更新：请求内置端点拉取最新版本号，与本地版本比对。
/// 走 Rust 端代理（而非前端 fetch）以规避 CORS 与 CSP（connect-src 不含明文 http）。
/// 网络/解析失败时返回可读错误字符串，由前端友好提示。
#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let current = app.package_info().version.to_string();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(UPDATE_CHECK_URL)
        .send()
        .await
        .map_err(|e| format!("检查更新失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("更新服务返回错误: {}", resp.status()));
    }

    let manifest: UpdateManifest = resp
        .json()
        .await
        .map_err(|e| format!("解析更新信息失败: {}", e))?;

    // 与 release.mjs 的 /^\d+\.\d+\.\d+$/ 校验保持一致：端点版本号必须是严格 x.y.z，
    // 拒绝预发布号（如 1.0.0-beta），避免 compare_versions 容错把非数字段当 0 而静默误判。
    if !is_simple_version(&manifest.version) {
        return Err(format!(
            "更新版本号格式不支持: {}（应为 x.y.z）",
            manifest.version
        ));
    }

    // 端点未提供 url（缺失/null/空串）时回退到主页
    let download_url = manifest
        .url
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(HOMEPAGE_URL)
        .to_string();

    Ok(UpdateCheckResult {
        has_update: compare_versions(&manifest.version, &current) == Ordering::Greater,
        current_version: current,
        latest_version: manifest.version,
        download_url,
        notes: manifest.notes.unwrap_or_default(),
    })
}

/// 仅允许 http/https，拒绝 file:/data:/javascript: 等可被系统路由到危险处理器的 scheme。
/// open_url 的输入之一来自外部 version.json 的 url 字段，必须限制 scheme。
fn is_http_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// 严格 x.y.z（三段纯数字）校验，与 release.mjs 的格式校验一致。
fn is_simple_version(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

/// 用系统默认程序打开 URL（主页 / 下载页）。
/// 输入限 http/https；Windows 用 explorer.exe 而非 cmd /c start——
/// 后者会把 URL 中的 `&`（如查询参数 ?a=1&b=2）当作命令分隔符，构成参数注入。
#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    if !is_http_url(&url) {
        return Err("仅支持 http/https 链接".into());
    }
    #[cfg(target_os = "linux")]
    {
        tokio::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        tokio::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        // explorer.exe 以标准 argv 接收 URL，不经过 cmd shell 解析，
        // 避免 cmd /c start 把 URL 中的 & 当命令分隔符导致的注入。
        tokio::process::Command::new("explorer.exe")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    }
    Ok(())
}

/// 轻量语义化版本比较：按 '.' 分段为数值逐段比较，缺位补 0。
/// 仅设计用于 x.y.z（入口 is_simple_version 已校验）；保留容错以增强健壮性。
/// 例：0.1.0 < 0.2.0，0.1 == 0.1.0，1.2.10 > 1.2.9，0.10.0 > 0.9.0。
fn compare_versions(a: &str, b: &str) -> Ordering {
    let parse = |s: &str| -> Vec<u64> {
        s.split('.').map(|seg| seg.parse::<u64>().unwrap_or(0)).collect()
    };
    let va = parse(a);
    let vb = parse(b);
    let len = va.len().max(vb.len());
    for i in 0..len {
        let na = va.get(i).copied().unwrap_or(0);
        let nb = vb.get(i).copied().unwrap_or(0);
        match na.cmp(&nb) {
            Ordering::Equal => continue,
            other => return other,
        }
    }
    Ordering::Equal
}

#[cfg(test)]
mod tests {
    use super::{compare_versions, is_http_url, is_simple_version};
    use std::cmp::Ordering;

    #[test]
    fn compare_versions_basic() {
        assert_eq!(compare_versions("0.1.0", "0.2.0"), Ordering::Less);
        assert_eq!(compare_versions("0.2.0", "0.1.0"), Ordering::Greater);
        assert_eq!(compare_versions("0.1.0", "0.1.0"), Ordering::Equal);
    }

    #[test]
    fn compare_versions_numeric_not_lexicographic() {
        // 数值比较：1.2.10 > 1.2.9，0.10.0 > 0.9.0（字典序会判反）
        assert_eq!(compare_versions("1.2.10", "1.2.9"), Ordering::Greater);
        assert_eq!(compare_versions("0.10.0", "0.9.0"), Ordering::Greater);
    }

    #[test]
    fn compare_versions_different_segment_count() {
        // 位数不同，缺位补 0：0.1 == 0.1.0
        assert_eq!(compare_versions("0.1", "0.1.0"), Ordering::Equal);
        assert_eq!(compare_versions("0.1.0.1", "0.1"), Ordering::Greater);
    }

    #[test]
    fn is_http_url_only_allows_http_schemes() {
        assert!(is_http_url("http://example.com"));
        assert!(is_http_url("https://example.com/path?q=1"));
        assert!(is_http_url("HTTP://Example.COM")); // 大小写不敏感
        // 危险 scheme 必须拒绝
        assert!(!is_http_url("file:///etc/passwd"));
        assert!(!is_http_url("data:text/html,<script>"));
        assert!(!is_http_url("javascript:alert(1)"));
        assert!(!is_http_url("//example.com")); // 协议相对
    }

    #[test]
    fn is_simple_version_strict_xyz() {
        assert!(is_simple_version("0.1.0"));
        assert!(is_simple_version("12.345.6"));
        // 与 release.mjs 一致：拒绝预发布/非三段/非数字
        assert!(!is_simple_version("1.0.0-beta"));
        assert!(!is_simple_version("1.0"));
        assert!(!is_simple_version("1.0.0.0"));
        assert!(!is_simple_version("1.0.x"));
        assert!(!is_simple_version(""));
    }
}
