import { LitElement, html, css } from 'lit';
import { editorState, untitledName } from '../services/editor-state.js';
import { eventBus } from '../services/event-bus.js';
import { t } from '../services/i18n.js';
import { activateOnKey } from '../services/a11y.js';
import { showSaveConfirm } from '../services/dialog.js';
import { partitionOverflow } from '../services/tab-overflow.js';

class TabBar extends LitElement {
  static properties = {
    files: { type: Array },
    activePath: { type: String },
    _leftOverflow: { state: true },
    _rightOverflow: { state: true },
    _openMenu: { state: true }, // 'left' | 'right' | ''
  };

  static styles = css`
    :host {
      display: flex;
      align-items: stretch;
      position: relative; /* .overflow-menu 的定位基准 */
      height: var(--tab-height);
      background: var(--bg-2);
      border-bottom: 1px solid var(--border-subtle);
    }
    .tabs-track {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: stretch;
      overflow-x: auto;
      overflow-y: hidden;
      position: relative; /* .tab 的 offsetLeft 相对本容器 */
      scrollbar-width: none; /* Firefox：隐藏横向滚动条 */
    }
    .tabs-track::-webkit-scrollbar {
      display: none; /* WebKit：隐藏横向滚动条 */
    }
    .tab {
      display: flex;
      align-items: center;
      padding: 0 16px;
      gap: 6px;
      cursor: pointer;
      border-right: 1px solid var(--border-subtle);
      border-top: 2px solid transparent;
      font-size: 13px;
      color: var(--text-2);
      white-space: nowrap;
      flex-shrink: 0; /* 不被 track 压缩：tab 保持可读宽度，超出才溢出走滚动 + 更多按钮 */
      min-width: 0;
      max-width: 160px;
      transition: all 0.15s ease;
      user-select: none;
    }
    .tab:hover {
      background: var(--bg-3);
      color: var(--text-1);
    }
    .tab.active {
      background: var(--bg-1);
      border-top-color: var(--accent);
      color: var(--text-1);
      font-weight: 500;
    }
    .tab.drag-over {
      border-left: 2px solid var(--accent);
    }
    .tab.dragging {
      opacity: 0.4;
    }
    .tab .dirty {
      color: var(--accent);
      font-size: 8px;
    }
    .tab .conflict {
      color: var(--color-error);
      font-size: 8px;
    }
    .tab .close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 3px;
      font-size: 11px;
      opacity: 0; /* 默认隐藏，降噪；仅 hover/active/聚焦时显示 */
      color: var(--text-2);
      transition: opacity 0.15s ease;
    }
    .tab:hover .close,
    .tab.active .close,
    .tab .close:focus-visible {
      opacity: 0.85;
    }
    .tab .close:hover {
      opacity: 1;
      background: var(--bg-3);
      color: var(--text-1);
    }
    .tab .name {
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0; /* 配合 .tab max-width 收缩并显示省略号 */
    }
    /* 两端「⋯ 更多」按钮：仅对应方向有溢出 tab 时渲染 */
    .more-btn {
      flex-shrink: 0;
      width: 28px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg-2);
      border: none;
      border-right: 1px solid var(--border-subtle);
      color: var(--text-2);
      font-size: 14px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .more-btn.right {
      border-right: none;
      border-left: 1px solid var(--border-subtle);
    }
    .more-btn:hover {
      background: var(--bg-3);
      color: var(--text-1);
    }
    /* 溢出下拉面板：复刻 sidebar-filetree 的 .ws-menu 范式 */
    .overflow-menu {
      position: absolute;
      top: 100%;
      min-width: 180px;
      max-width: 300px;
      max-height: 60vh;
      overflow-y: auto;
      background: var(--bg-3);
      border: 1px solid var(--border-medium);
      border-radius: 6px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.15);
      z-index: 50;
      padding: 4px 0;
    }
    .overflow-menu.left { left: 0; }
    .overflow-menu.right { right: 0; }
    .overflow-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text-2);
      transition: background 0.1s ease;
    }
    .overflow-item:hover {
      background: var(--accent);
      color: #fff;
    }
    .overflow-item.active {
      color: var(--accent);
      font-weight: 600;
    }
    .overflow-item:hover.active {
      color: #fff;
    }
    .overflow-item .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .overflow-item .dirty {
      color: var(--accent);
      font-size: 8px;
    }
    .overflow-item .conflict {
      color: var(--color-error);
      font-size: 8px;
    }
    .overflow-item .close {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 3px;
      font-size: 11px;
      opacity: 0;
    }
    .overflow-item:hover .close {
      opacity: 0.8;
    }
    .overflow-item .close:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.2);
    }
  `;

