import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { setLanguage, t } from '../services/i18n.js';

class AppShell extends LitElement {
  static properties = {
    sidebarVisible: { type: Boolean },
    previewVisible: { type: Boolean },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      width: 100vw;
    }
    .body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .sidebar {
      width: var(--sidebar-width);
      min-width: 160px;
      max-width: 500px;
      border-right: 1px solid var(--border-subtle);
      overflow-y: auto;
      background: var(--bg-2);
      transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s;
    }
    .sidebar.resizing {
      transition: none;
    }
    .sidebar.hidden {
      width: 0;
      min-width: 0;
      overflow: hidden;
      opacity: 0;
    }
    .editor-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .main-row {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .split-area {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-width: 300px;
    }
    .editor-col {
      flex: 1;
      min-width: 0;
    }
    .preview-col {
      width: 45%;
      min-width: 300px;
      border-left: 1px solid var(--border-subtle);
      overflow-y: auto;
      background: var(--bg-1);
      transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s;
    }
    .preview-col.hidden {
      width: 0;
      min-width: 0;
      overflow: hidden;
      opacity: 0;
    }
    .resize-handle {
      width: 7px;
      cursor: col-resize;
      flex-shrink: 0;
      background: transparent;
      position: relative;
      z-index: 10;
    }
    .resize-handle::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 2px;
      width: 3px;
      height: 24px;
      margin-top: -12px;
      border-radius: 2px;
      background: var(--border-medium);
      transition: background 0.15s, height 0.15s;
    }
    .resize-handle:hover::after,
    .resize-handle.active::after {
      background: var(--accent);
      height: 32px;
      margin-top: -16px;
    }
    .resize-handle.hidden {
      display: none;
    }
  `;

  constructor() {
    super();
    this.sidebarVisible = true;
    this.previewVisible = true;
  }

  connectedCallback() {
    super.connectedCallback();
    this._handlers = {
      'toggle-sidebar': () => {
        this.sidebarVisible = !this.sidebarVisible;
        if (!this.sidebarVisible) {
          const sidebar = this.shadowRoot.querySelector('.sidebar');
          sidebar.style.width = '';
          sidebar.style.minWidth = '';
        }
      },
      'toggle-preview': () => {
        this.previewVisible = !this.previewVisible;
        eventBus.emit('preview-visibility-changed', this.previewVisible);
      },
      'theme-changed': (theme) => { document.documentElement.setAttribute('data-theme', theme); },
      'language-changed': () => { this._updateTitle(); },
      'reveal-in-shell': async (path) => {
        try { await window.__TAURI__.core.invoke('reveal_in_shell', { path }); } catch (_) {}
      },
    };
    this._onMouseMove = (e) => this._doResize(e);
    this._onMouseUp = () => this._stopResize();
    for (const [name, handler] of Object.entries(this._handlers)) {
      eventBus.on(name, handler);
    }
    // 工作区打开时加载插件和链接索引（并行，互不阻塞）
    this._wsHandler = async (wsPath) => {
      const { pluginLoader } = await import('../services/plugin-loader.js');
      const { linkIndex } = await import('../services/link-index.js');
      pluginLoader.loadAll(wsPath).catch(() => {});
      linkIndex.buildIndex(wsPath).catch(() => {});
    };
    eventBus.on('workspace-opened', this._wsHandler);
    // 启动时加载配置（语言 + 上次工作区）
    this._loadConfig();
    // Tauri 原生拖拽（全平台通用，Linux 上 web API 的 file.path 不可用）
    this._setupDragDrop();
    // 全局快捷键
    this._shortcutRegistry = null;
    import('../services/shortcut-registry.js').then(({ shortcutRegistry }) => {
      this._shortcutRegistry = shortcutRegistry;
    }).catch(() => {});
    this._globalKeyHandler = (e) => {
      // Ctrl+Alt+1~9 切换工作区（保留旧逻辑）
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        import('../services/config-service.js').then(({ getRecentWorkspaces }) => {
          return getRecentWorkspaces();
        }).then(list => {
          const idx = parseInt(e.key) - 1;
          if (list[idx]) eventBus.emit('workspace-opened', list[idx].path);
        }).catch(() => {});
        return;
      }

      if (!this._shortcutRegistry) return;
      const action = this._shortcutRegistry.matchEvent(e);
      if (!action) return;

      // CodeMirror 已处理的快捷键不要重复触发
      const editorHandled = new Set(['save', 'search', 'findReplace', 'gotoLine', 'zoomIn', 'zoomOut', 'zoomReset']);
      if (editorHandled.has(action)) return;

      // 如果焦点在 input/textarea/select 中，不拦截（避免影响正常输入）
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      e.preventDefault();
      const actionMap = {
        newFile:         () => eventBus.emit('new-file'),
        toggleWordWrap:  () => eventBus.emit('toggle-word-wrap'),
        toggleOutline:   () => eventBus.emit('toggle-outline'),
        toggleAI:        () => eventBus.emit('toggle-ai-panel'),
        toggleBacklinks: () => eventBus.emit('toggle-backlinks'),
        toggleGraph:     () => eventBus.emit('toggle-graph-view'),
        toggleTags:      () => eventBus.emit('toggle-tags-panel'),
        togglePreview:   () => eventBus.emit('toggle-preview'),
        toggleSidebar:   () => eventBus.emit('toggle-sidebar'),
        togglePlugin:    () => eventBus.emit('toggle-plugin-manager'),
        exportHtml:      () => eventBus.emit('export-html'),
        exportPdf:       () => eventBus.emit('export-pdf'),
      };
      if (actionMap[action]) actionMap[action]();
    };
    window.addEventListener('keydown', this._globalKeyHandler);
  }

  async _loadConfig() {
    try {
      const { loadEditorConfig, getCurrentWorkspace } = await import('../services/config-service.js');
      // 加载快捷键自定义覆盖
      const { shortcutRegistry } = await import('../services/shortcut-registry.js');
      await shortcutRegistry.init();
      // 加载语言
      const edConfig = await loadEditorConfig();
      if (edConfig.language) {
        await setLanguage(edConfig.language);
        eventBus.emit('language-changed', edConfig.language);
      }
      this._updateTitle();
      // 恢复侧栏宽度
      if (edConfig.sidebar_width && edConfig.sidebar_width > 0) {
        const sidebar = this.shadowRoot.querySelector('.sidebar');
        if (sidebar) {
          sidebar.style.width = edConfig.sidebar_width + 'px';
          sidebar.style.minWidth = edConfig.sidebar_width + 'px';
        }
      }
      // 恢复上次工作区
      const ws = await getCurrentWorkspace();
      if (ws) {
        eventBus.emit('workspace-opened', ws);
      }
    } catch (_) {}
  }

  _updateTitle() {
    const title = t('app.title');
    document.title = title;
    if (window.__TAURI__) {
      try {
        const appWindow = window.__TAURI__.window.getCurrent();
        if (appWindow) appWindow.setTitle(title);
      } catch (_) {}
    }
  }

  async _setupDragDrop() {
    try {
      const { getCurrentWindow } = window.__TAURI__.window;
      this._unlistenDragDrop = await getCurrentWindow().onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          for (const path of event.payload.paths) {
            eventBus.emit('open-external-file', path);
          }
        }
      });
    } catch (_) {}
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const [name, handler] of Object.entries(this._handlers)) {
      eventBus.off(name, handler);
    }
    if (this._globalKeyHandler) window.removeEventListener('keydown', this._globalKeyHandler);
    if (this._unlistenDragDrop) this._unlistenDragDrop();
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
  }

  _startResize(e) {
    e.preventDefault();
    this._resizing = true;
    this._startX = e.clientX;
    const sidebar = this.shadowRoot.querySelector('.sidebar');
    this._startWidth = sidebar.offsetWidth;
    sidebar.classList.add('resizing');
    const handle = this.shadowRoot.querySelector('.resize-handle');
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  _doResize(e) {
    if (!this._resizing) return;
    const delta = e.clientX - this._startX;
    const newWidth = Math.max(160, Math.min(500, this._startWidth + delta));
    const sidebar = this.shadowRoot.querySelector('.sidebar');
    sidebar.style.width = newWidth + 'px';
    sidebar.style.minWidth = newWidth + 'px';
  }

  _stopResize() {
    if (!this._resizing) return;
    this._resizing = false;
    const sidebar = this.shadowRoot.querySelector('.sidebar');
    sidebar.classList.remove('resizing');
    const handle = this.shadowRoot.querySelector('.resize-handle');
    handle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
    // 持久化侧栏宽度
    const width = sidebar.offsetWidth;
    if (width > 0) {
      import('../services/config-service.js').then(({ loadEditorConfig, saveEditorConfig }) => {
        loadEditorConfig().then(config => {
          config.sidebar_width = width;
          saveEditorConfig(config);
        });
      }).catch(() => {});
    }
  }

  render() {
    return html`
      <toolbar-main
        @toggle-sidebar=${() => eventBus.emit('toggle-sidebar')}
        @toggle-preview=${() => eventBus.emit('toggle-preview')}
        @toggle-ai=${() => eventBus.emit('toggle-ai-panel')}
        @open-settings=${() => this.shadowRoot.querySelector('settings-dialog')?.show()}
      ></toolbar-main>
      <div class="body">
        <div class="sidebar ${this.sidebarVisible ? '' : 'hidden'}">
          <sidebar-filetree></sidebar-filetree>
        </div>
        <div class="resize-handle ${this.sidebarVisible ? '' : 'hidden'}"
             @mousedown=${this._startResize}></div>
        <div class="editor-area">
          <tab-bar></tab-bar>
          <div class="main-row">
            <div class="split-area">
              <editor-pane class="editor-col"></editor-pane>
              <div class="preview-col ${this.previewVisible ? '' : 'hidden'}">
                <preview-pane></preview-pane>
              </div>
            </div>
            <outline-panel></outline-panel>
            <search-panel></search-panel>
            <ai-panel></ai-panel>
            <template-panel></template-panel>
            <backlinks-panel></backlinks-panel>
            <tags-panel></tags-panel>
          </div>
        </div>
      </div>
      <status-bar></status-bar>
      <settings-dialog></settings-dialog>
      <context-menu></context-menu>
      <graph-view></graph-view>
      <plugin-manager-panel></plugin-manager-panel>
    `;
  }
}

customElements.define('app-shell', AppShell);
