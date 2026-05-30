import { LitElement, html, css } from 'lit';
import { editorState } from '../services/editor-state.js';
import { eventBus } from '../services/event-bus.js';

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
    .tab .dirty {
      color: var(--accent);
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
      opacity: 0.5;
      color: var(--text-3);
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
  }

  connectedCallback() {
    super.connectedCallback();
    this._unsub = editorState.onChange(() => {
      this.files = editorState.getOpenFiles();
      this.activePath = editorState.activeFilePath;
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
  }

  _selectTab(path) {
    const file = editorState.getFile(path);
    if (file) {
      editorState.setActiveFile(path);
      eventBus.emit('file-opened', { path, content: file.content });
    }
  }

  _closeTab(path, e) {
    e.stopPropagation();
    editorState.closeFile(path);
    const active = editorState.getActiveFile();
    if (active) {
      eventBus.emit('file-opened', { path: active.path, content: active.content });
    }
  }

  render() {
    return html`
      ${this.files.map(
        (f) => html`
          <div
            class="tab ${f.path === this.activePath ? 'active' : ''}"
            @click=${() => this._selectTab(f.path)}
          >
            <span class="name">${f.name}</span>
            ${f.isDirty ? html`<span class="dirty">●</span>` : ''}
            <span class="close" @click=${(e) => this._closeTab(f.path, e)}>✕</span>
          </div>
        `
      )}
    `;
  }
}

customElements.define('tab-bar', TabBar);
