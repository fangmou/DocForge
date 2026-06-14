//! API 密钥安全存储。
//!
//! macOS / Windows：系统钥匙串（keyring crate，Service「docforge」）。
//! Linux：app_config_dir 下的 secrets.json（0600 权限）——避开 secret-service 对
//! D-Bus/libsecret 的运行时依赖，无头/WSL 环境也能用。安全性弱于系统钥匙串
//! （同用户进程可读），但显著优于明文存配置文件。

use std::path::Path;

// 钥匙串 service 名，仅 macOS/Windows 的 keyring backend 使用（Linux 走文件 store）
#[cfg(not(target_os = "linux"))]
pub const SERVICE: &str = "docforge";
pub const AI_ACCOUNT: &str = "ai-api-key";

#[cfg(not(target_os = "linux"))]
mod backend {
    use super::SERVICE;

    pub fn get(account: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set(account: &str, value: &str) -> Result<(), String> {
        keyring::Entry::new(SERVICE, account)
            .map_err(|e| e.to_string())?
            .set_password(value)
            .map_err(|e| e.to_string())
    }

    pub fn remove(account: &str) -> Result<(), String> {
        match keyring::Entry::new(SERVICE, account) {
            Ok(e) => match e.delete_password() {
                Ok(_) => Ok(()),
                Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(e.to_string()),
            },
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(target_os = "linux")]
mod backend {
    use std::collections::HashMap;
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    use std::path::{Path, PathBuf};

    fn store_path(dir: &Path) -> PathBuf {
        dir.join("secrets.json")
    }

    fn read_all(dir: &Path) -> HashMap<String, String> {
        fs::read_to_string(store_path(dir))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn write_all(dir: &Path, map: &HashMap<String, String>) -> Result<(), String> {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let json = serde_json::to_string(map).map_err(|e| e.to_string())?;
        // 原子写：先写临时文件并 sync，再 rename 覆盖。避免 create+truncate 后
        // 进程崩溃留下半截 JSON，导致下次读取解析失败、全部密钥静默丢失。
        let final_path = store_path(dir);
        let tmp_path = dir.join(".secrets.json.tmp");
        {
            let mut f = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(&tmp_path)
                .map_err(|e| e.to_string())?;
            f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
            f.sync_all().map_err(|e| e.to_string())?;
        }
        fs::rename(&tmp_path, &final_path).map_err(|e| e.to_string())
    }

    pub fn get(account: &str, dir: &Path) -> Result<Option<String>, String> {
        Ok(read_all(dir).get(account).cloned())
    }

    pub fn set(account: &str, value: &str, dir: &Path) -> Result<(), String> {
        let mut map = read_all(dir);
        map.insert(account.into(), value.into());
        write_all(dir, &map)
    }

    pub fn remove(account: &str, dir: &Path) -> Result<(), String> {
        let mut map = read_all(dir);
        map.remove(account);
        write_all(dir, &map)
    }
}

/// 读取指定 account 的密钥。dir 在 Linux 用于文件 store，macOS/Windows 忽略。
pub fn get(account: &str, _dir: &Path) -> Result<Option<String>, String> {
    #[cfg(not(target_os = "linux"))]
    {
        backend::get(account)
    }
    #[cfg(target_os = "linux")]
    {
        backend::get(account, _dir)
    }
}

/// 写入密钥。
pub fn set(account: &str, value: &str, _dir: &Path) -> Result<(), String> {
    #[cfg(not(target_os = "linux"))]
    {
        backend::set(account, value)
    }
    #[cfg(target_os = "linux")]
    {
        backend::set(account, value, _dir)
    }
}

/// 删除密钥（不存在视为成功）。
pub fn remove(account: &str, _dir: &Path) -> Result<(), String> {
    #[cfg(not(target_os = "linux"))]
    {
        backend::remove(account)
    }
    #[cfg(target_os = "linux")]
    {
        backend::remove(account, _dir)
    }
}

/// AI API key 的便捷读写（account 固定为 AI_ACCOUNT）。
pub fn get_ai_key(dir: &Path) -> Result<Option<String>, String> {
    get(AI_ACCOUNT, dir)
}
pub fn set_ai_key(dir: &Path, value: &str) -> Result<(), String> {
    set(AI_ACCOUNT, value, dir)
}
pub fn remove_ai_key(dir: &Path) -> Result<(), String> {
    remove(AI_ACCOUNT, dir)
}

#[cfg(test)]
mod tests {
    // Linux 文件 store 的纯逻辑测试（macOS/Windows keychain 需系统服务，不自动测）
    #[cfg(target_os = "linux")]
    mod linux_file_store {
        use super::super::*;
        use std::path::PathBuf;

        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);

        fn test_dir() -> PathBuf {
            // 每次调用唯一目录，避免多线程测试并发写同一文件
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let d = std::env::temp_dir()
                .join(format!("docforge-secrets-test-{}-{}", std::process::id(), n));
            let _ = std::fs::remove_dir_all(&d);
            d
        }

        #[test]
        fn set_get_remove_roundtrip() {
            let dir = test_dir();
            set("acct", "secret-value", &dir).unwrap();
            assert_eq!(get("acct", &dir).unwrap().as_deref(), Some("secret-value"));
            set("acct2", "v2", &dir).unwrap();
            assert_eq!(get("acct2", &dir).unwrap().as_deref(), Some("v2"));
            remove("acct", &dir).unwrap();
            assert_eq!(get("acct", &dir).unwrap(), None);
            assert_eq!(get("acct2", &dir).unwrap().as_deref(), Some("v2"));
            let _ = std::fs::remove_dir_all(&dir);
        }

        #[test]
        fn get_missing_returns_none() {
            let dir = test_dir();
            assert_eq!(get("nope", &dir).unwrap(), None);
            let _ = std::fs::remove_dir_all(&dir);
        }

        #[test]
        fn overwrite_updates_value() {
            let dir = test_dir();
            set("acct", "old", &dir).unwrap();
            set("acct", "new", &dir).unwrap();
            assert_eq!(get("acct", &dir).unwrap().as_deref(), Some("new"));
            let _ = std::fs::remove_dir_all(&dir);
        }

        #[test]
        fn file_permissions_are_0600() {
            use std::os::unix::fs::PermissionsExt;
            let dir = test_dir();
            set("acct", "v", &dir).unwrap();
            let mode = std::fs::metadata(dir.join("secrets.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}
