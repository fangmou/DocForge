import { LitElement, html, css, svg } from 'lit';
import { pickDirectory } from '../services/file-service.js';
import { eventBus } from '../services/event-bus.js';
import { editorState } from '../services/editor-state.js';
import { exportToHtml, checkAsciidoctorPdf, exportToPdf, openInBrowser } from '../services/export-service.js';
import { t } from '../services/i18n.js';
import { shortcutRegistry } from '../services/shortcut-registry.js';

// Lucide 风格统一 SVG 图标 (viewBox 0 0 24 24, stroke 2)
const icons = {
  menu: svg`<path d="M4 6h16M4 12h16M4 18h16"/>`,
  folder: svg`<path d="M4 20h16a2 2 0 002-2V8a2 2 0 00-2-2h-7.93a2 2 0 01-1.66-.9l-.82-1.2A2 2 0 007.93 3H4a2 2 0 00-2 2v13c0 1.1.9 2 2 2z"/>`,
  plus: svg`<path d="M12 5v14M5 12h14"/>`,
  save: svg`<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>`,
  eye: svg`<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`,
  wrap: svg`<path d="M3 6h18M3 12h15a3 3 0 110 6h-4m0 0l2-2m-2 2l2 2M3 18h7"/>`,
  search: svg`<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>`,
  list: svg`<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>`,
  sparkles: svg`<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 13l.9 2.7L22.6 16.5l-2.7.8L19 20l-.9-2.7-2.7-.8 2.7-.8z"/>`,
  upload: svg`<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>`,
  settings: svg`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>`,
  sun: svg`<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>`,
  moon: svg`<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>`,
  chevron: svg`<path d="M6 9l6 6 6-6"/>`,
  template: svg`<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>`,
  link: svg`<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>`,
  graph: svg`<circle cx="5" cy="6" r="3"/><circle cx="19" cy="6" r="3"/><circle cx="12" cy="19" r="3"/><path d="M7.5 8l3 7.5M16.5 8l-3 7.5"/>`,
};

