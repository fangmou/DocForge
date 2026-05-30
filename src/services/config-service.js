const invoke = () => window.__TAURI__.core.invoke;

export async function saveEditorConfig(config) {
  return invoke()('save_editor_config', { config });
}

export async function loadEditorConfig() {
  return invoke()('load_editor_config');
}

export async function savePdfConfig(config) {
  return invoke()('save_pdf_config', { config });
}

export async function loadPdfConfig() {
  return invoke()('load_pdf_config');
}

export async function addRecentFile(path) {
  return invoke()('add_recent_file', { path });
}

export async function getRecentFiles() {
  return invoke()('get_recent_files');
}

export async function clearRecentFiles() {
  return invoke()('clear_recent_files');
}

export async function setCurrentWorkspace(path) {
  return invoke()('set_current_workspace', { path });
}

export async function getCurrentWorkspace() {
  return invoke()('get_current_workspace');
}

export async function getRecentWorkspaces() {
  return invoke()('get_recent_workspaces');
}

export async function clearRecentWorkspaces() {
  return invoke()('clear_recent_workspaces');
}
