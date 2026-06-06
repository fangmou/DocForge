import { LitElement, html, css, svg } from 'lit';
import { pickDirectory } from '../services/file-service.js';
import { eventBus } from '../services/event-bus.js';
import { editorState } from '../services/editor-state.js';
import { exportToHtml, checkAsciidoctorPdf, exportToPdf, openInBrowser, checkPandoc, exportToDocx, pickDocxFile, importDocx } from '../services/export-service.js';
import { t } from '../services/i18n.js';
import { shortcutRegistry } from '../services/shortcut-registry.js';
import { getFormat } from '../services/format-commands.js';

// Lucide 风格统一 SVG 图标 (viewBox 0 0 24 24, stroke 2)
const icons = {
  menu: svg`<path d="M4 6h16M4 12h16M4 18h16"/>`,
  folder: svg`<path d="M4 20h16a2 2 0 002-2V8a2 2 0 00-2-2h-7.93a2 2 0 01-1.66-.9l-.82-1.2A2 2 0 007.93 3H4a2 2 0 00-2 2v13c0 1.1.9 2 2 2z"/>`,
  plus: svg`<path d="M12 5v14M5 12h14"/>`,
  save: svg`<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>`,
  undo: svg`<path d="M9 14L4 9l5-5"/><path d="M20 20v-7a4 4 0 00-4-4H4"/>`,
  redo: svg`<path d="M15 14l5-5-5-5"/><path d="M4 20v-7a4 4 0 014-4h12"/>`,
  edit: svg`<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
  eye: svg`<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`,
  columns: svg`<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>`,
  wrap: svg`<path d="M3 6h18M3 12h15a3 3 0 110 6h-4m0 0l2-2m-2 2l2 2M3 18h7"/>`,
  search: svg`<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>`,
  list: svg`<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>`,
  sparkles: svg`<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 13l.9 2.7L22.6 16.5l-2.7.8L19 20l-.9-2.7-2.7-.8 2.7-.8z"/>`,
  upload: svg`<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>`,
  settings: svg`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>`,
  sun: svg`<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>`,
  moon: svg`<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>`,
  chevron: svg`<path d="M6 9l6 6 6-6"/>`,
  link: svg`<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>`,
  graph: svg`<circle cx="5" cy="6" r="3"/><circle cx="19" cy="6" r="3"/><circle cx="12" cy="19" r="3"/><path d="M7.5 8l3 7.5M16.5 8l-3 7.5"/>`,
  template: svg`<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>`,
  tags: svg`<path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><circle cx="7" cy="7" r="1.5"/>`,
  bold: svg`<path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"/><path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"/>`,
  italic: svg`<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>`,
  code: svg`<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>`,
};

