import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';

class ContextMenu extends LitElement {
  static properties = {
    visible: { type: Boolean },
    x: { type: Number },
    y: { type: Number },
    items: { type: Array },
  };

  static styles = css`
    :host {
      position: fixed;
      z-index: 500;
    }
    .menu {
      background: var(--bg-3);
      border: 1px solid var(--border-medium);
      border-radius: 8px;
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
      padding: 4px 0;
      min-width: 180px;
    }
    .item {
      padding: 6px 14px;
      font-size: 12px;
      color: var(--text-2);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.1s;
    }
    .item:hover {
      background: var(--accent);
      color: #fff;
    }
    .separator {
      height: 1px;
      background: var(--border-subtle);
      margin: 4px 0;
    }
  `;

  constructor() {
    super();
    this.visible = false;
    this.x = 0;
    this.y = 0;
    this.items = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this._showHandler = ({ x, y, items }) => {
      this.x = x;
      this.y = y;
      this.items = items;
      this.visible = true;
    };
    this._hideHandler = () => { this.visible = false; };
    eventBus.on('show-context-menu', this._showHandler);
    document.addEventListener('click', this._hideHandler);
    document.addEventListener('contextmenu', this._hideHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._showHandler) eventBus.off('show-context-menu', this._showHandler);
    document.removeEventListener('click', this._hideHandler);
    document.removeEventListener('contextmenu', this._hideHandler);
  }

  _onAction(action) {
    this.visible = false;
    eventBus.emit('context-menu-action', action);
  }

  render() {
    if (!this.visible) return '';
    return html`
      <div class="menu" style="left:${this.x}px; top:${this.y}px" @click=${(e) => e.stopPropagation()}>
        ${this.items.map((item) => item.separator
          ? html`<div class="separator"></div>`
          : html`<div class="item" @click=${() => this._onAction(item.action)}>${item.icon || ''} ${item.label}</div>`
        )}
      </div>
    `;
  }
}

customElements.define('context-menu', ContextMenu);
