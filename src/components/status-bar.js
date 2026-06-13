import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { editorState } from '../services/editor-state.js';
import { eventBus } from '../services/event-bus.js';
import { t } from '../services/i18n.js';
import { linkIndex } from '../services/link-index.js';

// 与 toolbar-main 统一的 Lucide 风格 SVG 图标（小尺寸 11px）
const miniIcon = (paths) => `<svg class="mini-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const icons = {
  link: miniIcon('<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>'),
  tags: miniIcon('<path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><circle cx="7" cy="7" r="1.5"/>'),
  columns: miniIcon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>'),
  edit: miniIcon('<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
  eye: miniIcon('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
};

// 检测编码：检查 BOM 或回退 UTF-8
function detectEncoding(content) {
  if (!content) return 'UTF-8';
  if (content.charCodeAt(0) === 0xFEFF) return 'UTF-8 BOM';
  return 'UTF-8';
}

// 根据扩展名检测文件类型
function detectFileType(path) {
  if (!path) return '';
  if (path.startsWith('__untitled_')) return 'AsciiDoc';
  const ext = path.split('.').pop().toLowerCase();
  const map = { adoc: 'AsciiDoc', asc: 'AsciiDoc', ad: 'AsciiDoc', txt: 'Plain Text', md: 'Markdown' };
  return map[ext] || ext.toUpperCase();
}

class StatusBar extends LitElement {
  static properties = {
    filePath: { type: String },
    line: { type: Number },
    col: { type: Number },
    totalLines: { type: Number },
    words: { type: Number },
    isDirty: { type: Boolean },
    encoding: { type: String },
    fileType: { type: String },
    message: { type: String },
    backlinkCount: { type: Number },
    tagCount: { type: Number },
    vimMode: { type: String },
    viewMode: { type: String },
    _popup: { state: true },
    _vimEnabled: { state: true },
  };

  /** @type {string|null} 导出路径，供点击打开 */
  _exportPath = null;
  /** @type {string} 导出消息前缀（"已导出: "） */
  _exportPrefix = '';

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      height: var(--statusbar-height);
      padding: 0 8px;
      background: var(--bg-2);
      border-top: 1px solid var(--border-subtle);
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--text-3);
      gap: 8px;
      user-select: none;
      --btn-accent: #56b6c2;
    }
    .left, .right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .spacer { flex: 1; }
    .indicator {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--color-success);
      flex-shrink: 0;
    }
    .indicator.dirty {
      background: var(--color-warning);
    }
    .message {
      color: var(--text-1);
      font-weight: 500;
      font-family: var(--font-sans);
    }
    .format-label {
      color: var(--accent);
      font-weight: 600;
    }
    .sep {
      color: var(--border-medium);
    }
    .stat-link {
      cursor: pointer;
      transition: color 0.15s;
    }
    .stat-link:hover {
      color: var(--accent);
    }
    .mini-ic {
      width: 11px;
      height: 11px;
      vertical-align: -1px;
      flex-shrink: 0;
    }
    .msg-export-path {
      color: var(--accent);
      cursor: pointer;
      text-decoration: underline;
      text-decoration-style: dotted;
      text-underline-offset: 2px;
      transition: color 0.15s;
    }
    .msg-export-path:hover {
      color: var(--text-1);
    }
    .msg-reveal-btn {
      display: inline-flex;
      align-items: center;
      cursor: pointer;
      margin-left: 6px;
      color: var(--text-3);
      transition: color 0.15s;
    }
    .msg-reveal-btn:hover {
      color: var(--accent);
    }
    .mode-btn {
      cursor: pointer;
      font-weight: 600;
      padding: 1px 5px;
      border-radius: 3px;
      background: var(--bg-3);
      color: var(--btn-accent);
      transition: background 0.15s, color 0.15s;
    }
    .mode-btn:hover {
      background: var(--btn-accent);
      color: #fff;
    }
    .btn-group {
      display: flex;
      align-items: center;
      gap: 3px;
    }
    .popup-anchor { position: relative; }
    .popup {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 4px;
      background: var(--bg-3);
      border: 1px solid var(--border-medium);
      border-radius: 6px;
      box-shadow: 0 -4px 16px rgba(0,0,0,0.12);
      padding: 4px 0;
      min-width: 100px;
      z-index: 300;
      white-space: nowrap;
    }
    .popup-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 5px 12px;
      border: none;
      background: transparent;
      color: var(--text-2);
      font-size: 11px;
      font-family: var(--font-mono);
      cursor: pointer;
      text-align: left;
    }
    .popup-item:hover {
      background: var(--btn-accent);
      color: #fff;
    }
    .popup-item.active {
      color: var(--btn-accent);
      font-weight: 600;
    }
    .popup-item.active:hover {
      color: #fff;
    }
    .popup-item.sep-line {
      border-top: 1px solid var(--border-subtle);
      margin-top: 4px;
      padding-top: 6px;
    }
    .msg-reveal-btn svg {
      width: 12px;
      height: 12px;
    }
  `;

  constructor() {
    super();
    this.filePath = '';
    this.line = 1;
    this.col = 1;
    this.totalLines = 0;
    this.words = 0;
    this.isDirty = false;
    this.encoding = 'UTF-8';
    this.fileType = '';
    this.message = '';
    this.backlinkCount = 0;
    this.tagCount = 0;
    this.vimMode = '';
    this.viewMode = 'split';
    this._msgTimer = null;
    this._blSeq = 0;
    this._popup = '';
    this._vimEnabled = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._unsub = editorState.onChange(() => this._update());
    this._cursorHandler = ({ line, col }) => {
      this.line = line;
      this.col = col;
    };
    eventBus.on('cursor-changed', this._cursorHandler);
    this._msgHandler = (msg) => {
      // 支持结构化消息 { text, path } 和纯字符串
      if (typeof msg === 'object' && msg !== null) {
        this.message = msg.text || '';
        this._exportPath = msg.path || null;
        // 从完整消息中提取前缀（路径之前的部分）
        if (this._exportPath && this.message.endsWith(this._exportPath)) {
          this._exportPrefix = this.message.slice(0, this.message.length - this._exportPath.length);
        } else {
          this._exportPrefix = this.message;
        }
      } else {
        this.message = msg;
        this._exportPath = null;
        this._exportPrefix = '';
      }
      clearTimeout(this._msgTimer);
      const duration = this._exportPath ? 15000 : 4000;
      this._msgTimer = setTimeout(() => {
        this.message = '';
        this._exportPath = null;
        this._exportPrefix = '';
      }, duration);
    };
    eventBus.on('status-message', this._msgHandler);
    this._langHandler = () => this.requestUpdate();
    eventBus.on('language-changed', this._langHandler);
    this._fileOpenedHandler = () => this._loadBacklinks();
    eventBus.on('file-opened', this._fileOpenedHandler);
    this._fileSavedHandler = () => this._loadBacklinks();
    eventBus.on('file-saved', this._fileSavedHandler);
    this._vimModeHandler = (mode) => {
      this.vimMode = mode || '';
      this._vimEnabled = !!mode;
    };
    eventBus.on('vim-mode-changed', this._vimModeHandler);
    this._viewModeHandler = (mode) => { this.viewMode = mode || 'split'; };
    eventBus.on('view-mode-changed', this._viewModeHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    if (this._cursorHandler) eventBus.off('cursor-changed', this._cursorHandler);
    if (this._msgHandler) eventBus.off('status-message', this._msgHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
    if (this._fileOpenedHandler) eventBus.off('file-opened', this._fileOpenedHandler);
    if (this._fileSavedHandler) eventBus.off('file-saved', this._fileSavedHandler);
    if (this._vimModeHandler) eventBus.off('vim-mode-changed', this._vimModeHandler);
    if (this._viewModeHandler) eventBus.off('view-mode-changed', this._viewModeHandler);
    clearTimeout(this._msgTimer);
    this._exportPath = null;
    this._closePopup();
  }

  _update() {
    const active = editorState.getActiveFile();
    if (active) {
      this.filePath = active.path;
      this.isDirty = active.isDirty;
      this.totalLines = active.content ? active.content.split('\n').length : 0;
      this.words = active.content ? active.content.split(/\s+/).filter(Boolean).length : 0;
      this.encoding = detectEncoding(active.content);
      this.fileType = detectFileType(active.path);
    } else {
      this.filePath = '';
      this.isDirty = false;
      this.totalLines = 0;
      this.words = 0;
      this.encoding = 'UTF-8';
      this.fileType = '';
      this.tagCount = 0;
      this.backlinkCount = 0;
    }
    this.requestUpdate();
    this._loadTagCount();
    this._loadBacklinks();
  }

  async _loadTagCount() {
    const path = editorState.activeFilePath;
    if (!path) { this.tagCount = 0; return; }
    try {
      if (linkIndex.ready) await linkIndex.ready;
      const tags = await linkIndex.getTagsForFile(path);
      this.tagCount = tags.length;
    } catch (_) { this.tagCount = 0; }
  }

  async _loadBacklinks() {
    const seq = ++this._blSeq;
    const path = editorState.activeFilePath;
    if (!path) { this.backlinkCount = 0; return; }
    try {
      if (linkIndex.ready) await linkIndex.ready;
      if (seq !== this._blSeq) return;
      const bls = await linkIndex.getBacklinks(path);
      if (seq !== this._blSeq) return;
      this.backlinkCount = bls.length;
    } catch (_) { if (seq === this._blSeq) this.backlinkCount = 0; }
  }

  render() {
    const isPreview = this.viewMode === 'preview';
    const showVim = !isPreview && this._vimEnabled;
    return html`
      <div class="left">
        ${this.filePath ? html`
          <span class="indicator ${this.isDirty ? 'dirty' : ''}"></span>
        ` : ''}
        <span class="btn-group">
          <span class="popup-anchor">
            <span class="mode-btn" @click=${(e) => this._togglePopup('view', e)}>${unsafeHTML(icons[{ split: 'columns', edit: 'edit', preview: 'eye' }[this.viewMode]])}</span>
            ${this._popup === 'view' ? this._renderViewPopup() : ''}
          </span>
          ${showVim ? html`
            <span class="popup-anchor">
              <span class="mode-btn" @click=${(e) => this._togglePopup('vim', e)}>${this._vimModeLabel(this.vimMode)}</span>
              ${this._popup === 'vim' ? this._renderVimPopup() : ''}
            </span>
          ` : ''}
        </span>
        <span>${t('statusBar.lines', { count: this.totalLines })}</span>
        <span>${t('statusBar.words', { count: this.words })}</span>
        <span class="sep">|</span>
        <span class="stat-link" @click=${() => eventBus.emit('toggle-backlinks')}>${unsafeHTML(icons.link)} ${t('statusBar.backlinks', { count: this.backlinkCount })}</span>
        <span class="stat-link" @click=${() => eventBus.emit('toggle-tags-panel')}>${unsafeHTML(icons.tags)} ${t('statusBar.tags', { count: this.tagCount })}</span>
        ${this.message ? this._renderMessage() : ''}
      </div>
      <div class="spacer"></div>
      <div class="right">
        ${!isPreview ? html`
          <span>${t('statusBar.lineCol', { line: this.line, col: this.col })}</span>
          <span class="sep">|</span>
        ` : ''}
        <span>${this.encoding}</span>
        <span class="sep">|</span>
        <span class="format-label">${this.fileType}</span>
      </div>
    `;
  }

  _renderViewPopup() {
    const modes = ['edit', 'split', 'preview'];
    const info = {
      edit:    { icon: 'edit',    label: 'statusBar.viewEdit' },
      split:   { icon: 'columns', label: 'statusBar.viewSplit' },
      preview: { icon: 'eye',     label: 'statusBar.viewPreview' },
    };
    return html`<div class="popup" style="min-width: 120px">
      ${modes.map(m => html`
        <button class="popup-item ${m === this.viewMode ? 'active' : ''}" @click=${() => this._selectViewMode(m)}>
          ${unsafeHTML(icons[info[m].icon])} ${t(info[m].label)}
        </button>
      `)}
    </div>`;
  }

  _renderVimPopup() {
    const vimModes = [
      { key: 'normal', i18n: 'statusBar.vimNormal', action: () => eventBus.emit('set-vim-submode', 'normal') },
      { key: 'insert', i18n: 'statusBar.vimInsert', action: () => eventBus.emit('set-vim-submode', 'insert') },
      { key: 'visual', i18n: 'statusBar.vimVisual', action: () => eventBus.emit('set-vim-submode', 'visual') },
    ];
    // 当前 vim 子模式映射到上拉菜单中的 active 项
    const currentVimKey = this._vimToPopupKey(this.vimMode);
    return html`<div class="popup">
      ${vimModes.map(m => html`
        <button class="popup-item ${m.key === currentVimKey ? 'active' : ''}" @click=${() => { m.action(); this._closePopup(); }}>${t(m.i18n)}</button>
      `)}
      <button class="popup-item sep-line" @click=${() => { eventBus.emit('set-vim-mode', { enabled: false }); this._closePopup(); }}>${t('statusBar.cmNormal')}</button>
    </div>`;
  }

  /** vim 子模式映射到上拉菜单显示 key */
  _vimToPopupKey(mode) {
    if (mode === 'normal') return 'normal';
    if (mode === 'insert') return 'insert';
    if (mode === 'replace') return 'insert';
    // visual, visual-line, visual-block → visual
    if (mode?.startsWith('visual')) return 'visual';
    return null;
  }

  _togglePopup(name, e) {
    e.stopPropagation();
    // 先清理旧 handler，避免切换菜单时泄漏
    if (this._popup && this._popup !== name) this._closePopup();
    this._popup = this._popup === name ? '' : name;
    // 绑定全局点击关闭
    if (this._popup) {
      this._closePopupHandler = (ev) => {
        if (!this.contains(ev.target)) this._closePopup();
      };
      setTimeout(() => document.addEventListener('click', this._closePopupHandler), 0);
    } else {
      this._closePopup();
    }
  }

  _closePopup() {
    this._popup = '';
    if (this._closePopupHandler) {
      document.removeEventListener('click', this._closePopupHandler);
      this._closePopupHandler = null;
    }
  }

  _selectViewMode(mode) {
    this._closePopup();
    eventBus.emit('set-view-mode', mode);
  }

  /** 渲染状态消息：普通文本或带可点击路径的导出消息 */
  _renderMessage() {
    if (!this._exportPath) {
      return html`<span class="message">${this.message}</span>`;
    }
    // 用 i18n 直接生成前缀（"已导出: "），不依赖正则匹配
    const prefix = this._exportPrefix || this.message;
    return html`
      <span class="message">
        ${prefix}<span class="msg-export-path" @click=${this._openExport} title="${t('statusBar.openFile')}">${this._exportPath}</span>
        <span class="msg-reveal-btn" data-action="copy" @click=${this._copyExport} title="${t('statusBar.copyPath')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        </span>
        <span class="msg-reveal-btn" @click=${this._revealExport} title="${t('statusBar.revealInShell')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        </span>
      </span>
    `;
  }

  /** 用系统默认程序打开导出文件 */
  async _openExport() {
    if (!this._exportPath) return;
    try {
      await window.__TAURI__.core.invoke('open_path', { path: this._exportPath });
    } catch (e) {
      console.error('打开文件失败:', e);
    }
  }

  /** 复制导出路径到剪贴板 */
  async _copyExport() {
    if (!this._exportPath) return;
    try {
      await navigator.clipboard.writeText(this._exportPath);
      // 短暂闪烁提示复制成功（不覆盖当前导出消息）
      const btn = this.shadowRoot.querySelector('[data-action="copy"]');
      if (btn) { btn.style.color = 'var(--color-success)'; setTimeout(() => { btn.style.color = ''; }, 800); }
    } catch (e) {
      console.error('复制失败:', e);
    }
  }

  /** 在文件管理器中显示导出文件 */
  async _revealExport() {
    if (!this._exportPath) return;
    try {
      await window.__TAURI__.core.invoke('reveal_in_shell', { path: this._exportPath });
    } catch (e) {
      console.error('打开目录失败:', e);
    }
  }

  /** vim 模式名称映射（i18n） */
  _vimModeLabel(mode) {
    const map = {
      normal: 'statusBar.vimNormal',
      insert: 'statusBar.vimInsert',
      visual: 'statusBar.vimVisual',
      'visual-line': 'statusBar.vimVisual',
      'visual-block': 'statusBar.vimVisual',
      replace: 'statusBar.vimInsert',
      operator: 'statusBar.vimOther',
    };
    return t(map[mode] || 'statusBar.vimOther');
  }
}

customElements.define('status-bar', StatusBar);