function icon(name, cls = 'ic') {
  return html`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
}

class ToolbarMain extends LitElement {
  static properties = {
    _activePanel: { state: true },
    _theme: { state: true },
    _dropdown: { state: true }, // 'new' | 'export' | ''
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
    /* SVG 图标 */
    .ic {
      width: 15px;
      height: 15px;
      flex-shrink: 0;
    }
    /* 小箭头 */
    .chevron {
      width: 12px;
      height: 12px;
      opacity: 0.5;
    }
    /* 激活态 */
    button.on {
      background: var(--bg-3);
      color: var(--accent);
    }
    button.on .ic {
      color: var(--accent);
    }
    /* 分组容器 */
    .group {
      display: flex;
      align-items: center;
      gap: 1px;
    }
    /* 分隔符 */
    .sep {
      width: 1px;
      height: 16px;
      background: var(--border-subtle);
      margin: 0 6px;
      flex-shrink: 0;
    }
    .spacer { flex: 1; }
    /* 下拉菜单 */
    .dropdown {
      position: absolute;
      top: 100%;
      left: 0;
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
    };
    for (const [name, handler] of Object.entries(this._panelHandlers)) {
      eventBus.on(name, handler);
    }
    this._themeHandler = (theme) => { this._theme = theme; };
    eventBus.on('theme-changed', this._themeHandler);
    this._exportHtmlHandler = () => this._exportHtml();
    this._exportPdfHandler = () => this._exportPdf();
    eventBus.on('export-html', this._exportHtmlHandler);
    eventBus.on('export-pdf', this._exportPdfHandler);
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
    if (this._exportHtmlHandler) eventBus.off('export-html', this._exportHtmlHandler);
    if (this._exportPdfHandler) eventBus.off('export-pdf', this._exportPdfHandler);
    document.removeEventListener('click', this._clickOutside);
  }

  _togglePanel(panel) {
    this._dropdown = '';
    const isClosing = this._activePanel === panel;

    // 先关闭所有已打开的面板
    eventBus.emit('force-close-all-panels');
    this._activePanel = '';

    // 如果不是关闭当前面板，则打开新面板
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
      };
      if (eventMap[panel]) eventMap[panel]();
    }
  }

  _toggleTheme() {
    const next = this._theme === 'dark' ? 'light' : 'dark';
    this._theme = next;
    eventBus.emit('theme-changed', next);
  }

  _closeDropdown() {
    this._dropdown = '';
  }

  render() {
    return html`
      <!-- 侧栏切换 -->
      <button title="${t('toolbar.toggleSidebar')} (${shortcutRegistry.getShortcut('toggleSidebar')})" @click=${() => this.dispatchEvent(new CustomEvent('toggle-sidebar'))}>
        ${icon('menu')}
      </button>

      <div class="sep"></div>

      <!-- 文件组 -->
      <div class="group">
        <button title="${t('toolbar.openDirectory')}" @click=${this._openDir}>${icon('folder')}</button>
        <button title="${t('toolbar.btnNew')} (${shortcutRegistry.getShortcut('newFile')})" @click=${(e) => this._toggleDropdown('new', e)}>
          ${icon('plus')}
          ${icon('chevron', 'chevron')}
        </button>
        <button title="${t('toolbar.save')} (${shortcutRegistry.getShortcut('save')})" @click=${() => eventBus.emit('save-file')}>${icon('save')}</button>
      </div>

      <div class="sep"></div>

      <!-- 视图组 -->
      <div class="group">
        <button title="${t('toolbar.togglePreview')} (${shortcutRegistry.getShortcut('togglePreview')})" @click=${() => this.dispatchEvent(new CustomEvent('toggle-preview'))}>${icon('eye')}</button>
        <button title="${t('toolbar.toggleWordWrap')} (${shortcutRegistry.getShortcut('toggleWordWrap')})" @click=${() => eventBus.emit('toggle-word-wrap')}>${icon('wrap')}</button>
      </div>

      <div class="sep"></div>

      <!-- 面板组（带激活态） -->
      <div class="group">
        <button class="${this._activePanel === 'search' ? 'on' : ''}"
                title="${t('toolbar.toggleSearch')} (${shortcutRegistry.getShortcut('search')}) / ${t('toolbar.openFindReplace')} (${shortcutRegistry.getShortcut('findReplace')})"
                @click=${(e) => this._toggleDropdown('search', e)}>
          ${icon('search')}
          ${icon('chevron', 'chevron')}
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
                @click=${() => this._togglePanel('tags')}>🏷</button>
      </div>

      <div class="sep"></div>

      <!-- 导出组 -->
      <div class="group">
        <button title="${t('toolbar.btnExport')}" @click=${(e) => this._toggleDropdown('export', e)}>
          ${icon('upload')}
          ${icon('chevron', 'chevron')}
        </button>
      </div>

      <div class="spacer"></div>

      <!-- 右侧 -->
      <button class="${this._activePanel === 'plugin' ? 'on' : ''}"
              title="${t('toolbar.togglePluginManager')} (${shortcutRegistry.getShortcut('togglePlugin')})"
              @click=${() => this._togglePanel('plugin')}>🧩</button>
      <button title="${t('toolbar.openSettings')}" @click=${() => this.dispatchEvent(new CustomEvent('open-settings'))}>${icon('settings')}</button>
      <button class="theme-btn" @click=${this._toggleTheme}>
        ${this._theme === 'dark' ? icon('moon') : icon('sun')}
      </button>

      <!-- 下拉菜单 -->
      ${this._dropdown === 'new' ? html`
        <div class="dropdown" style="left: ${this._newDropdownLeft}px" @click=${this._closeDropdown}>
          <button class="dropdown-item" @click=${() => eventBus.emit('new-file')}>
            ${icon('plus')} <span class="label">${t('toolbar.newFile')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('newFile')}</span>
          </button>
          <button class="dropdown-item" @click=${() => this._togglePanel('template')}>
            ${icon('template')} <span class="label">${t('template.panelTitle')}</span>
          </button>
        </div>
      ` : ''}
      ${this._dropdown === 'export' ? html`
        <div class="dropdown" style="left: ${this._exportDropdownLeft}px" @click=${this._closeDropdown}>
          <button class="dropdown-item" @click=${this._exportHtml}>
            ${icon('upload')} <span class="label">${t('toolbar.exportHtml')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('exportHtml')}</span>
          </button>
          <button class="dropdown-item" @click=${this._exportPdf}>
            ${icon('upload')} <span class="label">${t('toolbar.exportPdf')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('exportPdf')}</span>
          </button>
        </div>
      ` : ''}
      ${this._dropdown === 'search' ? html`
        <div class="dropdown" style="left: ${this._searchDropdownLeft}px" @click=${this._closeDropdown}>
          <button class="dropdown-item" @click=${() => this._togglePanel('search')}>
            ${icon('search')} <span class="label">${t('toolbar.btnSearch')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('search')}</span>
          </button>
          <button class="dropdown-item" @click=${() => { this._closeDropdown(); eventBus.emit('open-find-replace'); }}>
            ${icon('wrap')} <span class="label">${t('toolbar.btnFindReplace')}</span>
            <span class="shortcut">${shortcutRegistry.getShortcut('findReplace')}</span>
          </button>
        </div>
      ` : ''}
    `;
  }

  _toggleDropdown(which, e) {
    e.stopPropagation();
    this._dropdown = this._dropdown === which ? '' : which;
    // 记录按钮位置用于下拉菜单定位
    if (this._dropdown) {
      const btn = e.currentTarget;
      const rect = btn.getBoundingClientRect();
      const hostRect = this.getBoundingClientRect();
      if (which === 'new') this._newDropdownLeft = rect.left - hostRect.left;
      else if (which === 'export') this._exportDropdownLeft = rect.left - hostRect.left;
      else if (which === 'search') this._searchDropdownLeft = rect.left - hostRect.left;
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

  async _exportHtml() {
    try {
      const active = editorState.getActiveFile();
      if (!active) {
        eventBus.emit('status-message', t('msg.pleaseOpenFile'));
        return;
      }
      const result = await exportToHtml(active.content, active.path);
      if (result) {
        eventBus.emit('status-message', t('msg.exportedHtml', { path: result }));
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
      const hasPdf = await checkAsciidoctorPdf();
      if (hasPdf) {
        const result = await exportToPdf(active.path);
        if (result) eventBus.emit('status-message', t('msg.exportedPdf', { path: result }));
      } else {
        const adoc = (await import('@asciidoctor/core')).default();
        const asciidoctor = adoc();
        const html = asciidoctor.convert(active.content, { safe: 'safe', standalone: false });
        await openInBrowser(html);
        eventBus.emit('status-message', t('msg.noPdfOpenBrowser'));
      }
    } catch (e) {
      console.error(t('msg.pdfExportFailed', { error: '' }), e);
      eventBus.emit('status-message', t('msg.pdfExportFailed', { error: e }));
    }
  }
}

customElements.define('toolbar-main', ToolbarMain);
