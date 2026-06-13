import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { editorState } from '../services/editor-state.js';
import { t } from '../services/i18n.js';
import { linkIndex } from '../services/link-index.js';
import { readFile } from '../services/file-service.js';

class BacklinksPanel extends LitElement {
  static properties = {
    visible: { type: Boolean },
    backlinks: { type: Array },
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
      font-weight: 600;
      font-family: var(--font-display);
      font-size: 13px;
      gap: 8px;
      color: var(--text-1);
    }
    .header .count {
      font-size: 11px;
      color: var(--text-3);
      font-weight: 400;
    }
    .header .close {
      margin-left: auto;
      cursor: pointer;
      opacity: 0.5;
      color: var(--text-3);
    }
    .header .close:hover { opacity: 1; color: var(--text-1); }
    .list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }
    .item {
      padding: 8px 14px;
      cursor: pointer;
      border-bottom: 1px solid var(--border-subtle);
      transition: background 0.1s;
    }
    .item:hover { background: var(--bg-3); }
    .item .file {
      color: var(--accent);
      font-weight: 600;
      font-size: 12px;
    }
    .item .pos {
      color: var(--text-3);
      font-size: 11px;
      font-family: var(--font-mono);
      margin-left: 6px;
    }
    .item .context {
      color: var(--text-2);
      font-size: 12px;
      margin-top: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
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
    this.backlinks = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this._toggleHandler = () => {
      const willOpen = !this.visible;
      if (willOpen) eventBus.emit('force-close-all-panels');
      this.visible = willOpen;
      this.classList.toggle('visible', this.visible);
      eventBus.emit('backlinks-panel-toggled', this.visible);
      if (this.visible) this._loadBacklinks();
    };
    eventBus.on('toggle-backlinks', this._toggleHandler);
    this._showHandler = () => {
      if (!this.visible) {
        eventBus.emit('force-close-all-panels');
        this.visible = true;
        this.classList.add('visible');
        eventBus.emit('backlinks-panel-toggled', true);
        this._loadBacklinks();
      }
    };
    eventBus.on('show-backlinks', this._showHandler);
    this._fileHandler = () => {
      this._loadBacklinks();
    };
    eventBus.on('file-opened', this._fileHandler);
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
    if (this._toggleHandler) eventBus.off('toggle-backlinks', this._toggleHandler);
    if (this._showHandler) eventBus.off('show-backlinks', this._showHandler);
    if (this._fileHandler) eventBus.off('file-opened', this._fileHandler);
    if (this._forceCloseHandler) eventBus.off('force-close-all-panels', this._forceCloseHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
  }

  async _loadBacklinks() {
    const path = editorState.activeFilePath;
    if (!path) { this.backlinks = []; return; }
    try {
      if (linkIndex.ready) await linkIndex.ready;
      this.backlinks = await linkIndex.getBacklinks(path);
    } catch (_) {
      this.backlinks = [];
    }
  }

  async _openBacklink(bl) {
    try {
      const content = await readFile(bl.source);
      editorState.openFile(bl.source, content);
      eventBus.emit('file-opened', { path: bl.source, content });
      if (bl.line) {
        setTimeout(() => eventBus.emit('jump-to-line', bl.line), 100);
      }
    } catch (_) {}
  }

  render() {
    return html`
      <div class="header">
        <span>🔗 ${t('backlinks.title')}</span>
        ${this.backlinks.length > 0
          ? html`<span class="count">${this.backlinks.length}</span>`
          : ''}
        <span class="close" @click=${() => { this.visible = false; this.classList.remove('visible'); }}>✕</span>
      </div>
      <div class="list">
        ${this.backlinks.length === 0
          ? html`<div class="empty">${t('backlinks.empty')}</div>`
          : this.backlinks.map((bl) => html`
            <div class="item" @click=${() => this._openBacklink(bl)}>
              <span class="file">${bl.source.split('/').pop()}</span>
              <span class="pos">L${bl.line}</span>
              <div class="context">→ ${editorState.activeFilePath?.split('/').pop() || ''}</div>
            </div>
          `)
        }
      </div>
    `;
  }
}

customElements.define('backlinks-panel', BacklinksPanel);
