import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { editorState } from '../services/editor-state.js';
import { searchFiles } from '../services/search-service.js';
import { readFile } from '../services/file-service.js';
import { t } from '../services/i18n.js';

class SearchPanel extends LitElement {
  static properties = {
    visible: { type: Boolean },
    results: { type: Array },
    isSearching: { type: Boolean },
    query: { type: String },
    caseSensitive: { type: Boolean },
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
      width: 300px;
      min-width: 300px;
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
    .search-bar {
      display: flex;
      padding: 8px 14px;
      gap: 6px;
      border-bottom: 1px solid var(--border-subtle);
    }
    input {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid var(--border-medium);
      border-radius: 6px;
      background: var(--bg-3);
      color: var(--text-1);
      font-size: 13px;
    }
    input:focus { outline: none; border-color: var(--accent); }
    .opts {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 14px 8px;
      font-size: 11px;
      color: var(--text-2);
      border-bottom: 1px solid var(--border-subtle);
    }
    .opts label { cursor: pointer; display: flex; align-items: center; gap: 3px; }
    .result-count {
      padding: 6px 14px;
      font-size: 11px;
      color: var(--text-3);
      font-family: var(--font-mono);
      border-bottom: 1px solid var(--border-subtle);
    }
    .results {
      flex: 1;
      overflow-y: auto;
    }
    .result {
      padding: 8px 14px;
      cursor: pointer;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 12px;
      transition: background 0.1s;
    }
    .result:hover { background: var(--bg-3); }
    .result .file {
      color: var(--accent);
      font-weight: 600;
    }
    .result .pos {
      color: var(--text-3);
      font-size: 11px;
      font-family: var(--font-mono);
    }
    .result .text {
      color: var(--text-2);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 2px;
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
    this.results = [];
    this.isSearching = false;
    this.query = '';
    this.caseSensitive = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._toggleHandler = () => {
      this.visible = !this.visible;
      this.classList.toggle('visible', this.visible);
      eventBus.emit('search-panel-toggled', this.visible);
      if (this.visible) {
        this.updateComplete.then(() => {
          this.shadowRoot.querySelector('input')?.focus();
        });
      }
    };
    eventBus.on('toggle-search', this._toggleHandler);
    this._forceCloseHandler = () => {
      if (!this.visible && !this.classList.contains('visible')) return;
      this.visible = false;
      this.classList.remove('visible');
      eventBus.emit('search-panel-toggled', false);
    };
    eventBus.on('force-close-all-panels', this._forceCloseHandler);
    this._langHandler = () => this.requestUpdate();
    eventBus.on('language-changed', this._langHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._toggleHandler) eventBus.off('toggle-search', this._toggleHandler);
    if (this._forceCloseHandler) eventBus.off('force-close-all-panels', this._forceCloseHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
  }

  async _doSearch() {
    const q = this.query.trim();
    if (!q || !editorState.workspaceRoot || this.isSearching) return;
    this.isSearching = true;
    try {
      this.results = await searchFiles(editorState.workspaceRoot, q, this.caseSensitive);
    } catch (e) {
      console.error('搜索失败:', e);
      this.results = [];
    }
    this.isSearching = false;
  }

  _openResult(result) {
    readFile(result.path).then((content) => {
      editorState.openFile(result.path, content);
      eventBus.emit('file-opened', { path: result.path, content });
    });
  }

  render() {
    return html`
      <div class="header">
        <span>🔍 ${t('search.title')}</span>
        <span class="close" @click=${() => { this.visible = false; this.classList.remove('visible'); eventBus.emit('search-panel-toggled', false); }}>✕</span>
      </div>
      <div class="search-bar">
        <input
          type="text"
          placeholder="${t('search.placeholder')}"
          .value=${this.query}
          @input=${(e) => { this.query = e.target.value; }}
          @keydown=${(e) => { if (e.key === 'Enter') this._doSearch(); }}
        />
      </div>
      <div class="opts">
        <label>
          <input type="checkbox" .checked=${this.caseSensitive} @change=${(e) => { this.caseSensitive = e.target.checked; }} />
          ${t('search.caseSensitive')}
        </label>
      </div>
      ${this.results.length > 0
        ? html`<div class="result-count">${t('search.resultsCount', { count: this.results.length })}</div>`
        : ''}
      <div class="results">
        ${this.isSearching
          ? html`<div class="empty">${t('search.searching')}</div>`
          : this.results.length === 0 && this.query
            ? html`<div class="empty">${t('search.noResults')}</div>`
            : this.results.map((r) => html`
              <div class="result" @click=${() => this._openResult(r)}>
                <span class="file">${r.path.split('/').pop()}</span>
                <span class="pos"> ${t('search.line')} ${r.line}</span>
                <div class="text">${r.text}</div>
              </div>
            `)
        }
      </div>
    `;
  }
}

customElements.define('search-panel', SearchPanel);
