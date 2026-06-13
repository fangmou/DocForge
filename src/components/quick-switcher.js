import { LitElement, html, css } from 'lit';
import { editorState } from '../services/editor-state.js';
import { eventBus } from '../services/event-bus.js';
import { t } from '../services/i18n.js';
import { listAllAdocFiles, readFile } from '../services/file-service.js';
import { getRecentFiles, getRecentWorkspaces } from '../services/config-service.js';

/**
 * 快捷切换器 — 三种模式共用一个组件
 * - tabSwitcher: Ctrl+Tab  IDEA 风格切换（打开的文件 + 视图/工具）
 * - fileOpener:  Ctrl+P    文件快速打开（模糊搜索）
 * - workspaceSwitcher: Ctrl+Alt+\ 工作空间切换
 */
class QuickSwitcher extends LitElement {
  static properties = {
    visible: { type: Boolean },
    mode: { type: String },
    query: { type: String },
    items: { type: Array },
    selectedIndex: { type: Number },
  };

  static styles = css`
    :host {
      display: none;
    }
    :host(.visible) {
      display: flex;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      z-index: 150;
    }
    .backdrop {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.45);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 15vh;
    }
    .modal {
      background: var(--bg-2);
      border-radius: 10px;
      border: 1px solid var(--border-medium);
      width: 720px;
      max-height: 460px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 32px rgba(0,0,0,0.24);
      overflow: hidden;
    }
    .modal.tab-layout {
      flex-direction: row;
    }
    .tab-col {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .tab-col.views-col {
      width: 160px;
      min-width: 160px;
      flex-shrink: 0;
    }
    .tab-col.files-col {
      flex: 1;
      min-width: 0;
    }
    .tab-col + .tab-col {
      border-left: 1px solid var(--border-subtle);
    }
    .search-bar {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .search-bar input {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--border-medium);
      border-radius: 6px;
      background: var(--bg-1);
      color: var(--text-1);
      font-size: 14px;
      font-family: var(--font-sans);
      outline: none;
    }
    .search-bar input:focus {
      border-color: var(--accent);
    }
    .tab-hint {
      padding: 8px 14px;
      font-size: 12px;
      color: var(--text-3);
      border-bottom: 1px solid var(--border-subtle);
    }
    .item-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }
    .section-header {
      padding: 8px 16px 3px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-3);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      user-select: none;
    }
    .item {
      display: flex;
      align-items: flex-start;
      padding: 6px 16px;
      gap: 10px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text-2);
      transition: background 0.08s;
      user-select: none;
    }
    .item:hover {
      background: var(--bg-3);
    }
    .item.selected {
      background: var(--accent);
      color: #fff;
    }
    .item .icon {
      width: 20px;
      text-align: center;
      flex-shrink: 0;
      font-size: 14px;
      margin-top: 1px;
    }
    .item .info {
      flex: 1;
      min-width: 0;
    }
    .item .name {
      font-weight: 500;
      color: var(--text-1);
      white-space: nowrap;
    }
    .item.selected .name {
      color: #fff;
    }
    .item .sub {
      color: var(--text-3);
      font-size: 11px;
      font-family: var(--font-mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.3;
      margin-top: 1px;
    }
    .item.selected .sub {
      color: rgba(255,255,255,0.6);
    }
    .item .dirty-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--accent);
      flex-shrink: 0;
      margin-top: 5px;
    }
    .item.selected .dirty-dot {
      background: #fff;
    }
    .item .active-bar {
      width: 3px;
      height: 18px;
      border-radius: 2px;
      background: var(--accent);
      flex-shrink: 0;
      margin-top: 2px;
    }
    .item.selected .active-bar {
      background: #fff;
    }
    .item mark {
      background: var(--accent);
      color: #fff;
      border-radius: 2px;
      padding: 0 1px;
    }
    .item.selected mark {
      background: rgba(255,255,255,0.3);
      color: #fff;
    }
    .empty {
      color: var(--text-3);
      text-align: center;
      padding: 32px 16px;
      font-size: 13px;
    }
    .spacer {
      width: 3px;
      flex-shrink: 0;
    }
    .active-indicator {
      background: var(--color-success) !important;
    }
  `;

