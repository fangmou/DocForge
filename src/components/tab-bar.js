import { LitElement, html, css } from 'lit';
import { editorState, untitledName } from '../services/editor-state.js';
import { eventBus } from '../services/event-bus.js';
import { t } from '../services/i18n.js';
import { activateOnKey } from '../services/a11y.js';
import { showSaveConfirm } from '../services/dialog.js';

class TabBar extends LitElement {
  static properties = {
    files: { type: Array },
    activePath: { type: String },
  };

  static styles = css`
    :host {
      display: flex;
      align-items: stretch;
      height: var(--tab-height);
      background: var(--bg-2);
      border-bottom: 1px solid var(--border-subtle);
      overflow-x: auto;
      overflow-y: hidden;
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
      opacity: 0.85;
      color: var(--text-2);
    }
    .tab .close:hover {
      opacity: 1;
      background: var(--bg-3);
      color: var(--text-1);
    }
    .tab .name {
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;

  constructor() {
    super();
    this.files = [];
    this.activePath = '';
    this._dragSrcPath = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._unsub = editorState.onChange(() => {
      this.files = editorState.getOpenFiles();
      this.activePath = editorState.activeFilePath;
    });
    this._closeActiveHandler = () => {
      const active = editorState.activeFilePath;
      if (active) this._closeTab(active, null);
    };
    eventBus.on('close-active-tab', this._closeActiveHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    if (this._closeActiveHandler) eventBus.off('close-active-tab', this._closeActiveHandler);
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
      const displayName = path.startsWith('__untitled_') ? untitledName(path) : path.split('/').pop();
      const result = await showSaveConfirm(t('dialog.unsavedChangesFile', { name: displayName }));
      if (result === 'cancel') return;
      if (result === 'save') {
        // 先激活该 tab 再触发保存
        editorState.setActiveFile(path);
        eventBus.emit('file-opened', { path, content: file.content });
        eventBus.emit('save-file');
        // 等待保存完成（短暂延迟让 save-file 事件处理完毕）
        await new Promise(r => setTimeout(r, 100));
        // 如果保存被取消（如用户在另存为对话框取消），则放弃关闭
        if (editorState.getFile(path)?.isDirty) return;
      }
    }
    editorState.closeFile(path);
    const active = editorState.getActiveFile();
    if (active) {
      eventBus.emit('file-opened', { path: active.path, content: active.content });
    } else {
      eventBus.emit('file-closed', path);
    }
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
    const items = [
      { icon: '✕', label: t('tab.close'), action: () => this._closeTab(path, { stopPropagation: () => {} }) },
      // untitled 无磁盘实体，不提供重载
      ...(path.startsWith('__untitled_') ? [] : [
        { icon: '↻', label: t('tab.reloadFromDisk'), action: () => eventBus.emit('reload-from-disk', path) },
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
    `;
  }
}

customElements.define('tab-bar', TabBar);