  constructor() {
    super();
    this.files = [];
    this.activePath = '';
    this._dragSrcPath = null;
    this._leftOverflow = [];
    this._rightOverflow = [];
    this._openMenu = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._unsub = editorState.onChange(() => {
      const prevActive = this.activePath;
      this.files = editorState.getOpenFiles();
      this.activePath = editorState.activeFilePath;
      // DOM 渲染后重算溢出；active 变化时还要把它滚动进可视区
      this.updateComplete.then(() => {
        if (this.activePath && this.activePath !== prevActive) {
          this._scrollActiveIntoView();
        } else {
          this._scheduleOverflow();
        }
      });
    });
    this._closeActiveHandler = () => {
      const active = editorState.activeFilePath;
      if (active) this._closeTab(active, null);
    };
    eventBus.on('close-active-tab', this._closeActiveHandler);

    // 点击外部关闭溢出菜单（复刻 sidebar-filetree 的 composedPath 判断）
    this._closeMenuHandler = (e) => {
      if (this._openMenu && !e.composedPath().includes(this)) {
        this._openMenu = '';
      }
    };
    document.addEventListener('click', this._closeMenuHandler);
    // Esc 关闭溢出菜单
    this._keydownHandler = (e) => {
      if (e.key === 'Escape' && this._openMenu) this._openMenu = '';
    };
    document.addEventListener('keydown', this._keydownHandler);

    // 容器尺寸变化（窗口缩放、侧边栏开合）时重算溢出
    this._ro = new ResizeObserver(() => this._scheduleOverflow());
    this.updateComplete.then(() => {
      const track = this.shadowRoot?.querySelector('.tabs-track');
      if (track) this._ro.observe(track);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    if (this._closeActiveHandler) eventBus.off('close-active-tab', this._closeActiveHandler);
    if (this._closeMenuHandler) document.removeEventListener('click', this._closeMenuHandler);
    if (this._keydownHandler) document.removeEventListener('keydown', this._keydownHandler);
    if (this._overflowRaf != null) cancelAnimationFrame(this._overflowRaf);
    this._ro?.disconnect();
  }

  /** 用 rAF 合并高频触发（scroll/resize/按键），一帧只算一次，避免反复 forced synchronous layout */
  _scheduleOverflow() {
    if (this._overflowRaf != null) return;
    this._overflowRaf = requestAnimationFrame(() => {
      this._overflowRaf = null;
      this._computeOverflow();
    });
  }

  /** 测量各 tab 几何，分区出左/右溢出的 path 列表并写入 reactive state */
  _computeOverflow() {
    const track = this.shadowRoot?.querySelector('.tabs-track');
    if (!track) return;
    const items = [...track.querySelectorAll('.tab')].map((el) => ({
      path: el.dataset.path,
      left: el.offsetLeft,
      right: el.offsetLeft + el.offsetWidth,
    }));
    let { left, right } = partitionOverflow(items, track.scrollLeft, track.clientWidth);
    // active tab 由 _scrollActiveIntoView 保证可见，排除出溢出列表：
    // 避免 subpixel 导致它贴边界时被误判为溢出、进而在下拉里重复出现
    // （如激活末位 tab 时它贴右边缘，右「更多」误显示且下拉重复列出它）
    if (this.activePath) {
      left = left.filter((p) => p !== this.activePath);
      right = right.filter((p) => p !== this.activePath);
    }
    // 仅在变化时更新，避免无谓重渲染
    if (!pathsEq(left, this._leftOverflow)) this._leftOverflow = left;
    if (!pathsEq(right, this._rightOverflow)) this._rightOverflow = right;
    // 菜单打开但其方向已无溢出 → 关闭
    if (this._openMenu === 'left' && !left.length) this._openMenu = '';
    else if (this._openMenu === 'right' && !right.length) this._openMenu = '';
  }

  /** 把当前激活 tab 滚动进可视区，随后重算溢出。
   *  直接操控 track.scrollLeft，而非 scrollIntoView——后者会沿祖先链对所有 scroll container
   *  施加滚动，可能波及 .body 等祖先的垂直滚动；这里只需水平方向。 */
  _scrollActiveIntoView() {
    const track = this.shadowRoot?.querySelector('.tabs-track');
    const active = track?.querySelector('.tab.active');
    if (track && active) {
      const aLeft = active.offsetLeft;
      const aRight = aLeft + active.offsetWidth;
      const viewLeft = track.scrollLeft;
      const viewRight = viewLeft + track.clientWidth;
      let target = viewLeft;
      if (aLeft < viewLeft) target = aLeft;                          // 左边在外 → 左对齐
      else if (aRight > viewRight) target = aRight - track.clientWidth; // 右边在外 → 右对齐
      if (target !== viewLeft) track.scrollTo({ left: target });
    }
    this._scheduleOverflow();
  }

  /** 切换某方向的溢出下拉 */
  _toggleMenu(side) {
    this._openMenu = this._openMenu === side ? '' : side;
  }

  /** 从下拉里选中一个 tab：关闭菜单 → 切换 → 滚动进可视区 */
  _selectFromMenu(path) {
    this._openMenu = '';
    this._selectTab(path);
    this.updateComplete.then(() => this._scrollActiveIntoView());
  }

  /** 渲染溢出下拉面板。仅在 _openMenu 打开时才计算 menuFiles（避免每次 render 白建 Map）。
   *  左溢出下拉逆序展示：最下才是最早打开的——与"从 active 向左展开"的直觉一致。 */
  _renderOverflowMenu() {
    if (!this._openMenu) return '';
    const overflowPaths = this._openMenu === 'left' ? this._leftOverflow : this._rightOverflow;
    if (!overflowPaths.length) return '';
    const fileMap = new Map(this.files.map((f) => [f.path, f]));
    let menuFiles = overflowPaths.map((p) => fileMap.get(p)).filter(Boolean);
    if (this._openMenu === 'left') menuFiles = [...menuFiles].reverse();
    if (!menuFiles.length) return '';
    return html`
      <div class="overflow-menu ${this._openMenu}">
        ${menuFiles.map(
          (f) => html`
            <div
              class="overflow-item ${f.path === this.activePath ? 'active' : ''}"
              title="${f.path}"
              @click=${() => this._selectFromMenu(f.path)}
            >
              <span class="name">${f.name}</span>
              ${f.hasExternalConflict
                ? html`<span class="conflict">●</span>`
                : f.isDirty ? html`<span class="dirty">●</span>` : ''}
              <span class="close" role="button" tabindex="0" title="${t('tab.close')}"
                @keydown=${activateOnKey}
                @click=${(e) => { e.stopPropagation(); this._openMenu = ''; this._closeTab(f.path, e); }}>✕</span>
            </div>
          `
        )}
      </div>
    `;
  }

  _selectTab(path) {
    const file = editorState.getFile(path);
    if (file) {
      editorState.setActiveFile(path);
      eventBus.emit('file-opened', { path, content: file.content });
    }
  }

  async _closeTab(path, e) {
    e?.stopPropagation?.();
    // 检查是否有未保存修改
    const file = editorState.getFile(path);
    if (file?.isDirty) {
      const decision = await this._resolveUnsaved(path);
      if (decision === 'cancel') return;
      if (decision === 'save') {
        // 先激活该 tab 再触发保存
        editorState.setActiveFile(path);
        eventBus.emit('file-opened', { path, content: file.content });
        eventBus.emit('save-file');
        // 等待保存完成（短暂延迟让 save-file 事件处理完毕）
        await new Promise(r => setTimeout(r, 100));
        // 如果保存被取消（如用户在另存为对话框取消），则放弃关闭
        if (editorState.getFile(path)?.isDirty) return;
      }
      // decision === 'discard'：直接继续关闭
    }
    editorState.closeFile(path);
    const active = editorState.getActiveFile();
    if (active) {
      eventBus.emit('file-opened', { path: active.path, content: active.content });
    } else {
      eventBus.emit('file-closed', path);
    }
  }

  /** 解决单个 dirty 文件的关闭决策：循环询问直到 save/discard/cancel。
   *  选「对比修改」时打开 diff 并等待其关闭后重新询问，
   *  避免 _closeOthers/_closeAll 中后续 tab 的确认框与 diff 叠加。 */
  async _resolveUnsaved(path) {
    const displayName = path.startsWith('__untitled_') ? untitledName(path) : path.split('/').pop();
    // 弹框前先切到目标 tab：让用户在编辑区看到正要决策的文件，且取消/保存/对比各分支
    // 都在焦点已切到该 tab 的前提下执行（原先仅「对比」会切，行为不一致）
    if (editorState.activeFilePath !== path) {
      const file = editorState.getFile(path);
      if (file) {
        editorState.setActiveFile(path);
        eventBus.emit('file-opened', { path, content: file.content });
      }
    }
    while (true) {
      // 新建未存盘文件（untitled）无磁盘版本可对比：不显示「对比修改」（与右键菜单一致）
      const canCompare = !path.startsWith('__untitled_');
      const result = await showSaveConfirm(
        t('dialog.unsavedChangesFile', { name: displayName }),
        { canCompare }
      );
      if (result !== 'diff') return result;
      // 先注册关闭监听再触发 diff：overlay 对 untitled 会同步关闭，提前注册避免丢事件
      const closed = this._waitUnsavedDiffClosed();
      eventBus.emit('show-unsaved-diff', path);
      await closed;
    }
  }

  /** 等待未保存对比 overlay 关闭（一次性，触发即解绑） */
  _waitUnsavedDiffClosed() {
    return new Promise((resolve) => {
      const handler = () => {
        eventBus.off('unsaved-diff-closed', handler);
        resolve();
      };
      eventBus.on('unsaved-diff-closed', handler);
    });
  }

  // 拖拽排序
  _onDragStart(e, path) {
    this._dragSrcPath = path;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', path);
    e.target.classList.add('dragging');
  }

  _onDragEnd(e) {
    e.target.classList.remove('dragging');
    this._dragSrcPath = null;
    this.shadowRoot.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
  }

  _onDragOver(e, path) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this._dragSrcPath && this._dragSrcPath !== path) {
      this.shadowRoot.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
      e.currentTarget.classList.add('drag-over');
    }
  }