  /** 视图/工具项定义（labelKey 复用 shortcuts.* 已有翻译） */
  static VIEW_ITEMS = [
    { id: 'sidebar',    labelKey: 'shortcuts.toggleSidebar',    icon: '◧', event: 'toggle-sidebar' },
    { id: 'preview',    labelKey: 'shortcuts.togglePreview',    icon: '⊘', event: 'toggle-preview' },
    { id: 'outline',    labelKey: 'shortcuts.toggleOutline',    icon: '☰', event: 'toggle-outline' },
    { id: 'search',     labelKey: 'shortcuts.search',           icon: '⌕', event: 'toggle-search' },
    { id: 'ai',         labelKey: 'shortcuts.toggleAI',         icon: '★', event: 'toggle-ai-panel' },
    { id: 'backlinks',  labelKey: 'shortcuts.toggleBacklinks',  icon: '←', event: 'toggle-backlinks' },
    { id: 'tags',       labelKey: 'shortcuts.toggleTags',       icon: '#', event: 'toggle-tags-panel' },
    { id: 'graph',      labelKey: 'shortcuts.toggleGraph',      icon: '◉', event: 'toggle-graph-view' },
    { id: 'template',   labelKey: 'template.panelTitle',        icon: '▣', event: 'toggle-template-panel' },
    { id: 'exportHist', labelKey: 'exportHistory.title',        icon: '↑', event: 'toggle-export-history' },
    { id: 'plugin',     labelKey: 'shortcuts.togglePlugin',     icon: '⧉', event: 'toggle-plugin-manager' },
  ];

  constructor() {
    super();
    this.visible = false;
    this.mode = '';
    this.query = '';
    this.items = [];
    this.selectedIndex = 0;
    // 内部缓存
    this._allFiles = null;
    this._allFilesWs = null;
    this._recentFiles = [];
    this._workspaces = [];
    // 绑定方法
    this._onWindowKeyDown = this._onWindowKeyDown.bind(this);
    this._onWindowKeyUp = this._onWindowKeyUp.bind(this);
    this._onWindowBlur = this._onWindowBlur.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    this._onLangChanged = () => this.requestUpdate();
    eventBus.on('language-changed', this._onLangChanged);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._detachWindowListeners();
    eventBus.off('language-changed', this._onLangChanged);
  }

  _attachWindowListeners() {
    window.addEventListener('keydown', this._onWindowKeyDown, true);
    window.addEventListener('keyup', this._onWindowKeyUp, true);
    window.addEventListener('blur', this._onWindowBlur);
  }

  _detachWindowListeners() {
    window.removeEventListener('keydown', this._onWindowKeyDown, true);
    window.removeEventListener('keyup', this._onWindowKeyUp, true);
    window.removeEventListener('blur', this._onWindowBlur);
  }

  /** 打开切换器 */
  async show(mode) {
    if (this.visible) return; // 防重入
    this.mode = mode;
    this.visible = true;
    this.classList.add('visible');
    this.query = '';
    this.selectedIndex = 0;
    this._attachWindowListeners();
    await this._loadData();
    this._buildItems();
    // tabSwitcher 默认选中当前活动项的下一个（IDEA 行为）
    if (mode === 'tabSwitcher') {
      const activeIdx = this.items.findIndex(i =>
        i.type === 'file' && i.path === editorState.activeFilePath);
      this.selectedIndex = activeIdx >= 0 && this.items.length > 1
        ? (activeIdx + 1) % this.items.length
        : 0;
    }
    await this.updateComplete;
    // 聚焦搜索框（fileOpener / workspaceSwitcher 模式）
    if (mode !== 'tabSwitcher') {
      const input = this.shadowRoot.querySelector('.search-bar input');
      if (input) input.focus();
    }
  }

  /** 关闭切换器 */
  hide() {
    this.visible = false;
    this.classList.remove('visible');
    this._detachWindowListeners();
  }

  /** 加载数据 */
  async _loadData() {
    if (this.mode === 'tabSwitcher') return; // 用 editorState，无需异步

    if (this.mode === 'fileOpener') {
      const ws = editorState.workspaceRoot;
      if (!this._allFiles || this._allFilesWs !== ws) {
        try {
          this._allFiles = await listAllAdocFiles(ws || '');
          this._allFilesWs = ws;
        } catch (_) {
          this._allFiles = [];
        }
        try {
          this._recentFiles = await getRecentFiles(ws) || [];
        } catch (_) {
          this._recentFiles = [];
        }
      }
      return;
    }

    if (this.mode === 'workspaceSwitcher') {
      try {
        this._workspaces = await getRecentWorkspaces() || [];
      } catch (_) {
        this._workspaces = [];
      }
    }
  }

