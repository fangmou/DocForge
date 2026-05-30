import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { t } from '../services/i18n.js';

class OutlinePanel extends LitElement {
  static properties = {
    visible: { type: Boolean },
    headings: { type: Array },
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
    .header .close {
      margin-left: auto;
      cursor: pointer;
      opacity: 0.5;
      color: var(--text-3);
    }
    .header .close:hover { opacity: 1; color: var(--text-1); }
    .headings {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }
    .heading {
      padding: 6px 14px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-2);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color 0.15s;
    }
    .heading:hover { color: var(--accent); }
    .heading-l1 { font-weight: 600; font-size: 13px; color: var(--text-1); }
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
    this._debounceTimer = null;
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
    this._contentHandler = (content) => this._parseHeadings(content);
    eventBus.on('content-changed', this._contentHandler);
    this._langHandler = () => this.requestUpdate();
    eventBus.on('language-changed', this._langHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._toggleHandler) eventBus.off('toggle-outline', this._toggleHandler);
    if (this._forceCloseHandler) eventBus.off('force-close-all-panels', this._forceCloseHandler);
    if (this._contentHandler) eventBus.off('content-changed', this._contentHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
    clearTimeout(this._debounceTimer);
  }

  _parseHeadings(content) {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      const headings = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(/^(=+)\s+(.+)/);
        if (m) {
          headings.push({ level: m[1].length, text: m[2], line: i + 1 });
          continue;
        }
        const m2 = line.match(/^(\.{1,5})\s+(.+)/);
        if (m2) {
          headings.push({ level: m2[1].length, text: m2[2], line: i + 1 });
        }
      }
      this.headings = headings;
    }, 300);
  }

  _jumpTo(heading) {
    eventBus.emit('jump-to-line', heading.line);
  }

  render() {
    return html`
      <div class="header">
        <span>📋 ${t('outline.title')}</span>
        <span class="close" @click=${() => { this.visible = false; this.classList.remove('visible'); eventBus.emit('outline-panel-toggled', false); }}>✕</span>
      </div>
      <div class="headings">
        ${this.headings.length === 0
          ? html`<div class="empty">${t('outline.noHeadings')}</div>`
          : this.headings.map((h) => html`
            <div
              class="heading ${h.level === 1 ? 'heading-l1' : ''}"
              style="padding-left: ${(h.level - 1) * 16 + 14}px"
              @click=${() => this._jumpTo(h)}
              title="${h.text}"
            >${h.text}</div>
          `)
        }
      </div>
    `;
  }
}

customElements.define('outline-panel', OutlinePanel);
