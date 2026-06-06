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

/**
 * 从键盘事件中提取可匹配的键名。
 * Windows WebView2 下 Ctrl+字母键时 e.key 可能返回控制字符（如 '\x05'），
 * 需用 e.code（如 'KeyE'）做后备。
 */
export function keyFromEvent(e) {
  let key = e.key;
  if (key === ' ') return 'Space';
  // 正常可打印字符直接用
  if (key.length === 1 && key.charCodeAt(0) >= 32) return key.toUpperCase();
  // e.key 是控制字符或非单字符（如 'Dead'、'Process'），回退到 e.code
  const code = e.code || '';
  if (code.startsWith('Key')) return code.slice(3);        // 'KeyE' → 'E'
  if (code.startsWith('Digit')) return code.slice(5);      // 'Digit1' → '1'
  if (code.startsWith('Numpad')) return code.slice(6);     // 'NumpadAdd' → 'Add'
  // F1~F12 等直接用 code
  if (code) return code;
  // 最后兜底
  return key.length === 1 ? key.toUpperCase() : key;
}

// 默认快捷键映射：id → { default: 'Ctrl+X', labelKey: 'i18n.key' }
const DEFAULTS = {
  save:             { default: 'Ctrl+S',         labelKey: 'shortcuts.save' },
  newFile:          { default: 'Ctrl+N',         labelKey: 'shortcuts.newFile' },
  undo:             { default: 'Ctrl+Z',         labelKey: 'shortcuts.undo' },
  redo:             { default: 'Ctrl+Shift+Z',   labelKey: 'shortcuts.redo' },
  closeTab:         { default: 'Ctrl+W',         labelKey: 'shortcuts.closeTab' },
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
  toggleVimMode:    { default: 'Alt+V',          labelKey: 'shortcuts.toggleVimMode' },
  setViewSplit:     { default: 'Alt+Shift+1',    labelKey: 'shortcuts.setViewSplit' },
  setViewEdit:      { default: 'Alt+Shift+2',    labelKey: 'shortcuts.setViewEdit' },
  setViewPreview:   { default: 'Alt+Shift+3',    labelKey: 'shortcuts.setViewPreview' },
  exportHtml:       { default: 'Ctrl+Shift+E',   labelKey: 'shortcuts.exportHtml' },
  exportPdf:        { default: 'Ctrl+Shift+P',   labelKey: 'shortcuts.exportPdf' },
  exportDocx:       { default: 'Ctrl+Shift+D',   labelKey: 'shortcuts.exportDocx' },
  // 编辑/标记快捷键
  toggleLineComment:  { default: 'Ctrl+/',         labelKey: 'shortcuts.toggleLineComment' },
  toggleBlockComment: { default: 'Ctrl+Shift+/',   labelKey: 'shortcuts.toggleBlockComment' },
  markupBold:         { default: 'Ctrl+B',         labelKey: 'shortcuts.markupBold' },
  markupItalic:       { default: 'Ctrl+I',         labelKey: 'shortcuts.markupItalic' },
  markupMono:         { default: 'Ctrl+Shift+`',   labelKey: 'shortcuts.markupMono' },
  markupLink:         { default: 'Ctrl+K',         labelKey: 'shortcuts.markupLink' },
  alignTable:         { default: 'Alt+Shift+T',    labelKey: 'shortcuts.alignTable' },
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

  /** 获取 CodeMirror keymap 格式的绑定（Mod 代替 Ctrl，`-` 分隔，末键小写） */
  getCmKey(id) {
    const raw = this.getShortcut(id);
    if (!raw) return '';
    return raw.split('+').map((p, i, arr) => {
      if (p === 'Ctrl') return 'Mod';
      if (i === arr.length - 1 && p.length === 1) return p.toLowerCase();
      return p;
    }).join('-');
  }

  /** 将键盘事件转换为组合键字符串，与当前绑定匹配 */
  matchEvent(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    const key = keyFromEvent(e);
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