  /** 构建显示列表 */
  _buildItems() {
    if (this.mode === 'tabSwitcher') {
      this._buildTabItems();
    } else if (this.mode === 'fileOpener') {
      this._buildFileItems();
    } else {
      this._buildWorkspaceItems();
    }
    // 保证 selectedIndex 在范围内
    if (this.selectedIndex >= this.items.length) {
      this.selectedIndex = Math.max(0, this.items.length - 1);
    }
  }

  _buildTabItems() {
    const openFiles = editorState.getOpenFiles();
    const ws = editorState.workspaceRoot || '';
    const viewItems = QuickSwitcher.VIEW_ITEMS.map(v => ({
      type: 'view',
      id: v.id,
      name: t(v.labelKey),
      icon: v.icon,
      event: v.event,
      isActive: this._isViewActive(v.id),
    }));
    const fileItems = openFiles.map(f => ({
      type: 'file',
      path: f.path,
      name: f.name,
      rel: ws && f.path.startsWith(ws + '/') ? f.path.slice(ws.length + 1) : f.path,
      isDirty: f.isDirty,
      isActive: f.path === editorState.activeFilePath,
    }));
    this.items = [...fileItems, ...viewItems];
  }

  _buildFileItems() {
    const ws = editorState.workspaceRoot || '';
    const recentSet = new Set(this._recentFiles.map(r => r.path));

    if (!this.query) {
      // 无搜索词：最近文件 + 全部文件（排除已在最近中的）
      const recentItems = this._recentFiles
        .filter(r => this._allFiles.includes(r.path))
        .map(r => this._makeFileItem(r.path, ws, true));
      const restItems = this._allFiles
        .filter(p => !recentSet.has(p))
        .map(p => this._makeFileItem(p, ws, false));
      this.items = [...recentItems, ...restItems];
      return;
    }

    // 模糊搜索
    const scored = this._allFiles
      .map(p => {
        const name = p.split('/').pop();
        const score = this._fuzzyScore(this.query.toLowerCase(), name.toLowerCase());
        return { path: p, score };
      })
      .filter(x => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    this.items = scored.map(x => this._makeFileItem(x.path, ws, recentSet.has(x.path)));
  }

  _buildWorkspaceItems() {
    if (!this.query) {
      this.items = this._workspaces.map(w => this._makeWorkspaceItem(w.path));
      return;
    }
    const q = this.query.toLowerCase();
    this.items = this._workspaces
      .filter(w => w.path.toLowerCase().includes(q))
      .map(w => this._makeWorkspaceItem(w.path));
  }

  _makeFileItem(absPath, wsRoot, isRecent) {
    const name = absPath.split('/').pop();
    const rel = wsRoot && absPath.startsWith(wsRoot + '/')
      ? absPath.slice(wsRoot.length + 1)
      : absPath;
    return { type: 'file', path: absPath, name, rel, isRecent, isCached: !!editorState.getFile(absPath) };
  }

  _makeWorkspaceItem(path) {
    const name = path.split('/').filter(Boolean).pop() || path;
    return { type: 'workspace', path, name };
  }

  /** 检查视图项是否已激活（仅对可可靠判断状态的视图） */
  _isViewActive(id) {
    if (id === 'sidebar') {
      const shell = document.querySelector('app-shell');
      return shell?.sidebarVisible ?? false;
    }
    if (id === 'preview') {
      const shell = document.querySelector('app-shell');
      return shell?.previewVisible ?? false;
    }
    return false;
  }

  /** 模糊匹配评分 */
  _fuzzyScore(query, target) {
    let qi = 0;
    let score = 0;
    let lastMatchIdx = -2;
    for (let ti = 0; ti < target.length && qi < query.length; ti++) {
      if (target[ti] === query[qi]) {
        // 连续匹配加分
        if (ti === lastMatchIdx + 1) score += 10;
        // 首字符或分隔符后匹配加分
        else if (ti === 0 || '/._-'.includes(target[ti - 1])) score += 5;
        else score += 1;
        lastMatchIdx = ti;
        qi++;
      }
    }
    return qi === query.length ? score : -1;
  }

  /** 高亮匹配字符（转义特殊字符后插入 <mark>） */
  _highlightMatch(name, query) {
    if (!query) return name;
    const qLower = query.toLowerCase();
    const nLower = name.toLowerCase();
    let qi = 0;
    let result = '';
    for (let i = 0; i < name.length; i++) {
      const ch = name[i];
      const escaped = ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch === '"' ? '&quot;' : ch;
      if (qi < qLower.length && nLower[i] === qLower[qi]) {
        result += `<mark>${escaped}</mark>`;
        qi++;
      } else {
        result += escaped;
      }
    }
    return result;
  }

  // === 事件处理 ===

  _onSearchInput(e) {
    this.query = e.target.value;
    this._buildItems();
    this.selectedIndex = 0;
  }

  _onItemClick(index) {
    this.selectedIndex = index;
    this._activateSelected();
  }

  _onItemMouseEnter(index) {
    this.selectedIndex = index;
  }

  /** 模态内部键盘 */
  _onInnerKeyDown(e) {
    if (this.mode === 'tabSwitcher') {
      // tabSwitcher 模式下不拦截，交给 window 级处理
      return;
    }
    const handled = this._handleNavKeys(e);
    if (handled) e.preventDefault();
  }

  _handleNavKeys(e) {
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % Math.max(1, this.items.length);
      this._scrollIntoView();
      return true;
    }
    if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % Math.max(1, this.items.length);
      this._scrollIntoView();
      return true;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this._activateSelected();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
      return true;
    }
    return false;
  }

  /** window 级键盘（用于 tabSwitcher 的 Ctrl+Tab） */
  _onWindowKeyDown(e) {
    if (!this.visible) return;

    // tabSwitcher 模式
    if (this.mode === 'tabSwitcher') {
      if (e.key === 'Tab' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        const dir = e.shiftKey ? -1 : 1;
        this.selectedIndex = (this.selectedIndex + dir + this.items.length) % Math.max(1, this.items.length);
        this._scrollIntoView();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
        return;
      }
      // 其他键：直接关闭并激活
      if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
        this._activateSelected();
      }
      return;
    }

    // 其他模式：在 input 内的按键由 _onInnerKeyDown 处理
    // 但 ESC 需要在 window 级也能捕获
    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
    }
  }

  /** window 级键盘释放（Ctrl 松开时激活 tabSwitcher 选中项） */
  _onWindowKeyUp(e) {
    if (!this.visible || this.mode !== 'tabSwitcher') return;
    if (e.key === 'Control' || e.key === 'Meta') {
      this._activateSelected();
    }
  }

  /** 窗口失焦时自动关闭 */
  _onWindowBlur() {
    if (this.visible && this.mode === 'tabSwitcher') {
      this._activateSelected();
    }
  }

  /** 点击背景关闭 */
  _onBackdropClick(e) {
    if (e.target === e.currentTarget) {
      this.hide();
    }
  }

  /** 滚动选中项到可视区 */
  _scrollIntoView() {
    this.updateComplete.then(() => {
      const el = this.shadowRoot.querySelector('.item.selected');
      if (el) el.scrollIntoView({ block: 'nearest' });
    });
  }

  /** 激活选中项 */
  async _activateSelected() {
    const item = this.items[this.selectedIndex];
    this.hide();
    if (!item) return;

    if (item.type === 'file') {
      // 优先从缓存取内容
      const cached = editorState.getFile(item.path);
      let content = cached ? cached.content : undefined;
      if (content === undefined) {
        try {
          content = await readFile(item.path);
        } catch (_) { return; }
      }
      editorState.openFile(item.path, content);
      eventBus.emit('file-opened', { path: item.path, content });
    } else if (item.type === 'view') {
      eventBus.emit(item.event);
    } else if (item.type === 'workspace') {
      eventBus.emit('workspace-opened', item.path);
    }
  }

  // === 渲染 ===

  render() {
    if (!this.visible) return html``;

    return html`
      <div class="backdrop" @click=${this._onBackdropClick}>
        <div class="modal ${this.mode === 'tabSwitcher' ? 'tab-layout' : ''}" @keydown=${this._onInnerKeyDown}>
          ${this.mode === 'tabSwitcher' ? this._renderTabSwitcher()
            : this.mode === 'fileOpener' ? this._renderFileOpener()
            : this._renderWorkspaceSwitcher()}
        </div>
      </div>
    `;
  }

  _renderTabSwitcher() {
    const openFiles = this.items.filter(i => i.type === 'file');
    const viewItems = this.items.filter(i => i.type === 'view');
    const fileCount = openFiles.length;

    return html`
      <div class="tab-col views-col">
        <div class="tab-hint">${t('quickSwitcher.views')}</div>
        <div class="item-list">
          ${viewItems.length ? viewItems.map((item, i) => {
            const gi = fileCount + i;
            return html`
              <div class="item ${gi === this.selectedIndex ? 'selected' : ''}"
                   @click=${() => this._onItemClick(gi)}
                   @mouseenter=${() => this._onItemMouseEnter(gi)}>
                <span class="icon">${item.icon}</span>
                <span class="name">${item.name}</span>
                ${item.isActive ? html`<span class="dirty-dot active-indicator"></span>` : ''}
              </div>
            `;
          }) : html`<div class="empty">${t('quickSwitcher.noOpenFiles')}</div>`}
        </div>
      </div>
      <div class="tab-col files-col">
        <div class="tab-hint">${t('quickSwitcher.openFiles')}</div>
        <div class="item-list">
          ${openFiles.length ? openFiles.map((item, i) => html`
              <div class="item ${i === this.selectedIndex ? 'selected' : ''}"
                   @click=${() => this._onItemClick(i)}
                   @mouseenter=${() => this._onItemMouseEnter(i)}>
                ${item.isActive ? html`<span class="active-bar"></span>` : html`<span class="spacer"></span>`}
                <span class="info">
                  <span class="name">${item.name}${item.isDirty ? ' ●' : ''}</span>
                  <span class="sub">${item.rel}</span>
                </span>
              </div>
          `) : html`<div class="empty">${t('quickSwitcher.noOpenFiles')}</div>`}
        </div>
      </div>
    `;
  }

  _renderFileOpener() {
    return html`
      <div class="search-bar">
        <input type="text"
               .value=${this.query}
               @input=${this._onSearchInput}
               placeholder=${t('quickSwitcher.filePlaceholder')} />
      </div>
      <div class="item-list">
        ${this._renderFileList()}
      </div>
    `;
  }

  _renderFileList() {
    if (!this.items.length) {
      return html`<div class="empty">${t('quickSwitcher.noResults')}</div>`;
    }

    // 如果无搜索词，分"最近"和"全部"两组
    if (!this.query) {
      const recent = this.items.filter(i => i.isRecent);
      const rest = this.items.filter(i => !i.isRecent);
      return html`
        ${recent.length ? html`
          <div class="section-header">${t('quickSwitcher.recent')}</div>
          ${recent.map((item, i) => this._renderFileItem(item, i))}
        ` : ''}
        ${rest.length ? html`
          <div class="section-header">${t('quickSwitcher.allFiles')}</div>
          ${rest.map((item, i) => this._renderFileItem(item, recent.length + i))}
        ` : ''}
      `;
    }

    return this.items.map((item, i) => this._renderFileItem(item, i));
  }

  _renderFileItem(item, index) {
    const nameHtml = this.query
      ? this._highlightMatch(item.name, this.query)
      : item.name;
    return html`
      <div class="item ${index === this.selectedIndex ? 'selected' : ''}"
           @click=${() => this._onItemClick(index)}
           @mouseenter=${() => this._onItemMouseEnter(index)}>
        <span class="icon">${item.isCached ? '📄' : '📃'}</span>
        <span class="info">
          <span class="name" .innerHTML=${nameHtml}></span>
          <span class="sub">${item.rel}</span>
        </span>
      </div>
    `;
  }

  _renderWorkspaceSwitcher() {
    return html`
      <div class="search-bar">
        <input type="text"
               .value=${this.query}
               @input=${this._onSearchInput}
               placeholder=${t('quickSwitcher.wsPlaceholder')} />
      </div>
      <div class="item-list">
        ${!this.items.length ? html`
          <div class="empty">${t('quickSwitcher.noWorkspaces')}</div>
        ` : this.items.map((item, i) => html`
          <div class="item ${i === this.selectedIndex ? 'selected' : ''}"
               @click=${() => this._onItemClick(i)}
               @mouseenter=${() => this._onItemMouseEnter(i)}>
            <span class="icon">📁</span>
            <span class="info">
              <span class="name">${item.name}</span>
              <span class="sub">${item.path}</span>
            </span>
          </div>
        `)}
      </div>
    `;
  }
}

customElements.define('quick-switcher', QuickSwitcher);
