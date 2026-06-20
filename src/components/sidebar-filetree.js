import { LitElement, html, css } from 'lit';
import { listDirectory, listSubDirectory, readFile, deleteFile, renameFile, createFile, createDir } from '../services/file-service.js';
import { editorState } from '../services/editor-state.js';
import { eventBus } from '../services/event-bus.js';
import { showConfirm } from '../services/dialog.js';
import { isBinaryFile } from '../services/format-commands.js';
import { getRecentFiles, getRecentWorkspaces, setCurrentWorkspace, removeRecentWorkspace, addRecentFile, removeRecentFile } from '../services/config-service.js';
import { t } from '../services/i18n.js';

class SidebarFiletree extends LitElement {
  static properties = {
    entries: { type: Array },
    rootPath: { type: String },
    expanded: { state: true },
    recentFiles: { type: Array },
    recentWorkspaces: { type: Array },
    showWsMenu: { state: true },
    _treeCollapsed: { state: true },
    _recentCollapsed: { state: true },
    _inputDialog: { state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-size: 13px;
      font-family: var(--font-sans);
    }
    .ws-header {
      display: flex;
      align-items: center;
      padding: 6px 10px;
      font-weight: 600;
      color: var(--text-2);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      position: relative;
      background: rgba(0,0,0,0.02);
      border-bottom: 1px solid var(--border-subtle);
      gap: 4px;
    }
    .ws-header:hover {
      background: var(--bg-3);
    }
    .ws-header .arrow {
      font-size: 10px;
      opacity: 0.5;
    }
    .ws-header .refresh-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 13px;
      padding: 2px 4px;
      border-radius: 3px;
      opacity: 0.4;
      margin-left: auto;
      color: var(--text-2);
    }
    .ws-header .refresh-btn:hover {
      opacity: 0.8;
      background: var(--bg-3);
    }
    .ws-menu {
      position: absolute;
      top: 100%;
      left: 4px;
      right: 4px;
      background: var(--bg-3);
      border: 1px solid var(--border-medium);
      border-radius: 6px;
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
      z-index: 50;
      max-height: 50vh;
      overflow-y: auto;
      padding: 4px 0;
    }
    .ws-menu .ws-item {
      display: flex;
      align-items: center;
      padding: 6px 12px;
      cursor: pointer;
      gap: 6px;
      font-size: 12px;
      color: var(--text-2);
      transition: all 0.1s ease;
    }
    .ws-menu .ws-item:hover {
      background: var(--accent);
      color: #fff;
    }
    .ws-menu .ws-item.active {
      color: var(--accent);
      font-weight: 600;
    }
    .ws-menu .ws-item .ws-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ws-menu .ws-item .ws-path {
      font-size: 10px;
      color: var(--text-3);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ws-menu .ws-item .ws-remove {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 3px;
      font-size: 11px;
      color: var(--text-3);
      opacity: 0;
      transition: opacity 0.15s;
    }
    .ws-menu .ws-item:hover .ws-remove {
      opacity: 0.6;
      color: inherit;
    }
    .ws-menu .ws-item .ws-remove:hover {
      opacity: 1;
      background: rgba(255,255,255,0.2);
    }
    .empty {
      padding: 20px;
      color: var(--text-3);
      text-align: center;
      font-size: 12px;
    }
    .section {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .section-body {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
    }
    .section.collapsed .section-body {
      display: none;
    }
    .section.collapsed {
      flex: 0 0 auto !important;
    }
    .section-header {
      display: flex;
      align-items: center;
      padding: 6px 10px;
      font-weight: 600;
      color: var(--text-3);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      border-top: 1px solid var(--border-subtle);
      gap: 4px;
      user-select: none;
      flex-shrink: 0;
    }
    .section-header:hover {
      color: var(--text-2);
      background: var(--bg-3);
    }
    .section-header .toggle-icon {
      font-size: 8px;
      transition: transform 0.15s ease;
      width: 12px;
      text-align: center;
    }
    .section.collapsed .section-header .toggle-icon {
      transform: rotate(-90deg);
    }
    .item {
      display: flex;
      align-items: center;
      height: 28px;
      padding: 0 8px;
      cursor: pointer;
      border-radius: 4px;
      margin: 1px 4px;
      gap: 8px;
      color: var(--text-2);
      transition: background-color 0.15s ease;
      border-left: 2px solid transparent;
    }
    .item:hover {
      background: var(--bg-3);
      color: var(--text-1);
    }
    .item.active {
      background: var(--bg-1);
      border-left-color: var(--accent);
      color: var(--text-1);
      font-weight: 500;
    }
    .item .icon {
      width: 16px;
      text-align: center;
      flex-shrink: 0;
      font-size: 12px;
    }
    .item .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .input-dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 600;
    }
    .input-dialog {
      background: var(--bg-3);
      border: 1px solid var(--border-medium);
      border-radius: 8px;
      padding: 16px 20px;
      min-width: 320px;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.15);
    }
    .input-dialog-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-1);
      margin-bottom: 10px;
    }
    .input-dialog-field {
      width: 100%;
      padding: 6px 10px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      font-size: 13px;
      background: var(--bg-1);
      color: var(--text-1);
      outline: none;
      box-sizing: border-box;
    }
    .input-dialog-field:focus {
      border-color: var(--accent);
    }
    .input-dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 12px;
    }
    .input-dialog-btn {
      padding: 5px 16px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      border: 1px solid var(--border-medium);
      background: var(--bg-2);
      color: var(--text-2);
    }
    .input-dialog-btn:hover {
      background: var(--bg-3);
    }
    .input-dialog-btn.primary {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .input-dialog-btn.primary:hover {
      opacity: 0.9;
    }
  `;

  constructor() {
    super();
    this.entries = [];
    this.rootPath = '';
    this.expanded = new Set();
    this.recentFiles = [];
    this.recentWorkspaces = [];
    this.showWsMenu = false;
    this._treeCollapsed = false;
    this._recentCollapsed = false;
    this._inputDialog = null;
    this._inputResolve = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._wsHandler = (path) => this._loadDir(path);
    eventBus.on('workspace-opened', this._wsHandler);
    eventBus.on('file-saved', () => this.requestUpdate());
    this._ctxHandler = (action) => this._handleContextAction(action);
    eventBus.on('context-menu-action', this._ctxHandler);
    this._loadRecentFiles();
    this._loadRecentWorkspaces();
    this._langHandler = () => this.requestUpdate();
    eventBus.on('language-changed', this._langHandler);
    // 点击外部关闭工作区菜单
    this._closeMenuHandler = (e) => {
      if (this.showWsMenu && !e.composedPath().includes(this)) {
        this.showWsMenu = false;
      }
    };
    document.addEventListener('click', this._closeMenuHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._wsHandler) eventBus.off('workspace-opened', this._wsHandler);
    if (this._ctxHandler) eventBus.off('context-menu-action', this._ctxHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
    if (this._closeMenuHandler) document.removeEventListener('click', this._closeMenuHandler);
  }

  async _loadRecentFiles() {
    try {
      this.recentFiles = await getRecentFiles(this.rootPath || undefined);
    } catch (e) { this.recentFiles = []; }
  }

  async _loadRecentWorkspaces() {
    try {
      this.recentWorkspaces = await getRecentWorkspaces();
    } catch (e) { this.recentWorkspaces = []; }
  }

  async _loadDir(path) {
    try {
      this.rootPath = path;
      this.entries = await listDirectory(path);
      editorState.workspaceRoot = path;
      // 持久化当前工作区
      setCurrentWorkspace(path).catch(() => {});
      this._loadRecentWorkspaces();
      this._loadRecentFiles();
    } catch (e) {
      console.error('加载目录失败:', e);
    }
  }

  _switchWorkspace(path) {
    this.showWsMenu = false;
    eventBus.emit('workspace-opened', path);
  }

  /** 智能截断路径：前缀/…/尾部，保证在窄侧边栏中尾部不被截 */
  _shortenPath(path) {
    const segs = path.split('/').filter(Boolean);
    if (segs.length <= 4) return path;
    const abbr = segs.map(s => s === 'wsl.localhost' ? 'wsl' : s);
    // 前缀：取第一段（足够区分环境，尽量短）
    const head = abbr[0];
    // 尾部：祖父目录/父目录（ws-name 已显示文件夹名，不重复）
    const tail = segs.slice(-3, -1).join('/');
    return `${head}/…/${tail}`;
  }

  async _removeWorkspace(path) {
    try {
      await removeRecentWorkspace(path);
      await this._loadRecentWorkspaces();
      this.requestUpdate();
    } catch (_) {}
  }

  _toggleWsMenu(e) {
    e.stopPropagation();
    this.showWsMenu = !this.showWsMenu;
  }

  async _openFile(path) {
    // 二进制文件：跳过文本读取，直接以空内容打开
    if (isBinaryFile(path)) {
      editorState.openFile(path, '');
      eventBus.emit('file-opened', { path, content: '', binary: true });
      addRecentFile(path, this.rootPath || undefined).catch(() => {});
      this._loadRecentFiles();
      return;
    }
    try {
      const content = await readFile(path);
      editorState.openFile(path, content);
      eventBus.emit('file-opened', { path, content });
      // 记录最近文件
      addRecentFile(path, this.rootPath || undefined).catch(() => {});
      this._loadRecentFiles();
    } catch (e) {
      const msg = String(e?.message || e || '');
      if (msg.includes('No such file') || msg.includes('不存在') || msg.includes('not found')) {
        // 文件已删除，提示并从最近列表移除
        await removeRecentFile(path, this.rootPath || undefined);
        this.recentFiles = this.recentFiles.filter(f => f.path !== path);
        await showConfirm(t('sidebar.fileDeleted'));
      } else {
        console.error('打开文件失败:', e);
      }
    }
  }

  async _toggleDir(path) {
    if (this.expanded.has(path)) {
      this.expanded.delete(path);
    } else {
      // 按需加载子目录
      const entry = this._findEntry(this.entries, path);
      if (entry && !entry.children) {
        try {
          const children = await listSubDirectory(path);
          entry.children = children;
        } catch (e) {
          console.error('加载子目录失败:', e);
          return;
        }
      }
      this.expanded.add(path);
    }
    this.requestUpdate();
  }

  _findEntry(entries, path) {
    for (const entry of entries) {
      if (entry.path === path) return entry;
      if (entry.children) {
        const found = this._findEntry(entry.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  _showInputDialog(type, defaultValue = '') {
    return new Promise((resolve) => {
      this._inputResolve = resolve;
      this._inputDialog = { type, value: defaultValue };
      this.updateComplete.then(() => {
        const input = this.shadowRoot.querySelector('.input-dialog-field');
        if (input) {
          input.focus();
          if (type === 'rename') {
            const dotIdx = defaultValue.lastIndexOf('.');
            input.setSelectionRange(0, dotIdx > 0 ? dotIdx : defaultValue.length);
          } else {
            input.select();
          }
        }
      });
    });
  }

  _resolveInput(value) {
    if (!this._inputDialog) return;
    const resolve = this._inputResolve;
    this._inputDialog = null;
    this._inputResolve = null;
    resolve?.(value);
  }

  async _suggestNewFileName(parentPath) {
    const entry = this._findEntry(this.entries, parentPath);
    if (!entry) return 'untitled.adoc';
    if (!entry.children) {
      try { entry.children = await listSubDirectory(parentPath); }
      catch (_) { return 'untitled.adoc'; }
    }
    const existing = new Set(entry.children.map(e => e.name.toLowerCase()));
    if (!existing.has('untitled.adoc')) return 'untitled.adoc';
    let i = 1;
    while (existing.has(`untitled${i}.adoc`)) i++;
    return `untitled${i}.adoc`;
  }

  _renderInputDialog() {
    if (!this._inputDialog) return '';
    const { type, value } = this._inputDialog;
    const titles = {
      'new-file': t('file.menu.newFile'),
      'new-dir': t('file.menu.newDir'),
      'rename': t('file.menu.rename'),
    };
    return html`
      <div class="input-dialog-overlay" @click=${() => this._resolveInput(null)}>
        <div class="input-dialog" @click=${(e) => e.stopPropagation()}>
          <div class="input-dialog-title">${titles[type]}</div>
          <input class="input-dialog-field"
                 type="text"
                 .value=${value}
                 @keydown=${(e) => {
                   if (e.key === 'Enter') this._resolveInput(e.target.value.trim());
                   else if (e.key === 'Escape') this._resolveInput(null);
                 }} />
          <div class="input-dialog-actions">
            <button class="input-dialog-btn" @click=${() => this._resolveInput(null)}>${t('settings.cancel')}</button>
            <button class="input-dialog-btn primary" @click=${() => {
              const input = this.shadowRoot.querySelector('.input-dialog-field');
              this._resolveInput(input?.value.trim());
            }}>${t('dialog.ok')}</button>
          </div>
        </div>
      </div>
    `;
  }

  _onContextMenu(e, entry) {
    e.preventDefault();
    e.stopPropagation();
    const items = entry.is_dir ? [
      { label: t('file.menu.newFile'), action: { type: 'new-file', path: entry.path }, icon: '+' },
      { label: t('file.menu.newDir'), action: { type: 'new-dir', path: entry.path }, icon: '📁' },
      { separator: true },
      { label: t('file.menu.rename'), action: { type: 'rename', path: entry.path, name: entry.name }, icon: '✏' },
      { label: t('file.menu.delete'), action: { type: 'delete', path: entry.path }, icon: '🗑' },
      { separator: true },
      { label: t('file.menu.copyPath'), action: () => navigator.clipboard.writeText(entry.path), icon: '⎘' },
      { label: t('file.menu.revealInShell'), action: () => eventBus.emit('reveal-in-shell', entry.path), icon: '📂' },
    ] : [
      { label: t('file.menu.rename'), action: { type: 'rename', path: entry.path, name: entry.name }, icon: '✏' },
      { label: t('file.menu.delete'), action: { type: 'delete', path: entry.path }, icon: '🗑' },
      { separator: true },
      { label: t('file.menu.copyPath'), action: () => navigator.clipboard.writeText(entry.path), icon: '⎘' },
      { label: t('file.menu.revealInShell'), action: () => eventBus.emit('reveal-in-shell', entry.path), icon: '📂' },
    ];
    eventBus.emit('show-context-menu', { x: e.clientX, y: e.clientY, items });
  }

  async _handleContextAction(action) {
    if (!action) return;
    const { type, path, name } = action;
    if (type === 'delete') {
      if (!(await showConfirm(t('file.confirmDelete', { name: name || path })))) return;
      try {
        await deleteFile(path);
        if (editorState.files.has(path)) {
          editorState.closeFile(path);
          eventBus.emit('file-closed', path);
        }
        await this._refresh();
      } catch (e) { console.error('删除失败:', e); }
    } else if (type === 'rename') {
      const newName = await this._showInputDialog('rename', name);
      if (!newName || newName === name) return;
      const parent = path.substring(0, path.lastIndexOf('/'));
      const newPath = `${parent}/${newName}`;
      try {
        await renameFile(path, newPath);
        editorState.renameFile(path, newPath);
        eventBus.emit('file-renamed', { oldPath: path, newPath });
        await this._refresh();
      } catch (e) { console.error('重命名失败:', e); }
    } else if (type === 'new-file') {
      const defaultName = await this._suggestNewFileName(path);
      const fileName = await this._showInputDialog('new-file', defaultName);
      if (!fileName) return;
      const newPath = `${path}/${fileName}`;
      try {
        await createFile(newPath);
        await this._refresh();
        // 创建成功后立即在编辑器中打开新文件
        await this._openFile(newPath);
      } catch (e) { console.error('创建文件失败:', e); }
    } else if (type === 'new-dir') {
      const dirName = await this._showInputDialog('new-dir', '');
      if (!dirName) return;
      try {
        await createDir(`${path}/${dirName}`);
        await this._refresh();
      } catch (e) { console.error('创建文件夹失败:', e); }
    }
  }

  async _refresh() {
    if (!this.rootPath) return;
    const expandedPaths = [...this.expanded];
    try {
      this.entries = await listDirectory(this.rootPath);
    } catch (e) {
      console.error('刷新目录失败:', e);
      return;
    }
    for (const dirPath of expandedPaths) {
      const entry = this._findEntry(this.entries, dirPath);
      if (entry) {
        try { entry.children = await listSubDirectory(dirPath); }
        catch (_) { /* 目录可能已被删除/重命名 */ }
      }
    }
    this.expanded = new Set(expandedPaths);
    this.requestUpdate();
  }

  _renderEntries(entries, depth = 0) {
    if (!entries) return html``;
    return entries.map((entry) => {
      const indent = `${depth * 16 + 8}px`;
      const isActive = editorState.activeFilePath === entry.path;
      if (entry.is_dir) {
        const isExpanded = this.expanded.has(entry.path);
        return html`
          <div class="item" style="padding-left:${indent}"
               @click=${() => this._toggleDir(entry.path)}
               @contextmenu=${(e) => this._onContextMenu(e, entry)}>
            <span class="icon">${isExpanded ? '📂' : '📁'}</span>
            <span class="name">${entry.name}</span>
          </div>
          ${isExpanded ? this._renderEntries(entry.children || [], depth + 1) : ''}
        `;
      }
      return html`
        <div class="item ${isActive ? 'active' : ''}" style="padding-left:${indent}"
             @click=${() => this._openFile(entry.path)}
             @contextmenu=${(e) => this._onContextMenu(e, entry)}>
          <span class="icon">📄</span>
          <span class="name">${entry.name}</span>
        </div>
      `;
    });
  }

  render() {
    const hasEntries = this.entries.length > 0;
    const hasRecent = this.recentFiles && this.recentFiles.length > 0;
    const wsName = this.rootPath ? this.rootPath.split('/').pop() : '';

    if (!hasEntries && !hasRecent) {
      return html`<div class="empty">${t('sidebar.empty')}</div>${this._renderInputDialog()}`;
    }

    return html`
      ${hasEntries ? html`
        <div class="ws-header" @click=${this._toggleWsMenu}>
          📂 ${wsName}
          <span class="arrow">${this.recentWorkspaces.length > 1 ? '▾' : ''}</span>
          <button class="refresh-btn" @click=${(e) => { e.stopPropagation(); this._refresh(); }} title="${t('sidebar.refresh')}">↻</button>
          ${this.showWsMenu && this.recentWorkspaces.length > 1 ? html`
            <div class="ws-menu">
              ${this.recentWorkspaces.map((ws) => html`
                <div class="ws-item ${ws.path === this.rootPath ? 'active' : ''}"
                     @click=${(e) => { e.stopPropagation(); this._switchWorkspace(ws.path); }}>
                  <span>📁</span>
                  <div style="flex:1;min-width:0">
                    <div class="ws-name">${ws.path.split('/').pop()}</div>
                    <div class="ws-path" title="${ws.path}">${this._shortenPath(ws.path)}</div>
                  </div>
                  ${ws.path !== this.rootPath ? html`
                    <span class="ws-remove" title="${t('sidebar.removeWorkspace')}"
                          @click=${(e) => { e.stopPropagation(); this._removeWorkspace(ws.path); }}>×</span>
                  ` : ''}
                </div>
              `)}
            </div>
          ` : ''}
        </div>
        <div class="section ${this._treeCollapsed ? 'collapsed' : ''}" style="flex:3">
          <div class="section-header" @click=${() => { this._treeCollapsed = !this._treeCollapsed; }}>
            <span class="toggle-icon">▾</span> ${t('sidebar.files')}
          </div>
          <div class="section-body">${this._renderEntries(this.entries)}</div>
        </div>
      ` : ''}
      ${hasRecent ? html`
        <div class="section ${this._recentCollapsed ? 'collapsed' : ''}" style="flex:1">
          <div class="section-header" @click=${() => { this._recentCollapsed = !this._recentCollapsed; }}>
            <span class="toggle-icon">▾</span> ${t('sidebar.recent')}
          </div>
          <div class="section-body">
            ${this.recentFiles.map((f) => {
              const name = f.path.split('/').pop();
              return html`
                <div class="item" @click=${() => this._openFile(f.path)}>
                  <span class="icon">📄</span>
                  <span class="name" title="${f.path}">${name}</span>
                </div>
              `;
            })}
          </div>
        </div>
      ` : ''}
      ${this._renderInputDialog()}
    `;
  }
}

customElements.define('sidebar-filetree', SidebarFiletree);