function icon(name, cls = 'ic') {
  return html`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
}

class ToolbarMain extends LitElement {
  static properties = {
    _activePanel: { state: true },
    _theme: { state: true },
    _currentFormat: { state: true },
    _viewMode: { state: true },
    _dropdown: { state: true }, // 'new' | 'edit' | 'markup' | 'search' | 'export' | ''
  };

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      height: var(--toolbar-height);
      padding: 0 8px;
      background: var(--bg-2);
      border-bottom: 1px solid var(--border-subtle);
      gap: 2px;
      user-select: none;
      flex-shrink: 0;
      position: relative;
    }
    /* 通用按钮 */
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 28px;
      padding: 0 6px;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: var(--text-2);
      cursor: pointer;
      font-size: 12px;
      font-family: var(--font-sans);
      font-weight: 500;
      gap: 3px;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    button:hover {
      background: var(--bg-3);
      color: var(--text-1);
    }
    button:active {
      background: var(--border-subtle);
    }
    /* 带文字的按钮 */
    .btn-text {
      padding: 0 8px;
      font-size: 12px;
      gap: 4px;
    }
    /* SVG 图标 */
    .ic {
      width: 15px;
      height: 15px;
      flex-shrink: 0;
    }
    /* 小箭头图标 */
    .ic-sm {
      width: 11px;
      height: 11px;
      opacity: 0.6;
    }
    /* 激活态 */
    button.on {
      background: var(--bg-3);
      color: var(--accent);
    }
    /* 分隔线 */
    .sep {
      display: inline-block;
      width: 1px;
      height: 18px;
      background: var(--border-subtle);
      margin: 0 4px;
      flex-shrink: 0;
    }
    .spacer { flex: 1; }
    /* 下拉菜单 */
    .dropdown {
      position: absolute;
      top: 100%;
      background: var(--bg-3);
      border: 1px solid var(--border-medium);
      border-radius: 6px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.12);
      padding: 4px 0;
      min-width: 160px;
      z-index: 200;
    }
    .dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 12px;
      border: none;
      border-radius: 0;
      background: transparent;
      color: var(--text-2);
      font-size: 12px;
      cursor: pointer;
      text-align: left;
    }
    .dropdown-item:hover {
      background: var(--accent);
      color: #fff;
    }
    .dropdown-item:hover .ic {
      color: #fff;
    }
    .dropdown-item:hover .shortcut {
      color: rgba(255,255,255,0.6);
    }
    .dropdown-item .label {
      flex: 1;
      text-align: left;
    }
    .dropdown-item .shortcut {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-3);
      margin-left: auto;
    }
    /* 主题按钮 */
    .theme-btn {
      padding: 0 8px;
      border: 1px solid var(--border-subtle);
      border-radius: 5px;
    }
    .theme-btn .ic {
      width: 13px;
      height: 13px;
    }
  `;

  constructor() {
    super();
    this._activePanel = '';
    this._theme = 'light';
    this._currentFormat = null;
    this._viewMode = 'split';
    this._dropdown = '';
    this._langHandler = () => this.requestUpdate();
    this._clickOutside = (e) => {
      if (this._dropdown && !e.composedPath().includes(this)) {
        this._dropdown = '';
      }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    eventBus.on('language-changed', this._langHandler);
    this._panelHandlers = {
      'ai-panel-toggled': (v) => { this._activePanel = v ? 'ai' : (this._activePanel === 'ai' ? '' : this._activePanel); },
      'search-panel-toggled': (v) => { this._activePanel = v ? 'search' : (this._activePanel === 'search' ? '' : this._activePanel); },
      'outline-panel-toggled': (v) => { this._activePanel = v ? 'outline' : (this._activePanel === 'outline' ? '' : this._activePanel); },
      'template-panel-toggled': (v) => { this._activePanel = v ? 'template' : (this._activePanel === 'template' ? '' : this._activePanel); },
      'backlinks-panel-toggled': (v) => { this._activePanel = v ? 'backlinks' : (this._activePanel === 'backlinks' ? '' : this._activePanel); },
      'graph-panel-toggled': (v) => { this._activePanel = v ? 'graph' : (this._activePanel === 'graph' ? '' : this._activePanel); },
      'tags-panel-toggled': (v) => { this._activePanel = v ? 'tags' : (this._activePanel === 'tags' ? '' : this._activePanel); },
      'plugin-panel-toggled': (v) => { this._activePanel = v ? 'plugin' : (this._activePanel === 'plugin' ? '' : this._activePanel); },
    };
    for (const [name, handler] of Object.entries(this._panelHandlers)) {
      eventBus.on(name, handler);
    }
    this._themeHandler = (theme) => { this._theme = theme; };
    eventBus.on('theme-changed', this._themeHandler);
    this._formatHandler = (format) => { this._currentFormat = format; };
    eventBus.on('file-format-changed', this._formatHandler);
    this._viewModeHandler = (mode) => { this._viewMode = mode || 'split'; };
    eventBus.on('view-mode-changed', this._viewModeHandler);
    this._exportHtmlHandler = () => this._exportHtml();
    this._exportPdfHandler = () => this._exportPdf();
    this._exportDocxHandler = () => this._exportDocx();
    eventBus.on('export-html', this._exportHtmlHandler);
    eventBus.on('export-pdf', this._exportPdfHandler);
    eventBus.on('export-docx', this._exportDocxHandler);
    document.addEventListener('click', this._clickOutside);
    import('../services/config-service.js').then(({ loadEditorConfig }) => {
      loadEditorConfig().then(c => { if (c.theme) this._theme = c.theme; }).catch(() => {});
    }).catch(() => {});
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    eventBus.off('language-changed', this._langHandler);
    for (const [name, handler] of Object.entries(this._panelHandlers || {})) {
      eventBus.off(name, handler);
    }
    if (this._themeHandler) eventBus.off('theme-changed', this._themeHandler);
    if (this._formatHandler) eventBus.off('file-format-changed', this._formatHandler);
    if (this._viewModeHandler) eventBus.off('view-mode-changed', this._viewModeHandler);
    if (this._exportHtmlHandler) eventBus.off('export-html', this._exportHtmlHandler);
    if (this._exportPdfHandler) eventBus.off('export-pdf', this._exportPdfHandler);
    if (this._exportDocxHandler) eventBus.off('export-docx', this._exportDocxHandler);
    document.removeEventListener('click', this._clickOutside);
  }

  _togglePanel(panel) {
    this._dropdown = '';
    const isClosing = this._activePanel === panel;
    eventBus.emit('force-close-all-panels');
    this._activePanel = '';
    if (!isClosing) {
      this._activePanel = panel;
      const eventMap = {
        'ai': () => this.dispatchEvent(new CustomEvent('toggle-ai')),
        'search': () => eventBus.emit('toggle-search'),
        'outline': () => eventBus.emit('toggle-outline'),
        'template': () => eventBus.emit('toggle-template-panel'),
        'backlinks': () => eventBus.emit('toggle-backlinks'),
        'graph': () => eventBus.emit('toggle-graph-view'),
        'plugin': () => eventBus.emit('toggle-plugin-manager'),
        'tags': () => eventBus.emit('toggle-tags-panel'),
        'export-history': () => eventBus.emit('toggle-export-history'),
      };
      if (eventMap[panel]) eventMap[panel]();
    }
  }

  _toggleTheme() {
    const next = this._theme === 'dark' ? 'light' : 'dark';
    this._theme = next;
    eventBus.emit('theme-changed', next);
  }

  /** 从菜单打开导出历史面板（强制打开，不走 toggle 逻辑） */
  _openExportHistory() {
    this._dropdown = '';
    this._activePanel = 'export-history';
    eventBus.emit('force-close-all-panels');
    eventBus.emit('toggle-export-history');
  }

  _closeDropdown() {
    this._dropdown = '';
  }

  render() {
    return html`
      <!-- 侧栏切换 -->
      <button title="${t('toolbar.toggleSidebar')} (${shortcutRegistry.getShortcut('toggleSidebar')})"
              @click=${() => this.dispatchEvent(new CustomEvent('toggle-sidebar'))}>${icon('menu')}</button>
      <span class="sep"></span>

      <!-- 文件操作组：常用操作图标+文字 -->
      <button class="btn-text" title="${t('menu.openDirectory')}"
              @click=${this._openDir}>${icon('folder')} ${t('toolbar.btnOpen')}</button>
      <button class="btn-text" @click=${(e) => this._toggleDropdown('new', e)}>
        ${icon('plus')} ${t('toolbar.btnNew')} ${icon('chevron', 'ic-sm')}
      </button>
      <button class="btn-text" title="${t('toolbar.save')} (${shortcutRegistry.getShortcut('save')})"
              @click=${() => eventBus.emit('save-file')}>${icon('save')} ${t('toolbar.btnSave')}</button>
      <span class="sep"></span>

      <!-- 编辑快捷组：撤销/重做直出，高级操作下拉 -->
      <button title="${t('toolbar.undo')} (${shortcutRegistry.getShortcut('undo')})"
              @click=${() => eventBus.emit('editor-undo')}>${icon('undo')}</button>
      <button title="${t('toolbar.redo')} (${shortcutRegistry.getShortcut('redo')})"
              @click=${() => eventBus.emit('editor-redo')}>${icon('redo')}</button>
      <button title="${t('toolbar.edit')}" @click=${(e) => this._toggleDropdown('edit', e)}>
        ${icon('edit')} ${icon('chevron', 'ic-sm')}
      </button>
      ${this._currentFormat ? html`
        <span class="sep"></span>
        <button title="${t('markup.bold')} (${shortcutRegistry.getShortcut('markupBold')})"
                @click=${() => eventBus.emit('editor-markup-inline', { id: 'bold' })}>${icon('bold')}</button>
        <button title="${t('markup.italic')} (${shortcutRegistry.getShortcut('markupItalic')})"
                @click=${() => eventBus.emit('editor-markup-inline', { id: 'italic' })}>${icon('italic')}</button>
        <button title="${t('markup.link')} (${shortcutRegistry.getShortcut('markupLink')})"
                @click=${() => eventBus.emit('editor-markup-link')}>${icon('link')}</button>
        <button title="${t('toolbar.markup')}" @click=${(e) => this._toggleDropdown('markup', e)}>
          ${icon('code')} ${icon('chevron', 'ic-sm')}
        </button>
      ` : ''}
      <span class="sep"></span>

      <!-- 视图切换 -->
      <button title="${t('toolbar.togglePreview')} (${shortcutRegistry.getShortcut('togglePreview')})"
              @click=${() => this.dispatchEvent(new CustomEvent('toggle-preview'))}>${icon(this._viewMode === 'split' ? 'columns' : this._viewMode === 'edit' ? 'edit' : 'eye')}</button>
      <button title="${t('toolbar.toggleWordWrap')} (${shortcutRegistry.getShortcut('toggleWordWrap')})"
              @click=${() => eventBus.emit('toggle-word-wrap')}>${icon('wrap')}</button>
      <span class="sep"></span>

      <!-- 特色面板组：知识管理核心功能 -->
      <button title="${t('toolbar.btnSearch')} (${shortcutRegistry.getShortcut('search')})"
              @click=${(e) => this._toggleDropdown('search', e)}>
        ${icon('search')} ${icon('chevron', 'ic-sm')}
      </button>
      <button class="${this._activePanel === 'outline' ? 'on' : ''}"
              title="${t('toolbar.toggleOutline')} (${shortcutRegistry.getShortcut('toggleOutline')})"
              @click=${() => this._togglePanel('outline')}>${icon('list')}</button>
      <button class="${this._activePanel === 'ai' ? 'on' : ''}"
              title="${t('toolbar.toggleAI')} (${shortcutRegistry.getShortcut('toggleAI')})"
              @click=${() => this._togglePanel('ai')}>${icon('sparkles')}</button>
      <button class="${this._activePanel === 'backlinks' ? 'on' : ''}"
              title="${t('toolbar.toggleBacklinks')} (${shortcutRegistry.getShortcut('toggleBacklinks')})"
              @click=${() => this._togglePanel('backlinks')}>${icon('link')}</button>
      <button class="${this._activePanel === 'graph' ? 'on' : ''}"
              title="${t('toolbar.toggleGraph')} (${shortcutRegistry.getShortcut('toggleGraph')})"
              @click=${() => this._togglePanel('graph')}>${icon('graph')}</button>
      <button class="${this._activePanel === 'tags' ? 'on' : ''}"
              title="${t('toolbar.toggleTags')} (${shortcutRegistry.getShortcut('toggleTags')})"
              @click=${() => this._togglePanel('tags')}>${icon('tags')}</button>

      <div class="spacer"></div>

      <!-- 右侧：导出、插件、设置、主题 -->
      <button title="${t('toolbar.btnExport')}"
              @click=${(e) => this._toggleDropdown('export', e)}>
        ${icon('upload')} ${icon('chevron', 'ic-sm')}
      </button>
      <button class="${this._activePanel === 'plugin' ? 'on' : ''}"
              title="${t('toolbar.togglePluginManager')} (${shortcutRegistry.getShortcut('togglePlugin')})"
              @click=${() => this._togglePanel('plugin')}>🧩</button>
      <button title="${t('toolbar.openSettings')}"
              @click=${() => this.dispatchEvent(new CustomEvent('open-settings'))}>${icon('settings')}</button>
      <button class="theme-btn" @click=${this._toggleTheme}>
        ${this._theme === 'dark' ? icon('moon') : icon('sun')}
      </button>

      <!-- 新建下拉 -->
      ${this._dropdown === 'new' ? html`
        <div class="dropdown" style="left: ${this._dropdownLeft}px" @click=${this._closeDropdown}>
          <button class="dropdown-item" @click=${() => eventBus.emit('new-file')}>
            <span class="label">${t('toolbar.newFile')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('newFile')}</span>
          </button>
          <button class="dropdown-item" @click=${this._importDocx}>
            <span class="label">${t('toolbar.importDocx')}</span>
          </button>
          <button class="dropdown-item" @click=${() => this._togglePanel('template')}>
            <span class="label">${t('template.panelTitle')}</span>
          </button>
        </div>
      ` : ''}

      <!-- 编辑下拉 -->
      ${this._dropdown === 'edit' ? html`
        <div class="dropdown" style="left: ${this._dropdownLeft}px; min-width: 210px" @click=${this._closeDropdown}>
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-undo')}>
            <span class="label">${t('toolbar.undo')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('undo')}</span>
          </button>
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-redo')}>
            <span class="label">${t('toolbar.redo')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('redo')}</span>
          </button>
          <hr style="margin: 4px 8px; border: none; border-top: 1px solid var(--border-subtle);">
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-select-all')}>
            <span class="label">${t('edit.selectAll')}</span>
            <span class="shortcut">Ctrl+A</span>
          </button>
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-select-line')}>
            <span class="label">${t('edit.selectLine')}</span>
            <span class="shortcut">Alt+L</span>
          </button>
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-select-parent-syntax')}>
            <span class="label">${t('edit.selectParentSyntax')}</span>
            <span class="shortcut">Ctrl+I</span>
          </button>
          <hr style="margin: 4px 8px; border: none; border-top: 1px solid var(--border-subtle);">
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-indent-more')}>
            <span class="label">${t('edit.indentMore')}</span>
            <span class="shortcut">Ctrl+]</span>
          </button>
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-indent-less')}>
            <span class="label">${t('edit.indentLess')}</span>
            <span class="shortcut">Ctrl+[</span>
          </button>
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-indent-selection')}>
            <span class="label">${t('edit.indentSelection')}</span>
            <span class="shortcut">Ctrl+Alt+\\</span>
          </button>
          <hr style="margin: 4px 8px; border: none; border-top: 1px solid var(--border-subtle);">
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-move-line-up')}>
            <span class="label">${t('edit.moveLineUp')}</span>
            <span class="shortcut">Alt+↑</span>
          </button>
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-move-line-down')}>
            <span class="label">${t('edit.moveLineDown')}</span>
            <span class="shortcut">Alt+↓</span>
          </button>
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-copy-line-up')}>
            <span class="label">${t('edit.copyLineUp')}</span>
            <span class="shortcut">Shift+Alt+↑</span>
          </button>
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-copy-line-down')}>
            <span class="label">${t('edit.copyLineDown')}</span>
            <span class="shortcut">Shift+Alt+↓</span>
          </button>
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-delete-line')}>
            <span class="label">${t('edit.deleteLine')}</span>
            <span class="shortcut">Ctrl+Shift+K</span>
          </button>
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-insert-blank-line')}>
            <span class="label">${t('edit.insertBlankLine')}</span>
            <span class="shortcut">Ctrl+Enter</span>
          </button>
          <hr style="margin: 4px 8px; border: none; border-top: 1px solid var(--border-subtle);">
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-toggle-comment')}>
            <span class="label">${t('edit.toggleComment')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('toggleLineComment')}</span>
          </button>
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-toggle-block-comment')}>
            <span class="label">${t('edit.toggleBlockComment')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('toggleBlockComment')}</span>
          </button>
          <hr style="margin: 4px 8px; border: none; border-top: 1px solid var(--border-subtle);">
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-matching-bracket')}>
            <span class="label">${t('edit.matchingBracket')}</span>
            <span class="shortcut">Ctrl+Shift+\\</span>
          </button>
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-add-cursor-above')}>
            <span class="label">${t('edit.addCursorAbove')}</span>
            <span class="shortcut">Ctrl+Alt+↑</span>
          </button>
          <button class="dropdown-item" @click=${() => eventBus.emit('editor-add-cursor-below')}>
            <span class="label">${t('edit.addCursorBelow')}</span>
            <span class="shortcut">Ctrl+Alt+↓</span>
          </button>
        </div>
      ` : ''}

      <!-- 标记下拉 -->
      ${this._dropdown === 'markup' && this._currentFormat ? html`
        <div class="dropdown" style="left: ${this._dropdownLeft}px; min-width: 200px; max-height: 70vh; overflow-y: auto" @click=${this._closeDropdown}>
          ${this._currentFormat.inlineMarkup.map(m => html`
            <button class="dropdown-item" @click=${() => eventBus.emit('editor-markup-inline', { id: m.id })}>
              <span class="label">${t(m.labelKey)} ${m.open}${m.close}</span>
              ${m.shortcutId ? html`<span class="shortcut">${shortcutRegistry.getShortcut(m.shortcutId)}</span>` : ''}
            </button>
          `)}
          <hr style="margin: 4px 8px; border: none; border-top: 1px solid var(--border-subtle);">
          ${Array.from({ length: this._currentFormat.heading.levels }, (_, i) => i + 1).map(level => html`
            <button class="dropdown-item" @click=${() => eventBus.emit('editor-heading', level)}>
              <span class="label">${t('markup.heading', { level })} ${this._currentFormat.heading.prefix(level).trim()}</span>
            </button>
          `)}
          ${this._currentFormat.listMarkers.map(lm => html`
            <button class="dropdown-item" @click=${() => eventBus.emit('editor-list', lm.marker)}>
              <span class="label">${t(lm.labelKey)} ${lm.marker.trim()}</span>
            </button>
          `)}
          <hr style="margin: 4px 8px; border: none; border-top: 1px solid var(--border-subtle);">
          ${this._currentFormat.blocks.map(b => html`
            <button class="dropdown-item" @click=${() => eventBus.emit('editor-insert-block', { id: b.id })}>
              <span class="label">${t(b.labelKey)}</span>
            </button>
          `)}
          ${this._currentFormat.tableAlign ? html`
            <hr style="margin: 4px 8px; border: none; border-top: 1px solid var(--border-subtle);">
            <button class="dropdown-item" @click=${() => eventBus.emit('editor-align-table')}>
              <span class="label">${t('markup.alignTable')}</span>
              <span class="shortcut">${shortcutRegistry.getShortcut('alignTable')}</span>
            </button>
          ` : ''}
        </div>
      ` : ''}

      <!-- 搜索下拉 -->
      ${this._dropdown === 'search' ? html`
        <div class="dropdown" style="left: ${this._dropdownLeft}px" @click=${this._closeDropdown}>
          <button class="dropdown-item" @click=${() => this._togglePanel('search')}>
            <span class="label">${t('toolbar.btnSearch')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('search')}</span>
          </button>
          <button class="dropdown-item" @click=${() => { this._closeDropdown(); eventBus.emit('open-find-replace'); }}>
            <span class="label">${t('toolbar.btnFindReplace')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('findReplace')}</span>
          </button>
          <button class="dropdown-item" @click=${() => { this._closeDropdown(); eventBus.emit('goto-line'); }}>
            <span class="label">${t('shortcuts.gotoLine')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('gotoLine')}</span>
          </button>
        </div>
      ` : ''}

      <!-- 导出下拉 -->
      ${this._dropdown === 'export' ? html`
        <div class="dropdown" style="right: ${this._dropdownRight}px" @click=${this._closeDropdown}>
          <button class="dropdown-item" @click=${this._exportHtml}>
            <span class="label">${t('toolbar.exportHtml')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('exportHtml')}</span>
          </button>
          <button class="dropdown-item" @click=${this._exportPdf}>
            <span class="label">${t('toolbar.exportPdf')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('exportPdf')}</span>
          </button>
          <button class="dropdown-item" @click=${this._exportDocx}>
            <span class="label">${t('toolbar.exportDocx')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('exportDocx')}</span>
          </button>
          <hr style="margin: 4px 8px; border: none; border-top: 1px solid var(--border-subtle);">
          <button class="dropdown-item" @click=${this._openExportHistory}>
            <span class="label">${t('exportHistory.title')}</span>
          </button>
          <button class="dropdown-item" @click=${() => eventBus.emit('close-active-tab')}>
            <span class="label">${t('menu.closeTab')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('closeTab')}</span>
          </button>
        </div>
      ` : ''}
    `;
  }

  _toggleDropdown(which, e) {
    e.stopPropagation();
    this._dropdown = this._dropdown === which ? '' : which;
    if (this._dropdown) {
      const btn = e.currentTarget;
      const rect = btn.getBoundingClientRect();
      const hostRect = this.getBoundingClientRect();
      this._dropdownLeft = rect.left - hostRect.left;
      this._dropdownRight = hostRect.right - rect.right;
    }
  }

  async _openDir() {
    try {
      const dir = await pickDirectory();
      if (dir) eventBus.emit('workspace-opened', dir);
    } catch (e) {
      console.error(t('msg.openDirFailed'), e);
    }
  }

  async _importDocx() {
    this._dropdown = '';
    try {
      const { getCurrentWorkspace } = await import('../services/config-service.js');
      const ws = await getCurrentWorkspace();
      if (!ws) {
        eventBus.emit('status-message', t('msg.noWorkspace'));
        return;
      }
      const hasPandoc = await checkPandoc();
      if (!hasPandoc) {
        eventBus.emit('status-message', t('msg.noPandocImport'));
        return;
      }
      const docxPath = await pickDocxFile();
      if (!docxPath) return;

      // 同名 .adoc 已存在时确认覆盖
      const stem = docxPath.replace(/.*\//, '').replace(/\.[^.]+$/, '');
      const adocPath = ws.replace(/\/$/, '') + '/' + stem + '.adoc';
      const { readFile } = await import('../services/file-service.js');
      let existing;
      try { existing = await readFile(adocPath); } catch (_) {}
      if (existing !== undefined) {
        const { showConfirm } = await import('../services/dialog.js');
        const ok = await showConfirm(t('msg.confirmOverwrite', { name: stem + '.adoc' }));
        if (!ok) return;
      }

      const result = await importDocx(docxPath, ws);
      if (result) {
        const content = await readFile(result);
        editorState.openFile(result, content);
        eventBus.emit('file-opened', { path: result, content });
        eventBus.emit('status-message', { text: t('msg.importDocxSuccess', { path: result }), path: result });
      }
    } catch (e) {
      console.error('Import docx failed:', e);
      eventBus.emit('status-message', t('msg.importDocxFailed', { error: e }));
    }
  }

  async _exportHtml() {
    try {
      const active = editorState.getActiveFile();
      if (!active) {
        eventBus.emit('status-message', t('msg.pleaseOpenFile'));
        return;
      }
      const result = await exportToHtml(active.content, active.path);
      if (result) {
        eventBus.emit('status-message', { text: t('msg.exportedHtml', { path: result }), path: result });
        this._recordExport(result, 'html');
      }
    } catch (e) {
      console.error(t('msg.exportFailed', { error: '' }), e);
      eventBus.emit('status-message', t('msg.exportFailed', { error: e }));
    }
  }

  async _exportPdf() {
    try {
      const active = editorState.getActiveFile();
      if (!active) {
        eventBus.emit('status-message', t('msg.pleaseOpenFile'));
        return;
      }
      if (active.path.startsWith('__untitled_')) {
        eventBus.emit('status-message', t('msg.saveBeforePdf'));
        return;
      }
      const isMd = active.path && /\.(md|markdown)$/i.test(active.path);
      if (isMd) {
        // Markdown: 使用 pandoc + xelatex
        const hasPandoc = await checkPandoc();
        if (hasPandoc) {
          const result = await exportToPdf(active.path);
          if (result) {
            eventBus.emit('status-message', { text: t('msg.exportedPdf', { path: result }), path: result });
            this._recordExport(result, 'pdf');
          }
        } else {
          eventBus.emit('status-message', t('msg.noPandoc'));
        }
      } else {
        // AsciiDoc: 使用 asciidoctor-pdf
        const hasPdf = await checkAsciidoctorPdf();
        if (hasPdf) {
          const result = await exportToPdf(active.path);
          if (result) {
            eventBus.emit('status-message', { text: t('msg.exportedPdf', { path: result }), path: result });
            this._recordExport(result, 'pdf');
          }
        } else {
          const adoc = (await import('@asciidoctor/core')).default();
          const asciidoctor = adoc();
          const html = asciidoctor.convert(active.content, { safe: 'safe', standalone: false });
          await openInBrowser(html);
          eventBus.emit('status-message', t('msg.noPdfOpenBrowser'));
        }
      }
    } catch (e) {
      console.error(t('msg.pdfExportFailed', { error: '' }), e);
      eventBus.emit('status-message', t('msg.pdfExportFailed', { error: e }));
    }
  }

  async _exportDocx() {
    try {
      const active = editorState.getActiveFile();
      if (!active) {
        eventBus.emit('status-message', t('msg.pleaseOpenFile'));
        return;
      }
      if (active.path.startsWith('__untitled_')) {
        eventBus.emit('status-message', t('msg.saveBeforeDocx'));
        return;
      }
      const hasPandoc = await checkPandoc();
      if (hasPandoc) {
        const result = await exportToDocx(active.path);
        if (result) {
          eventBus.emit('status-message', { text: t('msg.exportedDocx', { path: result }), path: result });
          this._recordExport(result, 'docx');
        }
      } else {
        eventBus.emit('status-message', t('msg.noPandoc'));
      }
    } catch (e) {
      console.error(t('msg.docxExportFailed', { error: '' }), e);
      eventBus.emit('status-message', t('msg.docxExportFailed', { error: e }));
    }
  }

  async _recordExport(path, format) {
    try {
      const { addExportHistory } = await import('../services/config-service.js');
      const { editorState } = await import('../services/editor-state.js');
      await addExportHistory(path, format, editorState.workspaceRoot || undefined);
      eventBus.emit('export-done');
    } catch (_) {}
  }
}

customElements.define('toolbar-main', ToolbarMain);
