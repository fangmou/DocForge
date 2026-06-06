const invoke = () => window.__TAURI__.core.invoke;

export async function saveEditorConfig(config) {
  return invoke()('save_editor_config', { config });
}

export async function loadEditorConfig() {
  return invoke()('load_editor_config');
}

// === 导出配置树 ===

/** 加载导出通用配置 + pandoc */
export async function loadExportConfig() {
  return invoke()('load_export_config');
}

/** 保存导出通用配置（output_dir, output_naming） */
export async function saveExportConfig(outputDir, outputNaming) {
  return invoke()('save_export_config', { outputDir, outputNaming });
}

/** 保存全局 pandoc 配置 */
export async function savePandocConfig(config) {
  return invoke()('save_pandoc_config', { config });
}

/** 保存 AsciiDoc 引擎配置 */
export async function saveAsciidocExportConfig(enableDiagram, extraArgs) {
  return invoke()('save_asciidoc_export_config', { enableDiagram, extraArgs });
}

/** 加载 AsciiDoc 引擎配置 */
export async function loadAsciidocExportConfig() {
  return invoke()('load_asciidoc_export_config');
}

/** 保存 PDF 配置（仅 PDF 独有字段） */
export async function savePdfConfig(config) {
  return invoke()('save_pdf_config', { config });
}

/** 加载 PDF 配置 */
export async function loadPdfConfig() {
  return invoke()('load_pdf_config');
}

/** 保存 DOCX 配置（仅 reference_doc） */
export async function saveDocxConfig(config) {
  return invoke()('save_docx_config', { config });
}

/** 加载 DOCX 配置 */
export async function loadDocxConfig() {
  return invoke()('load_docx_config');
}

export async function getDefaultExtraArgs(language) {
  return invoke()('get_default_extra_args', { language });
}

export async function addRecentFile(path, workspacePath) {
  return invoke()('add_recent_file', { path, workspacePath: workspacePath || null });
}

export async function getRecentFiles(workspacePath) {
  return invoke()('get_recent_files', { workspacePath: workspacePath || null });
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

export async function removeRecentWorkspace(path) {
  return invoke()('remove_recent_workspace', { path });
}

export async function saveShortcuts(shortcuts) {
  return invoke()('save_shortcuts', { shortcuts });
}

export async function loadShortcuts() {
  return invoke()('load_shortcuts');
}

// === 自定义标记片段 ===

export async function saveCustomSnippets(snippets) {
  return invoke()('save_custom_snippets', { snippets });
}

export async function loadCustomSnippets() {
  return invoke()('load_custom_snippets');
}

// === 导出历史 ===

export async function addExportHistory(path, format, workspacePath) {
  return invoke()('add_export_history', { path, format, workspacePath: workspacePath || null });
}

export async function getExportHistory(workspacePath) {
  return invoke()('get_export_history', { workspacePath: workspacePath || null });
}

export async function removeExportHistory(path, workspacePath) {
  return invoke()('remove_export_history', { path, workspacePath: workspacePath || null });
}

export async function clearExportHistory(workspacePath) {
  return invoke()('clear_export_history', { workspacePath: workspacePath || null });
}

// === 工作区状态 ===

export async function saveWorkspaceState(workspacePath, state) {
  return invoke()('save_workspace_state', { workspacePath, state });
}

export async function loadWorkspaceState(workspacePath) {
  return invoke()('load_workspace_state', { workspacePath });
}

export async function getDraftDir(workspacePath) {
  return invoke()('get_draft_dir', { workspacePath });
}
