import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { editorState } from '../services/editor-state.js';
import { pluginRegistry } from '../services/plugin-registry.js';
import { pluginLoader } from '../services/plugin-loader.js';
import { t } from '../services/i18n.js';

class PluginManagerPanel extends LitElement {
  static properties = {
    visible: { type: Boolean },
    plugins: { type: Array },
  };

  static styles = css`
    :host {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 480px;
      max-height: 60vh;
      background: var(--bg-2);
      border: 1px solid var(--border-medium);
      border-radius: 10px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.2);
      z-index: 400;
      display: none;
      flex-direction: column;
    }
    :host(.visible) { display: flex; }
    .header {
      display: flex;
      align-items: center;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-subtle);
      font-weight: 600;
      font-family: var(--font-display);
      font-size: 15px;
      color: var(--text-1);
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
      padding: 8px 0;
    }
    .item {
      display: flex;
      align-items: center;
      padding: 10px 18px;
      gap: 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .item .info { flex: 1; }
    .item .name { font-weight: 500; font-size: 13px; color: var(--text-1); }
    .item .desc { font-size: 11px; color: var(--text-3); margin-top: 2px; }
    .item .ver { font-size: 10px; color: var(--text-3); font-family: var(--font-mono); }
    .toggle {
      position: relative;
      width: 36px;
      height: 20px;
      border-radius: 10px;
      background: var(--border-medium);
      cursor: pointer;
      transition: background 0.2s;
      border: none;
    }
    .toggle.on { background: var(--accent); }
    .toggle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: white;
      transition: left 0.2s;
    }
    .toggle.on::after { left: 18px; }
    .empty {
      color: var(--text-3);
      text-align: center;
      padding: 40px;
      font-size: 12px;
    }
    .hint {
      padding: 10px 18px;
      font-size: 11px;
      color: var(--text-3);
      border-top: 1px solid var(--border-subtle);
    }
  `;

  constructor() {
    super();
    this.visible = false;
    this.plugins = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this._toggleHandler = async () => {
      this.visible = !this.visible;
      this.classList.toggle('visible', this.visible);
      if (this.visible) {
        // 从 Rust 端获取完整信息（包含 enabled 状态）
        const ws = editorState.workspaceRoot;
        if (ws) {
          try {
            const invoke = window.__TAURI__.core.invoke;
            this.plugins = await invoke('list_plugins', { workspaceRoot: ws });
          } catch (_) {
            this.plugins = pluginRegistry.getRegistered();
          }
        } else {
          this.plugins = pluginRegistry.getRegistered();
        }
      }
    };
    eventBus.on('toggle-plugin-manager', this._toggleHandler);
    this._clickOutside = (e) => {
      if (this.visible && !e.composedPath().includes(this)) {
        this.visible = false;
        this.classList.remove('visible');
      }
    };
    document.addEventListener('click', this._clickOutside);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._toggleHandler) eventBus.off('toggle-plugin-manager', this._toggleHandler);
    document.removeEventListener('click', this._clickOutside);
  }

  async _togglePlugin(pluginId, enable) {
    const ws = editorState.workspaceRoot;
    if (ws) {
      await pluginLoader.setEnabled(ws, pluginId, enable);
      if (enable) {
        await pluginLoader.loadAll(ws);
      } else {
        pluginRegistry.unregister(pluginId);
        pluginLoader.getLoaded().delete(pluginId);
      }
      this.plugins = pluginRegistry.getRegistered();
    }
  }

  render() {
    return html`
      <div class="header">
        <span>🧩 ${t('plugin.title')}</span>
        <span class="close" @click=${(e) => { e.stopPropagation(); this.visible = false; this.classList.remove('visible'); }}>✕</span>
      </div>
      <div class="list">
        ${this.plugins.length === 0
          ? html`<div class="empty">${t('plugin.empty')}</div>`
          : this.plugins.map(p => html`
            <div class="item">
              <div class="info">
                <div class="name">${p.name || p.id}</div>
                ${p.description ? html`<div class="desc">${p.description}</div>` : ''}
                <span class="ver">v${p.version || '0.1.0'}</span>
              </div>
              <button class="toggle ${p.enabled !== false ? 'on' : ''}"
                      @click=${() => this._togglePlugin(p.id, p.enabled === false)}></button>
            </div>
          `)
        }
      </div>
      <div class="hint">${t('plugin.dirHint')}</div>
    `;
  }
}

customElements.define('plugin-manager-panel', PluginManagerPanel);
