/**
 * 快捷键注册中心 — 集中管理所有快捷键映射
 *
 * 持久化走后台 Rust AppConfig.shortcuts (HashMap<String, String>)
 *
 * 用法：
 *   import { shortcutRegistry } from './shortcut-registry.js';
 *   await shortcutRegistry.init();                     // 启动时加载一次
 *   shortcutRegistry.getShortcut('save')               // => 'Ctrl+S'
 *   shortcutRegistry.setShortcut('save', 'Ctrl+W')     // async，自动持久化
 */

import { t } from './i18n.js';

// 默认快捷键映射：id → { default: 'Ctrl+X', labelKey: 'i18n.key' }
const DEFAULTS = {
  save:             { default: 'Ctrl+S',         labelKey: 'shortcuts.save' },
  newFile:          { default: 'Ctrl+N',         labelKey: 'shortcuts.newFile' },
  search:           { default: 'Ctrl+Shift+F',   labelKey: 'shortcuts.search' },
  findReplace:      { default: 'Ctrl+F',         labelKey: 'shortcuts.findReplace' },
  gotoLine:         { default: 'Ctrl+G',         labelKey: 'shortcuts.gotoLine' },
  toggleWordWrap:   { default: 'Alt+W',          labelKey: 'shortcuts.toggleWordWrap' },
  zoomIn:           { default: 'Ctrl+=',         labelKey: 'shortcuts.zoomIn' },
  zoomOut:          { default: 'Ctrl+-',         labelKey: 'shortcuts.zoomOut' },
  zoomReset:        { default: 'Ctrl+0',         labelKey: 'shortcuts.zoomReset' },
  toggleOutline:    { default: 'Alt+O',          labelKey: 'shortcuts.toggleOutline' },
  toggleAI:         { default: 'Ctrl+Alt+A',      labelKey: 'shortcuts.toggleAI' },
  toggleBacklinks:  { default: 'Alt+B',          labelKey: 'shortcuts.toggleBacklinks' },
  toggleGraph:      { default: 'Alt+G',          labelKey: 'shortcuts.toggleGraph' },
  toggleTags:       { default: 'Alt+T',          labelKey: 'shortcuts.toggleTags' },
  togglePreview:    { default: 'Alt+P',          labelKey: 'shortcuts.togglePreview' },
  toggleSidebar:    { default: 'Alt+1',          labelKey: 'shortcuts.toggleSidebar' },
  togglePlugin:     { default: 'Alt+L',          labelKey: 'shortcuts.togglePlugin' },
  exportHtml:       { default: 'Ctrl+Shift+E',   labelKey: 'shortcuts.exportHtml' },
  exportPdf:        { default: 'Ctrl+Shift+P',   labelKey: 'shortcuts.exportPdf' },
};

class ShortcutRegistry {
  constructor() {
    this._overrides = {};
    this._loaded = false;
  }

  /** 从后台加载用户自定义快捷键（应用启动时调用一次） */
  async init() {
    if (this._loaded) return;
    try {
      const { loadShortcuts } = await import('./config-service.js');
      this._overrides = await loadShortcuts();
      // 清除旧版 localStorage 残留
      localStorage.removeItem('docforge-shortcut-overrides');
    } catch (_) {
      this._overrides = {};
    }
    this._loaded = true;
  }

  /** 获取某个快捷键的当前绑定（用户覆盖 > 默认） */
  getShortcut(id) {
    if (this._overrides[id]) return this._overrides[id];
    return DEFAULTS[id]?.default ?? '';
  }

  /** 获取某个快捷键的显示标签（通过 i18n） */
  getLabel(id) {
    const key = DEFAULTS[id]?.labelKey;
    return key ? t(key) : id;
  }

  /** 获取 CodeMirror keymap 格式的绑定（Mod 代替 Ctrl，用于编辑器 keymap） */
  getCmKey(id) {
    const raw = this.getShortcut(id);
    if (!raw) return '';
    return raw.replace(/^Ctrl\b/, 'Mod').replace(/\+Ctrl\b/, '+Mod');
  }

  /** 将键盘事件转换为组合键字符串，与当前绑定匹配 */
  matchEvent(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    let key = e.key;
    if (key === ' ') key = 'Space';
    if (key.length === 1) key = key.toUpperCase();
    parts.push(key);
    const combo = parts.join('+');
    for (const id of Object.keys(DEFAULTS)) {
      if (this.getShortcut(id) === combo) return id;
    }
    return null;
  }

  /** 获取所有快捷键定义列表 [{ id, shortcut, label, defaultShortcut }] */
  getAll() {
    return Object.keys(DEFAULTS).map(id => ({
      id,
      shortcut: this.getShortcut(id),
      label: this.getLabel(id),
      defaultShortcut: DEFAULTS[id].default,
      isCustom: !!this._overrides[id],
    }));
  }

  /** 设置自定义快捷键（空字符串恢复默认），自动持久化到后台 */
  async setShortcut(id, keys) {
    if (!DEFAULTS[id]) return false;
    if (!keys || keys === DEFAULTS[id].default) {
      delete this._overrides[id];
    } else {
      this._overrides[id] = keys;
    }
    await this._persist();
    return true;
  }

  /** 检查快捷键是否已被其他命令占用（排除自身） */
  findConflict(keys, excludeId) {
    for (const [id] of Object.entries(DEFAULTS)) {
      if (id === excludeId) continue;
      if (this.getShortcut(id) === keys) return { id, label: this.getLabel(id) };
    }
    return null;
  }

  /** 重置全部为默认，自动持久化 */
  async resetAll() {
    this._overrides = {};
    await this._persist();
  }

  /** 重置单条为默认，自动持久化 */
  async reset(id) {
    delete this._overrides[id];
    await this._persist();
  }

  async _persist() {
    try {
      const { saveShortcuts } = await import('./config-service.js');
      await saveShortcuts(this._overrides);
    } catch (_) {
      // 后台不可用时静默失败
    }
  }
}

export const shortcutRegistry = new ShortcutRegistry();
