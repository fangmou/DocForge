import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { editorState } from '../services/editor-state.js';
import { searchFiles } from '../services/search-service.js';
import { readFile, writeFile } from '../services/file-service.js';
import { t } from '../services/i18n.js';

class SearchPanel extends LitElement {
  static properties = {
    visible: { type: Boolean },
    results: { type: Array },
    isSearching: { type: Boolean },
    query: { type: String },
    caseSensitive: { type: Boolean },
    useRegex: { type: Boolean },
    replaceText: { type: String },
    showReplace: { type: Boolean },
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
    .replace-bar {
      display: flex;
      padding: 6px 14px;
      gap: 6px;
      border-bottom: 1px solid var(--border-subtle);
    }
    button {
      padding: 4px 10px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: var(--bg-3);
      color: var(--text-2);
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover { background: var(--accent); color: #fff; border-color: var(--accent); }
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
    .result .file { color: var(--accent); font-weight: 600; }
    .result .pos { color: var(--text-3); font-size: 11px; font-family: var(--font-mono); }
    .result .text { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
    .result .text mark { background: var(--accent); color: #fff; border-radius: 2px; padding: 0 1px; }
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
    this.useRegex = false;
    this.replaceText = '';
    this.showReplace = false;
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
      this.results = await searchFiles(editorState.workspaceRoot, q, this.caseSensitive, this.useRegex);
    } catch (e) {
      console.error('搜索失败:', e);
      this.results = [];
    }
    this.isSearching = false;
  }

  _highlightMatch(text) {
    if (!this.query) return [{ text }];
    try {
      const flags = this.caseSensitive ? 'g' : 'gi';
      const re = this.useRegex ? new RegExp(this.query, flags) : new RegExp(this.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      const parts = [];
      let lastIdx = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m.index > lastIdx) parts.push({ text: text.slice(lastIdx, m.index) });
        parts.push({ text: m[0], highlight: true });
        lastIdx = m.index + m[0].length;
        // 防止零宽匹配死循环
        if (m[0].length === 0) re.lastIndex++;
      }
      if (lastIdx < text.length) parts.push({ text: text.slice(lastIdx) });
      return parts;
    } catch (_) {
      return [{ text }];
    }
  }

  async _replaceOne(result) {
    try {
      const content = await readFile(result.path);
      const lines = content.split('\n');
      if (lines[result.line - 1]) {
        const flags = this.caseSensitive ? 'g' : 'gi';
        const re = this.useRegex ? new RegExp(this.query, flags) : new RegExp(this.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
        lines[result.line - 1] = lines[result.line - 1].replace(re, this.replaceText);
        await writeFile(result.path, lines.join('\n'));
        // 刷新搜索结果
        await this._doSearch();
        eventBus.emit('content-changed', lines.join('\n'));
      }
    } catch (e) {
      console.error('替换失败:', e);
    }
  }

  async _replaceAll() {
    if (!this.results.length) return;
    // 按文件分组
    const byFile = new Map();
    for (const r of this.results) {
      if (!byFile.has(r.path)) byFile.set(r.path, []);
      byFile.get(r.path).push(r);
    }
    const flags = this.caseSensitive ? 'g' : 'gi';
    const re = this.useRegex ? new RegExp(this.query, flags) : new RegExp(this.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    for (const [path] of byFile) {
      try {
        const content = await readFile(path);
        const newContent = content.replace(re, this.replaceText);
        await writeFile(path, newContent);
      } catch (e) {
        console.error('替换失败:', path, e);
      }
    }
    await this._doSearch();
    // 通知当前文件刷新
    const active = editorState.getActiveFile();
    if (active) {
      const content = await readFile(active.path);
      eventBus.emit('content-changed', content);
    }
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
        <label>
          <input type="checkbox" .checked=${this.useRegex} @change=${(e) => { this.useRegex = e.target.checked; }} />
          ${t('search.regex')}
        </label>
        <label style="margin-left:auto;cursor:pointer" @click=${() => { this.showReplace = !this.showReplace; }}>
          ${this.showReplace ? '▾' : '▸'} ${t('search.replace')}
        </label>
      </div>
      ${this.showReplace ? html`
        <div class="replace-bar">
          <input
            type="text"
            placeholder="${t('search.replacePlaceholder')}"
            .value=${this.replaceText}
            @input=${(e) => { this.replaceText = e.target.value; }}
          />
          <button @click=${() => this._replaceAll()} ?disabled=${!this.results.length}>${t('search.replaceAll')}</button>
        </div>
      ` : ''}
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
                ${this.showReplace ? html`<button style="margin-left:4px" @click=${(e) => { e.stopPropagation(); this._replaceOne(r); }}>${t('search.replaceOne')}</button>` : ''}
                <div class="text">${this._highlightMatch(r.text).map(p =>
                  p.highlight ? html`<mark>${p.text}</mark>` : p.text
                )}</div>
              </div>
            `)
        }
      </div>
    `;
  }
}

customElements.define('search-panel', SearchPanel);
