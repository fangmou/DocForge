import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { editorState } from '../services/editor-state.js';
import { t } from '../services/i18n.js';

class TagsPanel extends LitElement {
  static properties = {
    visible: { type: Boolean },
    tags: { type: Array },
    activeTag: { type: String },
    files: { type: Array },
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
      width: 240px;
      min-width: 240px;
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
    .header .close {
      margin-left: auto;
      cursor: pointer;
      opacity: 0.5;
      color: var(--text-3);
    }
    .header .close:hover { opacity: 1; color: var(--text-1); }
    .tags-cloud {
      padding: 12px 14px;
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
    .tag.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    .tag .count {
      font-size: 10px;
      opacity: 0.6;
      margin-left: 4px;
    }
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
      padding-top: 40px;
      font-size: 12px;
    }
    .add-bar {
      padding: 6px 14px;
      border-top: 1px solid var(--border-subtle);
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
  `;

  constructor() {
    super();
    this.visible = false;
    this.tags = [];
    this.activeTag = '';
    this.files = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this._toggleHandler = () => {
      this.visible = !this.visible;
      this.classList.toggle('visible', this.visible);
      if (this.visible) this._loadTags();
    };
    eventBus.on('toggle-tags-panel', this._toggleHandler);
    this._forceCloseHandler = () => {
      if (!this.visible && !this.classList.contains('visible')) return;
      this.visible = false;
      this.classList.remove('visible');
    };
    eventBus.on('force-close-all-panels', this._forceCloseHandler);
    this._langHandler = () => this.requestUpdate();
    eventBus.on('language-changed', this._langHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._toggleHandler) eventBus.off('toggle-tags-panel', this._toggleHandler);
    if (this._forceCloseHandler) eventBus.off('force-close-all-panels', this._forceCloseHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
  }

  async _loadTags() {
    try {
      const { linkIndex } = await import('../services/link-index.js');
      if (linkIndex.ready) await linkIndex.ready;
      this.tags = await linkIndex.getAllTags();
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
    }
  }

  async _selectTag(tag) {
    this.activeTag = this.activeTag === tag ? '' : tag;
    if (this.activeTag) {
      try {
        const { linkIndex } = await import('../services/link-index.js');
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
      const { readFile } = await import('../services/file-service.js');
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
      const { linkIndex } = await import('../services/link-index.js');
      const newContent = await linkIndex.addTagToFile(path, file.content, tag);
      eventBus.emit('replace-editor-content', newContent);
      await linkIndex.updateFile(path, newContent);
      this._loadTags();
    } catch (_) {}
  }

  render() {
    return html`
      <div class="header">
        <span>🏷️ ${t('tags.title')}</span>
        <span class="close" @click=${() => { this.visible = false; this.classList.remove('visible'); }}>✕</span>
      </div>
      ${this.tags.length > 0 ? html`
        <div class="tags-cloud">
          ${this.tags.map(({ tag, count }) => html`
            <span class="tag ${this.activeTag === tag ? 'active' : ''}"
                  @click=${() => this._selectTag(tag)}>
              ${tag}<span class="count">${count}</span>
            </span>
          `)}
        </div>
      ` : ''}
      ${this.activeTag && this.files.length > 0 ? html`
        <div class="files">
          ${this.files.map(f => html`
            <div class="file-item" @click=${() => this._openFile(f.path)} title="${f.path}">${f.name}</div>
          `)}
        </div>
      ` : this.activeTag ? html`
        <div class="empty">${t('tags.noFiles')}</div>
      ` : this.tags.length === 0 ? html`
        <div class="empty">${t('tags.empty')}</div>
      ` : ''}
      ${editorState.activeFilePath ? html`
        <div class="add-bar">
          <input
            type="text"
            placeholder="${t('tags.addPlaceholder')}"
            @keydown=${(e) => { if (e.key === 'Enter') { this._addTag(e.target.value); e.target.value = ''; } }}
          />
        </div>
      ` : ''}
    `;
  }
}

customElements.define('tags-panel', TagsPanel);
