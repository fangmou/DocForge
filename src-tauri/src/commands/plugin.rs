use serde::Serialize;
use tokio::fs;

#[derive(Debug, Clone, Serialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
}

/// 扫描工作区插件目录
#[tauri::command]
pub async fn list_plugins(workspace_root: String) -> Result<Vec<PluginInfo>, String> {
    let plugin_dir = format!("{}/.docforge/plugins", workspace_root.trim_end_matches('/'));
    let mut plugins = Vec::new();

    let mut entries = match fs::read_dir(&plugin_dir).await {
        Ok(e) => e,
        Err(_) => return Ok(plugins),
    };

    // 读取启用状态
    let state_path = format!("{}/_state.json", plugin_dir);
    let state: std::collections::HashMap<String, bool> = match fs::read_to_string(&state_path).await {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(_) => std::collections::HashMap::new(),
    };

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("遍历插件目录失败: {}", e))?
    {
        if !entry.file_type().await.map(|ft| ft.is_dir()).unwrap_or(false) {
            continue;
        }
        let manifest_path = entry.path().join("plugin.json");
        if let Ok(json) = fs::read_to_string(&manifest_path).await {
            if let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&json) {
                let id = manifest["id"].as_str().unwrap_or("").to_string();
                if id.is_empty() { continue; }
                let name = manifest["name"].as_str().unwrap_or(&id).to_string();
                let version = manifest["version"].as_str().unwrap_or("0.1.0").to_string();
                let enabled = state.get(&id).copied().unwrap_or(true);
                plugins.push(PluginInfo { id, name, version, enabled });
            }
        }
    }

    Ok(plugins)
}

/// 读取插件主文件内容
#[tauri::command]
pub async fn read_plugin_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path)
        .await
        .map_err(|e| format!("读取插件文件失败: {}", e))
}

/// 切换插件启用/禁用状态
#[tauri::command]
pub async fn toggle_plugin(workspace_root: String, plugin_id: String, enabled: bool) -> Result<(), String> {
    let plugin_dir = format!("{}/.docforge/plugins", workspace_root.trim_end_matches('/'));
    let state_path = format!("{}/_state.json", plugin_dir);

    let mut state: std::collections::HashMap<String, bool> = match fs::read_to_string(&state_path).await {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(_) => std::collections::HashMap::new(),
    };

    if enabled {
        state.remove(&plugin_id);
    } else {
        state.insert(plugin_id, false);
    }

    let json = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&state_path, json)
        .await
        .map_err(|e| format!("写入状态失败: {}", e))
}
