import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { AI_ACTIONS, streamChatCompletion } from '../services/ai-service.js';
import { t } from '../services/i18n.js';

class AiPanel extends LitElement {
  static properties = {
    messages: { type: Array },
    isStreaming: { type: Boolean },
    activeAction: { type: String },
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
      font-size: 16px;
      color: var(--text-3);
      transition: opacity 0.15s;
    }
    .header .close:hover { opacity: 1; color: var(--text-1); }
    .actions {
      display: flex;
      gap: 4px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .action-btn {
      flex: 1;
      padding: 6px 8px;
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      background: var(--bg-3);
      color: var(--text-2);
      cursor: pointer;
      font-size: 11px;
      text-align: center;
      transition: all 0.15s;
    }
    .action-btn:hover {
      background: var(--border-subtle);
      color: var(--text-1);
    }
    .action-btn.active {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
    }
    .message {
      margin-bottom: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
      max-width: 90%;
      word-break: break-word;
    }
    .message.user {
      background: var(--accent);
      color: #fff;
      margin-left: auto;
    }
    .message.assistant {
      background: var(--bg-3);
      color: var(--text-2);
      border: 1px solid var(--border-subtle);
    }
    .message .label {
      font-size: 10px;
      color: var(--text-3);
      margin-bottom: 4px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .message.user .label { color: rgba(255,255,255,0.7); }
    .input-area {
      display: flex;
      padding: 10px 14px;
      gap: 6px;
      border-top: 1px solid var(--border-subtle);
    }
    textarea {
      flex: 1;
      padding: 8px 10px;
      border: 1px solid var(--border-medium);
      border-radius: 6px;
      background: var(--bg-3);
      color: var(--text-1);
      font-size: 12px;
      resize: none;
      font-family: var(--font-sans);
      min-height: 60px;
    }
    textarea:focus {
      outline: none;
      border-color: var(--accent);
    }
    .send-btn {
      align-self: flex-end;
      padding: 8px 16px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      transition: background 0.15s;
    }
    .send-btn:hover { background: var(--accent-hover); }
    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .insert-btn {
      display: inline-block;
      margin-top: 6px;
      padding: 3px 8px;
      font-size: 11px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .insert-btn:hover { background: var(--accent-hover); }
    .empty {
      color: var(--text-3);
      text-align: center;
      padding-top: 40px;
      font-size: 12px;
    }
  `;

  constructor() {
    super();
    this.messages = [];
    this.isStreaming = false;
    this.activeAction = '';
    this._streamBuffer = '';
    this._customInput = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._toggleHandler = () => {
      this.classList.toggle('visible');
      const isVisible = this.classList.contains('visible');
      eventBus.emit('ai-panel-toggled', isVisible);
    };
    eventBus.on('toggle-ai-panel', this._toggleHandler);
    this._forceCloseHandler = () => {
      if (!this.classList.contains('visible')) return;
      this.classList.remove('visible');
      eventBus.emit('ai-panel-toggled', false);
    };
    eventBus.on('force-close-all-panels', this._forceCloseHandler);

    const { listen } = window.__TAURI__.event;
    this._tauriUnlisten = listen('ai-stream-chunk', (event) => {
      this._handleStreamChunk(event.payload);
    });
    this._langHandler = () => this.requestUpdate();
    eventBus.on('language-changed', this._langHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._toggleHandler) eventBus.off('toggle-ai-panel', this._toggleHandler);
    if (this._forceCloseHandler) eventBus.off('force-close-all-panels', this._forceCloseHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
    this._tauriUnlisten?.then(fn => fn());
  }

  _handleStreamChunk(payload) {
    if (payload.kind === 'token') {
      this._streamBuffer += payload.content;
      if (this.messages.length > 0) {
        const last = this.messages[this.messages.length - 1];
        if (last.role === 'assistant') {
          last.content = this._streamBuffer;
          this.requestUpdate();
        }
      }
    } else if (payload.kind === 'done') {
      this.isStreaming = false;
    } else if (payload.kind === 'error') {
      this.isStreaming = false;
      this.messages = [...this.messages, { role: 'assistant', content: `${t('ai.errorPrefix')}${payload.content}` }];
    }
  }

  _startStreaming(prompt, systemPrompt) {
    this.messages = [...this.messages,
      { role: 'user', content: prompt },
      { role: 'assistant', content: '' },
    ];
    this.isStreaming = true;
    this._streamBuffer = '';

    streamChatCompletion(prompt, systemPrompt).catch((e) => {
      this.isStreaming = false;
      this.messages = [...this.messages, { role: 'assistant', content: t('ai.requestFailed', { error: e }) }];
    });
  }

  _getSelectedText() {
    // editor-pane 在 app-shell 的 shadow DOM 内
    const appShell = document.querySelector('app-shell');
    const editor = appShell?.shadowRoot?.querySelector('editor-pane');
    return editor?.getSelectedText?.() || '';
  }

  _executeAction(actionKey) {
    const action = AI_ACTIONS[actionKey];
    if (!action || this.isStreaming) return;

    this.activeAction = actionKey;
    const prompt = this._getSelectedText() || '请开始写作...';
    this._startStreaming(prompt, action.systemPrompt);
  }

  _sendCustom() {
    const prompt = this._customInput?.trim();
    if (!prompt || this.isStreaming) return;
    this._customInput = '';
    this._startStreaming(prompt);
  }

  render() {
    return html`
      <div class="header">
        <span>🤖 ${t('ai.title')}</span>
        <span class="close" @click=${() => { this.classList.remove('visible'); eventBus.emit('ai-panel-toggled', false); }}>✕</span>
      </div>
      <div class="actions">
        ${Object.entries(AI_ACTIONS).map(([key, action]) => html`
          <button
            class="action-btn ${this.activeAction === key ? 'active' : ''}"
            @click=${() => this._executeAction(key)}
            ?disabled=${this.isStreaming}
          >
            ${action.icon} ${action.label}
          </button>
        `)}
      </div>
      <div class="content">
        ${this.messages.length === 0
          ? html`<div class="empty">${t('ai.emptyState')}</div>`
          : this.messages.map((msg, i) => html`
            <div class="message ${msg.role}">
              <div class="label">${msg.role === 'user' ? t('ai.you') : t('ai.aiLabel')}</div>
              <div>${msg.content}${msg.role === 'assistant' && msg.content && !this.isStreaming
                ? html`<button class="insert-btn" @click=${() => eventBus.emit('ai-insert-text', msg.content)}>${t('ai.insertToEditor')}</button>`
                : ''}</div>
            </div>
          `)
        }
      </div>
      <div class="input-area">
        <textarea
          placeholder="${t('ai.placeholder')}"
          @keydown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendCustom(); }}}
          .value=${this._customInput}
          @input=${(e) => { this._customInput = e.target.value; }}
        ></textarea>
        <button class="send-btn" ?disabled=${this.isStreaming} @click=${this._sendCustom}>${t('ai.send')}</button>
      </div>
    `;
  }
}

customElements.define('ai-panel', AiPanel);
