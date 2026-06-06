import { LitElement, html, css } from 'lit';
import { editorState } from '../services/editor-state.js';
import { eventBus } from '../services/event-bus.js';
import { setLanguage, t } from '../services/i18n.js';
import { readFile, writeFile, deleteFile } from '../services/file-service.js';

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
      overflow: hidden;
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
      'preview-close': () => {
        if (!this.previewVisible) return;
        this.previewVisible = false;
        eventBus.emit('preview-visibility-changed', false);
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
    this._workspacePath = '';
    this._wsSwitching = false;
    this._wsSaveTimer = null;
    // 工作区打开时：保存旧状态 → 清空 → 恢复新状态
    this._wsHandler = async (wsPath) => {
      // 1. 保存旧工作区
      const oldWsPath = this._workspacePath;
      if (oldWsPath) {
        this._wsSwitching = true;
        try {
          await this._saveCurrentWorkspace(oldWsPath);
        } catch (_) {}
      }
      // 2. 清空当前 tabs、编辑器和预览
      editorState.deserialize(null);
      eventBus.emit('file-opened', { path: null, content: '' });
      eventBus.emit('content-changed', '');
      // 3. 设置新工作区路径
      this._workspacePath = wsPath || '';
      this._updateTitle();
      // 4. 加载插件和链接索引（并行）
      const { pluginLoader } = await import('../services/plugin-loader.js');
      const { linkIndex } = await import('../services/link-index.js');
      pluginLoader.loadAll(wsPath).catch(() => {});
      linkIndex.buildIndex(wsPath).catch(() => {});
      // 5. 恢复新工作区状态
      if (wsPath) {
        try {
          await this._restoreWorkspace(wsPath);
        } catch (_) {}
      }
      this._wsSwitching = false;
    };
    eventBus.on('workspace-opened', this._wsHandler);
    // 编辑器状态变化时防抖保存工作区
    this._unlistenEditorState = editorState.onChange(() => this._saveWorkspaceStateDebounced());
    // 文件切换时更新标题栏
    this._titleFileHandler = () => this._updateTitle();
    eventBus.on('file-opened', this._titleFileHandler);
    eventBus.on('file-closed', this._titleFileHandler);
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
      // ESC 关闭：按优先级关闭最顶层的面板/对话框
      if (e.key === 'Escape') {
        if (this._handleEsc()) { e.preventDefault(); return; }
      }

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
      const editorHandled = new Set(['save', 'search', 'findReplace', 'gotoLine', 'zoomIn', 'zoomOut', 'zoomReset', 'undo', 'redo']);
      if (editorHandled.has(action)) return;

      // 如果焦点在 input/textarea/select 中，不拦截（避免影响正常输入）
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      e.preventDefault();
      const actionMap = {
        newFile:         () => eventBus.emit('new-file'),
        undo:            () => eventBus.emit('editor-undo'),
        redo:            () => eventBus.emit('editor-redo'),
        closeTab:        () => eventBus.emit('close-active-tab'),
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
        exportDocx:      () => eventBus.emit('export-docx'),
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
      // 恢复主题
      if (edConfig.theme) {
        document.documentElement.setAttribute('data-theme', edConfig.theme);
        eventBus.emit('theme-changed', edConfig.theme);
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

  /** ESC 优先级：设置 > 图谱 > 插件 > 侧面板 > 预览，返回 true 表示已处理 */
  _handleEsc() {
    const root = this.shadowRoot;
    // 1. 设置对话框
    const settings = root.querySelector('settings-dialog');
    if (settings?.visible) { settings.visible = false; settings.classList.remove('visible'); return true; }
    // 2. 图谱浮层
    const graph = root.querySelector('graph-view');
    if (graph?.visible) { eventBus.emit('toggle-graph-view'); return true; }
    // 3. 插件管理
    const plugin = root.querySelector('plugin-manager-panel');
    if (plugin?.visible) { eventBus.emit('toggle-plugin-manager'); return true; }
    // 4. 侧面板 — 通过各自的 toggle 事件关闭，保证面板自身发出 toggled 通知
    const panelToggles = [
      ['outline-panel', 'toggle-outline'],
      ['search-panel', 'toggle-search'],
      ['ai-panel', 'toggle-ai-panel'],
      ['template-panel', 'toggle-template-panel'],
      ['backlinks-panel', 'toggle-backlinks'],
      ['tags-panel', 'toggle-tags-panel'],
      ['export-history-panel', 'toggle-export-history'],
    ];
    for (const [sel, evt] of panelToggles) {
      const el = root.querySelector(sel);
      if (el?.visible) { eventBus.emit(evt); return true; }
    }
    // 5. 预览
    if (this.previewVisible) {
      this.previewVisible = false;
      eventBus.emit('preview-visibility-changed', false);
      return true;
    }
    return false;
  }

  /** 对字符串做简单稳定的哈希（返回十六进制字符串） */
  static _hashPath(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16);
  }

  /** 保存当前工作区的完整状态（tabs + drafts） */
  async _saveCurrentWorkspace(wsPath) {
    const { saveWorkspaceState, loadWorkspaceState } = await import('../services/config-service.js');
    const serialized = editorState.serialize();
    const tabs = serialized.tabs;
    // 处理 dirty / untitled tabs：写 draft 文件
    const draftDir = await this._getDraftDir(wsPath);
    for (const tab of tabs) {
      const fileData = editorState.files.get(tab.path);
      if (!fileData) continue;
      const needsDraft = fileData.isDirty || tab.path.startsWith('__untitled_');
      if (needsDraft) {
        try {
          const draftPath = `${draftDir}/${AppShell._hashPath(tab.path)}.adoc`;
          await writeFile(draftPath, fileData.content || '');
          tab.draftPath = draftPath;
          tab.isDirty = true;
        } catch (e) { console.error('draft write failed:', e); }
      }
    }
    // 加载现有状态以保留 recent_files / export_history
    let existing = {};
    try { existing = await loadWorkspaceState(wsPath) || {}; } catch (_) {}
    await saveWorkspaceState(wsPath, {
      tabs: tabs.map(t => ({
        path: t.path,
        scroll_top: t.scrollTop,
        cursor_pos: t.cursorPos,
        is_dirty: t.isDirty,
        draft_path: t.draftPath || '',
      })),
      active_file_path: serialized.activeFilePath,
      recent_files: existing.recent_files || [],
      export_history: existing.export_history || [],
    });
  }

  /** 获取 draft 目录路径（通过 Rust IPC） */
  async _getDraftDir(wsPath) {
    const invoke = () => window.__TAURI__.core.invoke;
    const dir = await invoke()('get_draft_dir', { workspacePath: wsPath });
    if (!dir) throw new Error('get_draft_dir returned empty');
    return dir;
  }

  /** 恢复工作区状态 */
  async _restoreWorkspace(wsPath) {
    const { loadWorkspaceState } = await import('../services/config-service.js');
    const wsState = await loadWorkspaceState(wsPath);
    if (!wsState || !wsState.tabs || wsState.tabs.length === 0) return;
    // 用 deserialize 重建元数据
    editorState.deserialize({
      tabs: wsState.tabs.map(t => ({
        path: t.path,
        scrollTop: t.scroll_top,
        cursorPos: t.cursor_pos,
        isDirty: t.is_dirty,
      })),
      activeFilePath: wsState.active_file_path,
    });
    // 加载所有 tab 的内容，记录第一个成功加载的作为 fallback
    const activePath = wsState.active_file_path;
    let fallbackPath = null;
    for (const tab of wsState.tabs) {
      try {
        let content;
        // 优先从 draft 读取（isDirty 或 untitled）
        if (tab.draft_path && (tab.is_dirty || tab.path.startsWith('__untitled_'))) {
          try { content = await readFile(tab.draft_path); } catch (e) { console.error('draft read failed:', e); }
        }
        // fallback 到磁盘文件
        if (content === undefined && !tab.path.startsWith('__untitled_')) {
          content = await readFile(tab.path);
        }
        if (content !== undefined) {
          const file = editorState.getFile(tab.path);
          if (file) file.content = content;
          if (!fallbackPath) fallbackPath = tab.path;
          // 活动文件触发 file-opened 事件
          if (tab.path === activePath) {
            eventBus.emit('file-opened', { path: tab.path, content });
            // 恢复光标和滚动位置
            eventBus.emit('restore-editor-state', {
              scrollTop: tab.scroll_top,
              cursorPos: tab.cursor_pos,
            });
          }
        }
      } catch (_) {
        // 文件可能已被删除，静默处理
      }
    }
    // 活动文件加载失败时 fallback 到第一个成功的 tab
    if (activePath && !editorState.getFile(activePath)?.content && fallbackPath) {
      const file = editorState.getFile(fallbackPath);
      if (file) {
        editorState.setActiveFile(fallbackPath);
        eventBus.emit('file-opened', { path: fallbackPath, content: file.content });
      }
    }
  }

  /** 防抖保存工作区状态 */
  _saveWorkspaceStateDebounced() {
    clearTimeout(this._wsSaveTimer);
    this._wsSaveTimer = setTimeout(async () => {
      if (this._wsSwitching || !this._workspacePath) return;
      try {
        await this._saveCurrentWorkspace(this._workspacePath);
      } catch (_) {}
    }, 2000);
  }

  _updateTitle() {
    const appName = t('app.title');
    const filePath = editorState.activeFilePath;
    let title;
    if (filePath && !filePath.startsWith('__untitled_')) {
      title = `${filePath} - ${appName}`;
    } else if (this._workspacePath) {
      title = `${appName} - ${this._workspacePath}`;
    } else {
      title = appName;
    }
    document.title = title;
    if (window.__TAURI__) {
      try {
        const { getCurrentWindow } = window.__TAURI__.window;
        getCurrentWindow().setTitle(title);
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
    if (this._unlistenEditorState) this._unlistenEditorState();
    if (this._wsSaveTimer) clearTimeout(this._wsSaveTimer);
    if (this._titleFileHandler) {
      eventBus.off('file-opened', this._titleFileHandler);
      eventBus.off('file-closed', this._titleFileHandler);
    }
    if (this._wsHandler) eventBus.off('workspace-opened', this._wsHandler);
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
            <export-history-panel></export-history-panel>
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
