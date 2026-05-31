import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { editorState } from '../services/editor-state.js';
import { linkIndex } from '../services/link-index.js';
import { t } from '../services/i18n.js';

class OutlinePanel extends LitElement {
  static properties = {
    visible: { type: Boolean },
    headings: { type: Array },
    filter: { type: String },
    collapsed: { type: Object },
  };

  static styles = css`
    :host {
      width: 0;
      min-width: 0;
      overflow: hidden;
      opacity: 0;
      background: var(--bg-2);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.15s;
    }
    :host(.visible) {
      width: 220px;
      min-width: 220px;
      opacity: 1;
      border-left: 1px solid var(--border-subtle);
    }
    .header {
      display: flex;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      font-weight: 600;
      font-family: var(--font-display);
      font-size: 13px;
      gap: 8px;
      color: var(--text-1);
    }
    .header .actions {
      margin-left: auto;
      display: flex;
      gap: 4px;
    }
    .header .close, .header .act {
      cursor: pointer;
      opacity: 0.5;
      color: var(--text-3);
      font-size: 14px;
    }
    .header .close:hover, .header .act:hover { opacity: 1; color: var(--text-1); }
    .filter-bar {
      padding: 6px 14px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .filter-bar input {
      width: 100%;
      padding: 4px 8px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: var(--bg-3);
      color: var(--text-1);
      font-size: 12px;
      box-sizing: border-box;
    }
    .filter-bar input:focus { outline: none; border-color: var(--accent); }
    .headings {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }
    .heading {
      display: flex;
      align-items: center;
      padding: 4px 14px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-2);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color 0.15s;
      gap: 4px;
    }
    .heading:hover { color: var(--accent); }
    .heading-l1 { font-weight: 600; font-size: 13px; color: var(--text-1); }
    .heading .toggle {
      width: 14px;
      height: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      cursor: pointer;
      flex-shrink: 0;
      color: var(--text-3);
      border-radius: 2px;
    }
    .heading .toggle:hover { color: var(--text-1); background: var(--bg-3); }
    .heading .label {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .heading.filtered-out { display: none; }
    .empty {
      color: var(--text-3);
      text-align: center;
      padding-top: 40px;
      font-size: 12px;
    }
  `;

  constructor() {
    super();
    this.visible = false;
    this.headings = [];
    this.filter = '';
    this.collapsed = new Set();
    this._debounceTimer = null;
    this._treeCache = null;
    this._treeCacheHeadings = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._toggleHandler = () => {
      this.visible = !this.visible;
      this.classList.toggle('visible', this.visible);
      eventBus.emit('outline-panel-toggled', this.visible);
    };
    eventBus.on('toggle-outline', this._toggleHandler);
    this._forceCloseHandler = () => {
      if (!this.visible && !this.classList.contains('visible')) return;
      this.visible = false;
      this.classList.remove('visible');
      eventBus.emit('outline-panel-toggled', false);
    };
    eventBus.on('force-close-all-panels', this._forceCloseHandler);
    this._contentHandler = () => this._loadHeadings();
    eventBus.on('content-changed', this._contentHandler);
    this._fileHandler = () => this._loadHeadings();
    eventBus.on('file-opened', this._fileHandler);
    this._langHandler = () => this.requestUpdate();
    eventBus.on('language-changed', this._langHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._toggleHandler) eventBus.off('toggle-outline', this._toggleHandler);
    if (this._forceCloseHandler) eventBus.off('force-close-all-panels', this._forceCloseHandler);
    if (this._contentHandler) eventBus.off('content-changed', this._contentHandler);
    if (this._fileHandler) eventBus.off('file-opened', this._fileHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
    clearTimeout(this._debounceTimer);
  }

  _loadHeadings() {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(async () => {
      const path = editorState.activeFilePath;
      if (!path) { this.headings = []; return; }
      try {
        if (linkIndex.ready) await linkIndex.ready;
        this.headings = await linkIndex.getHeadings(path);
      } catch (_) {
        this.headings = [];
      }
      this.collapsed = new Set();
      this._treeCache = null;
      this._treeCacheHeadings = null;
    }, 300);
  }

  // 构建树结构：计算每个标题是否有子节点（带缓存）
  _getTree() {
    if (this._treeCache && this._treeCacheHeadings === this.headings) return this._treeCache;
    this._treeCache = this._buildTree(this.headings);
    this._treeCacheHeadings = this.headings;
    return this._treeCache;
  }

  _buildTree(headings) {
    const tree = [];
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      let hasChildren = false;
      for (let j = i + 1; j < headings.length; j++) {
        if (headings[j].level <= h.level) break;
        hasChildren = true;
      }
      tree.push({ ...h, hasChildren });
    }
    return tree;
  }