  _onDrop(e, targetPath) {
    e.preventDefault();
    if (this._dragSrcPath && this._dragSrcPath !== targetPath) {
      editorState.reorderTab(this._dragSrcPath, targetPath);
    }
    this.shadowRoot.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
    this._dragSrcPath = null;
  }

  // 右键菜单
  _onContextMenu(e, path) {
    e.preventDefault();
    e.stopPropagation();
    const file = editorState.getFile(path);
    const items = [
      { icon: '✕', label: t('tab.close'), action: () => this._closeTab(path, { stopPropagation: () => {} }) },
      // untitled 无磁盘实体，不提供重载
      ...(path.startsWith('__untitled_') ? [] : [
        { icon: '↻', label: t('tab.reloadFromDisk'), action: () => eventBus.emit('reload-from-disk', path) },
        // 仅 dirty 文件提供未保存对比
        ...(file?.isDirty ? [
          { icon: '⚖', label: t('tab.compareUnsaved'), action: () => eventBus.emit('show-unsaved-diff', path) },
        ] : []),
      ]),
      { icon: '—', label: t('tab.closeOthers'), action: () => this._closeOthers(path) },
      { icon: '◯', label: t('tab.closeAll'), action: () => this._closeAll() },
      { separator: true },
      { icon: '⎘', label: t('tab.copyPath'), action: () => navigator.clipboard.writeText(path) },
      { icon: '📂', label: t('tab.revealInShell'), action: () => eventBus.emit('reveal-in-shell', path) },
    ];
    eventBus.emit('show-context-menu', { x: e.clientX, y: e.clientY, items });
  }

