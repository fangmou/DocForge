import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { editorState } from '../services/editor-state.js';
import { t } from '../services/i18n.js';
import { linkIndex } from '../services/link-index.js';
import { readFile } from '../services/file-service.js';

class TagsPanel extends LitElement {
  static properties = {
    visible: { type: Boolean },
    mode: { type: String },        // 'cloud' | 'manage'
    tags: { type: Array },
    activeTag: { type: String },
    files: { type: Array },
    currentFileTags: { type: Array },
    suggestVisible: { type: Boolean },
    suggestions: { type: Array },
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
      width: 260px;
      min-width: 260px;
      opacity: 1;
      border-left: 1px solid var(--border-subtle);
    }
    .header {
      display: flex;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 13px;
      gap: 0;
      color: var(--text-1);
    }
    /* tab 切换 */
    .header .tab {
      cursor: pointer;
      padding: 4px 8px;
      font-size: 12px;
      color: var(--text-3);
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
    }
    .header .tab:hover { color: var(--text-2); }
    .header .tab.active {
      color: var(--text-1);
      font-weight: 600;
      border-bottom-color: var(--accent);
    }
    .header .close {
      margin-left: auto;
      cursor: pointer;
      opacity: 0.5;
      color: var(--text-3);
    }
    .header .close:hover { opacity: 1; color: var(--text-1); }

    /* ===== 标签云视图 ===== */
    .tags-cloud {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 12px;
      cursor: pointer;
      border: 1px solid var(--border-medium);
      color: var(--text-2);
      transition: all 0.15s;
    }
    .tag:hover { border-color: var(--accent); color: var(--accent); }
    /* owned: accent 填充（一扫可见） */
    .tag.owned {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .tag.owned:hover { opacity: 0.85; }
    /* active: accent 下划线，在任何背景上都可见 */
    .tag.active {
      border-bottom: 2.5px solid var(--accent);
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
    }
    .tag .count {
      font-size: 10px;
      opacity: 0.6;
      margin-left: 4px;
    }

    /* 文件列表 */
    .files {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }
    .file-item {
      padding: 6px 14px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-2);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color 0.15s;
    }
    .file-item:hover { color: var(--accent); }
    .empty {
      color: var(--text-3);
      text-align: center;
      padding: 40px 14px 20px;
      font-size: 12px;
    }

