/// 将路径分隔符统一为 `/`。
/// Windows/WSL 环境下 Rust 返回 `\` 分隔的 UNC 路径（如 `\\wsl.localhost\...`），
/// 前端 JavaScript 的 `split('/')` 等操作无法处理，需在后端统一转换。
pub fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

/// 判断是否为 WSL UNC 路径（如 `//wsl.localhost/Ubuntu-22.04/home/...`）
pub fn is_wsl_path(path: &str) -> bool {
    path.starts_with("//wsl.localhost/") || path.starts_with("//wsl/")
}

/// 从 WSL UNC 路径中提取发行版名称。
/// `//wsl.localhost/Ubuntu-22.04/home/user/file` → `Some("Ubuntu-22.04")`
/// 非 WSL 路径返回 None。
pub fn wsl_distro(path: &str) -> Option<&str> {
    let rest = path
        .strip_prefix("//wsl.localhost/")
        .or_else(|| path.strip_prefix("//wsl/"))?;
    let slash_pos = rest.find('/')?;
    Some(&rest[..slash_pos])
}

/// 将 WSL UNC 路径转为 Linux 本地路径。
/// `//wsl.localhost/Ubuntu-22.04/home/user/file` → `/home/user/file`
/// 非 WSL 路径原样返回。
pub fn wsl_to_linux_path(path: &str) -> String {
    let rest = path
        .strip_prefix("//wsl.localhost/")
        .or_else(|| path.strip_prefix("//wsl/"));
    match rest {
        Some(r) => {
            // 跳过发行版名称段（第一个 `/` 之前的部分）
            if let Some(slash_pos) = r.find('/') {
                format!("/{}", &r[slash_pos + 1..])
            } else {
                format!("/{}", r)
            }
        }
        None => path.to_string(),
    }
}

/// 将 Windows 本地路径转为 WSL 内可访问的路径。
/// `C:\Users\user\file.adoc` → `/mnt/c/Users/user/file.adoc`
/// `C:/Users/user/file.adoc` → `/mnt/c/Users/user/file.adoc`
/// 非 Windows 盘符路径（不以单字母冒号开头）原样返回。
pub fn windows_to_wsl_path(path: &str) -> String {
    // 匹配 C:/... 或 D:\... 等盘符路径
    let bytes = path.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
    {
        let drive = (bytes[0] as char).to_ascii_lowercase();
        let rest = path[3..].replace('\\', "/");
        format!("/mnt/{}/{}", drive, rest)
    } else {
        path.to_string()
    }
}

/// 将 `/mnt/X/...` 格式的 WSL 路径转为 Windows 盘符路径（反向转换）。
/// `/mnt/c/Users/user/file` → `C:/Users/user/file`
/// 非 /mnt/ 路径原样返回。
#[cfg(target_os = "windows")]
pub fn wsl_to_windows_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("/mnt/") {
        let bytes = rest.as_bytes();
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b'/' {
            let drive = (bytes[0] as char).to_ascii_uppercase();
            return format!("{}:/{}", drive, &rest[2..]);
        }
    }
    path.to_string()
}