  async _closeOthers(keepPath) {
    const others = this.files.filter(f => f.path !== keepPath).map(f => f.path);
    for (const p of others) {
      await this._closeTab(p, null);
    }
    const file = editorState.getFile(keepPath);
    if (file) {
      editorState.setActiveFile(keepPath);
      eventBus.emit('file-opened', { path: keepPath, content: file.content });
    }
  }

  async _closeAll() {
    const paths = [...this.files.map(f => f.path)];
    for (const p of paths) {
      await this._closeTab(p, null);
    }
  }

  render() {
    return html`
      ${this._leftOverflow.length
        ? html`<button class="more-btn left" type="button"
              title="${t('tab.moreLeft', { n: this._leftOverflow.length })}"
              @click=${() => this._toggleMenu('left')}>⋯</button>`
        : ''}
      <div class="tabs-track" @scroll=${() => this._computeOverflow()}>
        ${this.files.map(
          (f) => html`
            <div
              class="tab ${f.path === this.activePath ? 'active' : ''}"
              data-path="${f.path}"
              draggable="true"
              @click=${() => this._selectTab(f.path)}
              @contextmenu=${(e) => this._onContextMenu(e, f.path)}
              @dragstart=${(e) => this._onDragStart(e, f.path)}
              @dragend=${(e) => this._onDragEnd(e)}
              @dragover=${(e) => this._onDragOver(e, f.path)}
              @drop=${(e) => this._onDrop(e, f.path)}
            >
              <span class="name">${f.name}</span>
              ${f.hasExternalConflict
                ? html`<span class="conflict" title="${t('tab.conflictTooltip')}">●</span>`
                : f.isDirty ? html`<span class="dirty">●</span>` : ''}
              <span class="close" role="button" tabindex="0" title="${t('tab.close')}" @keydown=${activateOnKey} @click=${(e) => this._closeTab(f.path, e)}>✕</span>
            </div>
          `
        )}
      </div>
      ${this._rightOverflow.length
        ? html`<button class="more-btn right" type="button"
              title="${t('tab.moreRight', { n: this._rightOverflow.length })}"
              @click=${() => this._toggleMenu('right')}>⋯</button>`
        : ''}
      ${this._renderOverflowMenu()}
    `;
  }
}

/** 比较两个 path 数组是否相等（顺序敏感） */
function pathsEq(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((p, i) => p === b[i]);
}

customElements.define('tab-bar', TabBar);