    /* ===== 管理视图 ===== */
    .section-label {
      padding: 8px 14px 4px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-3);
      letter-spacing: 0.3px;
    }
    .manage-tags {
      padding: 6px 14px 10px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .manage-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      background: var(--accent);
      color: #fff;
    }
    .manage-tag .remove {
      cursor: pointer;
      opacity: 0.7;
      font-size: 11px;
    }
    .manage-tag .remove:hover { opacity: 1; }
    .candidate-tags {
      padding: 6px 14px 10px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .candidate-tag {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 12px;
      cursor: pointer;
      border: 1px solid var(--border-medium);
      color: var(--text-2);
      transition: all 0.15s;
    }
    .candidate-tag:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
    .candidate-tag .add {
      font-size: 12px;
      font-weight: 700;
      opacity: 0.6;
    }
    .candidate-tag:hover .add { opacity: 1; }

    /* ===== 输入框 + 自动补全 ===== */
    .add-bar {
      padding: 6px 14px;
      border-top: 1px solid var(--border-subtle);
      position: relative;
    }
    .add-bar input {
      width: 100%;
      padding: 4px 8px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: var(--bg-3);
      color: var(--text-1);
      font-size: 12px;
      box-sizing: border-box;
    }
    .add-bar input:focus { outline: none; border-color: var(--accent); }
    .suggest-list {
      position: absolute;
      bottom: 100%;
      left: 14px;
      right: 14px;
      background: var(--bg-2);
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      max-height: 160px;
      overflow-y: auto;
      z-index: 10;
      box-shadow: 0 -4px 12px rgba(0,0,0,0.15);
    }
    .suggest-item {
      padding: 5px 10px;
      font-size: 12px;
      color: var(--text-2);
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .suggest-item:hover { background: var(--bg-3); color: var(--accent); }
    .suggest-item .cnt { font-size: 10px; color: var(--text-3); }
  `;

  constructor() {
    super();
    this.visible = false;
    this.mode = 'cloud';
    this.tags = [];
    this.activeTag = '';
    this.files = [];
    this.currentFileTags = [];
    this.suggestVisible = false;
    this.suggestions = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this._toggleHandler = () => {
      const willOpen = !this.visible;
      if (willOpen) eventBus.emit('force-close-all-panels');
      this.visible = willOpen;
      this.classList.toggle('visible', this.visible);
      eventBus.emit('tags-panel-toggled', this.visible);
      if (this.visible) {
        this.mode = 'cloud';
        this._loadTags();
      }
    };
    eventBus.on('toggle-tags-panel', this._toggleHandler);
    this._forceCloseHandler = () => {
      if (!this.visible && !this.classList.contains('visible')) return;
      this.visible = false;
      this.classList.remove('visible');
      eventBus.emit('tags-panel-toggled', false);
    };
    eventBus.on('force-close-all-panels', this._forceCloseHandler);
    this._langHandler = () => this.requestUpdate();
    eventBus.on('language-changed', this._langHandler);
    this._fileOpenedHandler = () => { if (this.visible) this._loadTags(); };
    this._fileSavedHandler = () => { if (this.visible) this._loadTags(); };
    eventBus.on('file-opened', this._fileOpenedHandler);
    eventBus.on('file-saved', this._fileSavedHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._toggleHandler) eventBus.off('toggle-tags-panel', this._toggleHandler);
    if (this._forceCloseHandler) eventBus.off('force-close-all-panels', this._forceCloseHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
    if (this._fileOpenedHandler) eventBus.off('file-opened', this._fileOpenedHandler);
    if (this._fileSavedHandler) eventBus.off('file-saved', this._fileSavedHandler);
  }

  async _loadTags() {
    try {
      if (linkIndex.ready) await linkIndex.ready;
      this.tags = await linkIndex.getAllTags();
      const path = editorState.activeFilePath;
      this.currentFileTags = path ? await linkIndex.getTagsForFile(path) : [];
      if (this.activeTag) {
        const paths = await linkIndex.getFilesByTag(this.activeTag);
        this.files = paths.map(p => ({
          path: p,
          name: p.split('/').pop(),
        }));
      }
    } catch (_) {
      this.tags = [];
      this.files = [];
      this.currentFileTags = [];
    }
  }

  async _selectTag(tag) {
    this.activeTag = this.activeTag === tag ? '' : tag;
    if (this.activeTag) {
      try {
        const paths = await linkIndex.getFilesByTag(this.activeTag);
        this.files = paths.map(p => ({
          path: p,
          name: p.split('/').pop(),
        }));
      } catch (_) {
        this.files = [];
      }
    } else {
      this.files = [];
    }
  }

  async _openFile(path) {
    try {
      const content = await readFile(path);
      editorState.openFile(path, content);
      eventBus.emit('file-opened', { path, content });
    } catch (_) {}
  }

  async _addTag(tagText) {
    const tag = tagText.trim();
    if (!tag) return;
    const path = editorState.activeFilePath;
    if (!path) return;
    const file = editorState.getFile(path);
    if (!file) return;
    try {
      const newContent = await linkIndex.addTagToFile(path, file.content, tag);
      eventBus.emit('replace-editor-content', newContent);
      await linkIndex.updateFile(path, newContent);
      await this._loadTags();
    } catch (_) {}
  }

  async _removeTag(tag) {
    const path = editorState.activeFilePath;
    if (!path) return;
    const file = editorState.getFile(path);
    if (!file) return;
    try {
      const newContent = await linkIndex.removeTagFromFile(path, file.content, tag);
      eventBus.emit('replace-editor-content', newContent);
      await linkIndex.updateFile(path, newContent);
      if (this.activeTag === tag) this.activeTag = '';
      await this._loadTags();
    } catch (_) {}
  }

  _onInputChange(e) {
    const val = e.target.value.trim().toLowerCase();
    if (!val) {
      this.suggestVisible = false;
      this.suggestions = [];
      return;
    }
    const owned = new Set(this.currentFileTags);
    this.suggestions = this.tags
      .filter(t => t.tag.toLowerCase().includes(val) && !owned.has(t.tag))
      .slice(0, 8);
    this.suggestVisible = this.suggestions.length > 0;
  }

  _hideSuggest() {
    setTimeout(() => {
      this.suggestVisible = false;
      this.suggestions = [];
    }, 150);
  }

  _renderCloud() {
    const owned = new Set(this.currentFileTags);
    // owned 优先排序
    const sorted = [...this.tags].sort((a, b) => {
      const aO = owned.has(a.tag) ? 0 : 1;
      const bO = owned.has(b.tag) ? 0 : 1;
      return aO - bO;
    });

    return html`
      ${sorted.length > 0 ? html`
        <div class="tags-cloud">
          ${sorted.map(({ tag, count }) => {
            const isOwned = owned.has(tag);
            const isActive = this.activeTag === tag;
            return html`
              <span class="tag ${isOwned ? 'owned' : ''} ${isActive ? 'active' : ''}"
                    @click=${() => this._selectTag(tag)}>
                ${tag}<span class="count">${count}</span>
              </span>
            `;
          })}
        </div>
      ` : html`
        <div class="empty">${t('tags.empty')}</div>
      `}
      ${this.activeTag && this.files.length > 0 ? html`
        <div class="files">
          ${this.files.map(f => html`
            <div class="file-item" @click=${() => this._openFile(f.path)} title="${f.path}">${f.name}</div>
          `)}
        </div>
      ` : this.activeTag ? html`
        <div class="empty">${t('tags.noFiles')}</div>
      ` : ''}
    `;
  }

  _renderManage() {
    const owned = new Set(this.currentFileTags);
    const candidates = this.tags.filter(t => !owned.has(t.tag));

    return html`
      ${this.currentFileTags.length > 0 ? html`
        <div class="section-label">${t('tags.currentTags')}</div>
        <div class="manage-tags">
          ${this.currentFileTags.map(tag => html`
            <span class="manage-tag">
              ${tag}
              <span class="remove" title="${t('tags.removeTag')}" @click=${() => this._removeTag(tag)}>✕</span>
            </span>
          `)}
        </div>
      ` : html`
        <div class="empty">${t('tags.empty')}</div>
      `}
      ${candidates.length > 0 ? html`
        <div class="section-label">${t('tags.availableTags')}</div>
        <div class="candidate-tags">
          ${candidates.map(({ tag, count }) => html`
            <span class="candidate-tag" @click=${() => this._addTag(tag)} title="${t('tags.addTag')}">
              ${tag}<span class="add">＋</span>
            </span>
          `)}
        </div>
      ` : ''}
      ${editorState.activeFilePath ? html`
        <div class="add-bar">
          ${this.suggestVisible ? html`
            <div class="suggest-list">
              ${this.suggestions.map(s => html`
                <div class="suggest-item" @click=${() => {
                  this._addTag(s.tag);
                  const input = this.shadowRoot.querySelector('.add-bar input');
                  if (input) input.value = '';
                  this.suggestVisible = false;
                  this.suggestions = [];
                }}>
                  <span>${s.tag}</span>
                  <span class="cnt">${s.count}</span>
                </div>
              `)}
            </div>
          ` : ''}
          <input
            type="text"
            placeholder="${t('tags.addPlaceholder')}"
            @input=${this._onInputChange}
            @blur=${this._hideSuggest}
            @keydown=${(e) => {
              if (e.key === 'Enter') {
                this._addTag(e.target.value);
                e.target.value = '';
                this.suggestVisible = false;
                this.suggestions = [];
              }
              if (e.key === 'Escape') {
                this.suggestVisible = false;
                this.suggestions = [];
              }
            }}
          />
        </div>
      ` : ''}
    `;
  }

  render() {
    const isCloud = this.mode !== 'manage';

    return html`
      <div class="header">
        <span class="tab ${isCloud ? 'active' : ''}" @click=${() => { this.mode = 'cloud'; }}>${t('tags.title')}</span>
        <span class="tab ${!isCloud ? 'active' : ''}" @click=${() => { this.mode = 'manage'; }}>${t('tags.manageTitle')}</span>
        <span class="close" @click=${() => { this.visible = false; this.classList.remove('visible'); eventBus.emit('tags-panel-toggled', false); }}>✕</span>
      </div>
      ${isCloud ? this._renderCloud() : this._renderManage()}
    `;
  }
}

customElements.define('tags-panel', TagsPanel);
