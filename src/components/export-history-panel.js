import { LitElement, html, css, svg } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { editorState } from '../services/editor-state.js';
import { t } from '../services/i18n.js';
import { getExportHistory, removeExportHistory, clearExportHistory } from '../services/config-service.js';

const invoke = () => window.__TAURI__.core.invoke;

// Lucide 风格 SVG 图标 — 用 svg 标签确保命名空间正确
const ic = (d) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

class ExportHistoryPanel extends LitElement {
  static properties = {
    visible: { type: Boolean },
    records: { type: Array },
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
    .header .clear-btn {
      margin-left: auto;
      cursor: pointer;
      font-size: 11px;
      font-weight: 400;
      color: var(--text-3);
      transition: color 0.15s;
    }
    .header .clear-btn:hover { color: var(--color-danger); }
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
      padding: 6px 14px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .item.missing { opacity: 0.4; }
    .file-name {
      color: var(--accent);
      font-weight: 600;
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: default;
    }
    .item.missing .file-name {
      color: var(--text-3);
      text-decoration: line-through;
    }
    .meta {
      display: flex;
      align-items: center;
      gap: 2px;
      margin-top: 3px;
    }
    .time {
      color: var(--text-3);
      font-size: 10px;
      margin-right: auto;
    }
    .missing-hint {
      color: var(--color-warning);
      font-size: 10px;
      margin-right: auto;
    }
    .actions {
      display: flex;
      gap: 0;
      flex-shrink: 0;
    }
    .actions button {
      background: none;
      border: none;
      color: var(--text-3);
      cursor: pointer;
      padding: 1px 3px;
      display: inline-flex;
      transition: color 0.15s;
    }
    .actions button svg {
      width: 12px;
      height: 12px;
    }
    .actions button:hover { color: var(--text-1); }
    .actions button:disabled { opacity: 0.25; cursor: default; pointer-events: none; }
    .actions button.del:hover { color: var(--color-danger); }

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
    this.records = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this._toggleHandler = () => {
      const willOpen = !this.visible;
      if (willOpen) eventBus.emit('force-close-all-panels');
      this.visible = willOpen;
      this.classList.toggle('visible', this.visible);
      eventBus.emit('export-history-panel-toggled', this.visible);
      if (this.visible) this._load();
    };
    eventBus.on('toggle-export-history', this._toggleHandler);
    this._forceCloseHandler = () => {
      if (!this.visible && !this.classList.contains('visible')) return;
      this.visible = false;
      this.classList.remove('visible');
    };
    eventBus.on('force-close-all-panels', this._forceCloseHandler);
    this._langHandler = () => this.requestUpdate();
    eventBus.on('language-changed', this._langHandler);
    this._exportDoneHandler = () => {
      if (this.visible) this._load();
    };
    eventBus.on('export-done', this._exportDoneHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._toggleHandler) eventBus.off('toggle-export-history', this._toggleHandler);
    if (this._forceCloseHandler) eventBus.off('force-close-all-panels', this._forceCloseHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
    if (this._exportDoneHandler) eventBus.off('export-done', this._exportDoneHandler);
  }

  async _load() {
    try {
      this.records = await getExportHistory(editorState.workspaceRoot || undefined);
    } catch (_) {
      this.records = [];
    }
  }

  async _open(path) {
    try { await invoke()('open_path', { path }); } catch (_) {}
  }

  async _copy(path) {
    try { await navigator.clipboard.writeText(path); } catch (_) {}
  }

  async _reveal(path) {
    try { await invoke()('reveal_in_shell', { path }); } catch (_) {}
  }

  async _remove(path) {
    try {
      await removeExportHistory(path, editorState.workspaceRoot || undefined);
      this.records = this.records.filter(r => r.path !== path);
    } catch (_) {}
  }

  async _clearAll() {
    try {
      await clearExportHistory(editorState.workspaceRoot || undefined);
      this.records = [];
    } catch (_) {}
  }

  _timeAgo(ts) {
    const now = Date.now() / 1000 | 0;
    const diff = now - ts;
    if (diff < 60) return t('exportHistory.justNow');
    if (diff < 3600) return t('exportHistory.minutesAgo', { n: diff / 60 | 0 });
    if (diff < 86400) return t('exportHistory.hoursAgo', { n: diff / 3600 | 0 });
    if (diff < 604800) return t('exportHistory.daysAgo', { n: diff / 86400 | 0 });
    const d = new Date(ts * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  render() {
    return html`
      <div class="header">
        <span>${t('exportHistory.title')}</span>
        ${this.records.length > 0
          ? html`<span class="clear-btn" @click=${this._clearAll}>${t('exportHistory.clearAll')}</span>`
          : ''}
        <span class="close" @click=${() => { this.visible = false; this.classList.remove('visible'); }}>✕</span>
      </div>
      <div class="list">
        ${this.records.length === 0
          ? html`<div class="empty">${t('exportHistory.empty')}</div>`
          : this.records.map(r => html`
            <div class="item ${r.exists ? '' : 'missing'}">
              <div class="file-name" title="${r.path}">${r.path.replace(/.*\//, '')}</div>
              <div class="meta">
                ${!r.exists ? html`<span class="missing-hint">${t('exportHistory.fileNotFound')}</span>` : html`<span class="time">${this._timeAgo(r.exported_at)}</span>`}
                <span class="actions">
                  <button ?disabled=${!r.exists} @click=${() => this._open(r.path)} title="${t('exportHistory.open')}">${ic(svg`<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>`)}</button>
                  <button ?disabled=${!r.exists} @click=${() => this._copy(r.path)} title="${t('exportHistory.copy')}">${ic(svg`<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>`)}</button>
                  <button ?disabled=${!r.exists} @click=${() => this._reveal(r.path)} title="${t('exportHistory.reveal')}">${ic(svg`<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>`)}</button>
                  <button class="del" @click=${() => this._remove(r.path)} title="${t('exportHistory.remove')}">${ic(svg`<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>`)}</button>
                </span>
              </div>
            </div>
          `)
        }
      </div>
    `;
  }
}

customElements.define('export-history-panel', ExportHistoryPanel);
