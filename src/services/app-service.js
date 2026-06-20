const invoke = () => window.__TAURI__.core.invoke;

/**
 * 应用元信息与更新检查服务。
 * 版本号取自 tauri.conf.json（运行期唯一来源），检查更新走 Rust 端代理以规避 CORS / CSP。
 */

/// 应用主页（内置，与后端 commands::app::HOMEPAGE_URL 保持一致）。
export const HOMEPAGE_URL = 'http://www.fangmou.com/docforge';

/// 获取应用版本号。
export async function getAppVersion() {
  return window.__TAURI__.app.getVersion();
}

/// 检查更新：后端请求内置端点比对版本。
/// 返回 { hasUpdate, currentVersion, latestVersion, downloadUrl, notes }。
export async function checkForUpdate() {
  return invoke()('check_for_update');
}

/// 用系统默认程序打开 URL（主页 / 下载页）。
export async function openUrl(url) {
  return invoke()('open_url', { url });
}