  // 判断标题是否被折叠隐藏
  _isHidden(tree, idx) {
    // 向上查找最近的已折叠祖先
    const h = tree[idx];
    for (let i = idx - 1; i >= 0; i--) {
      if (tree[i].level < h.level) {
        // tree[i] 是祖先
        if (this.collapsed.has(tree[i].line)) return true;
        // 继续向上检查更远的祖先是否也被折叠
      }
    }
    return false;
  }

  _matchesFilter(h) {
    if (!this.filter) return true;
    return h.text.toLowerCase().includes(this.filter.toLowerCase());
  }

  // 过滤时，如果子节点匹配，父节点也应显示
  _isVisible(tree, idx) {
    if (this._matchesFilter(tree[idx])) return true;
    // 检查是否有匹配的后代
    const level = tree[idx].level;
    for (let j = idx + 1; j < tree.length; j++) {
      if (tree[j].level <= level) break;
      if (this._matchesFilter(tree[j])) return true;
    }
    return false;
  }

  _toggleCollapse(line) {
    const s = new Set(this.collapsed);
    if (s.has(line)) s.delete(line);
    else s.add(line);
    this.collapsed = s;
  }

  _expandAll() {
    this.collapsed = new Set();
  }

  _collapseAll() {
    const tree = this._getTree();
    const s = new Set();
    for (const node of tree) {
      if (node.hasChildren && node.level >= 1) s.add(node.line);
    }
    this.collapsed = s;
  }

  _jumpTo(heading) {
    eventBus.emit('jump-to-line', heading.line);
  }

  render() {
    const tree = this._getTree();
    return html`
      <div class="header">
        <span>📋 ${t('outline.title')}</span>
        <span class="actions">
          <span class="act" @click=${() => this._expandAll()} title="${t('outline.expandAll')}">⊞</span>
          <span class="act" @click=${() => this._collapseAll()} title="${t('outline.collapseAll')}">⊟</span>
          <span class="close" @click=${() => { this.visible = false; this.classList.remove('visible'); eventBus.emit('outline-panel-toggled', false); }}>✕</span>
        </span>
      </div>
      <div class="filter-bar">
        <input
          type="text"
          placeholder="${t('outline.filterPlaceholder')}"
          .value=${this.filter}
          @input=${(e) => { this.filter = e.target.value; }}
        />
      </div>
      <div class="headings">
        ${tree.length === 0
          ? html`<div class="empty">${t('outline.noHeadings')}</div>`
          : tree.map((h, idx) => {
            if (this._isHidden(tree, idx)) return '';
            if (this.filter && !this._isVisible(tree, idx)) return '';
            return html`
              <div
                class="heading ${h.level === 1 ? 'heading-l1' : ''}"
                style="padding-left: ${(h.level - 1) * 16 + 14}px"
                @click=${() => this._jumpTo(h)}
                title="${h.text}"
              >
                ${h.hasChildren
                  ? html`<span class="toggle" @click=${(e) => { e.stopPropagation(); this._toggleCollapse(h.line); }}>${this.collapsed.has(h.line) ? '▶' : '▼'}</span>`
                  : html`<span style="width:14px;flex-shrink:0"></span>`
                }
                <span class="label">${h.text}</span>
              </div>
            `;
          })
        }
      </div>
    `;
  }
}

customElements.define('outline-panel', OutlinePanel);
