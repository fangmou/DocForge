import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { AI_ACTIONS, streamChatCompletion, loadAiConfig } from '../services/ai-service.js';
import { t } from '../services/i18n.js';
import { approxMessagesTokens } from '../services/token-count.js';
import { buildAiRequest, buildCustomRequest } from '../services/ai-context.js';
import { compactMessages } from '../services/ai-compact.js';
import { getFormat } from '../services/format-commands.js';
import { editorState } from '../services/editor-state.js';
import './ai-diff-view.js';

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
    .header .token-count {
      font-weight: 400;
      font-size: 11px;
      color: var(--text-3);
    }
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
      margin-bottom: 4px;
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.45;
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
    .diff-overlay {
      position: fixed;
      inset: 0;
      z-index: 300;
      background: var(--bg-1);
      display: flex;
      flex-direction: column;
    }
    .diff-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 12px;
      color: var(--text-2);
    }
    .diff-title {
      margin-right: auto;
      font-weight: 600;
      color: var(--text-1);
    }
    .diff-btn {
      padding: 4px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      background: var(--bg-3);
      color: var(--text-2);
      cursor: pointer;
      font-size: 12px;
    }
    .diff-btn:hover { color: var(--text-1); }
    .diff-btn.accept {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    .diff-host {
      flex: 1;
      overflow: auto;
    }
    .diff-host .cm-editor { font-size: 12px; }
  `;

  constructor() {
    super();
    this.messages = [];
    this.isStreaming = false;
    this.activeAction = '';
    this._streamBuffer = '';
    this._customInput = '';
    // AI 改写 diff 视图状态
    this._diffVisible = false;
    this._diffOriginal = '';
    this._diffProposed = '';
    this._pendingDiffOriginal = '';
    this._pendingDiffRange = null;
    this._diffRange = null;
    this._mergeView = null;
    this._currentFormatId = null;
    this._contextLimit = 100000;
  }

  connectedCallback() {
    super.connectedCallback();
    this._toggleHandler = () => {
      const willOpen = !this.classList.contains('visible');
      if (willOpen) eventBus.emit('force-close-all-panels');
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
    // 当前文档格式（adoc/md/null），用于 AI 输出格式感知
    this._currentFormatId = getFormat(editorState.activeFilePath)?.id || null;
    this._formatHandler = (format) => { this._currentFormatId = format?.id || null; };
    eventBus.on('file-format-changed', this._formatHandler);
    // 加载上下文上限配置（compact 阈值）
    loadAiConfig().then((ai) => { this._contextLimit = ai?.context_limit || 100000; }).catch(() => {});
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._toggleHandler) eventBus.off('toggle-ai-panel', this._toggleHandler);
    if (this._forceCloseHandler) eventBus.off('force-close-all-panels', this._forceCloseHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
    if (this._formatHandler) eventBus.off('file-format-changed', this._formatHandler);
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
      // 给最后一条 assistant 消息附上原文与选区范围，供「对比修改/接受」使用
      if (this.messages.length > 0) {
        const last = this.messages[this.messages.length - 1];
        if (last.role === 'assistant' && this._pendingDiffOriginal) {
          last.diffOriginal = this._pendingDiffOriginal;
          last.diffRange = this._pendingDiffRange;
          this._pendingDiffOriginal = '';
          this._pendingDiffRange = null;
          this.requestUpdate();
        }
      }
    } else if (payload.kind === 'error') {
      this.isStreaming = false;
      this.messages = [...this.messages, { role: 'assistant', content: `${t('ai.errorPrefix')}${payload.content}` }];
    }
  }

  _startStreaming(userMessage, systemPrompt, original = '', range = null, label = '') {
    this._pendingDiffOriginal = original;
    // 仅对有原文的改写记录范围，供「接受」精确还原原选区
    this._pendingDiffRange = original ? range : null;
    this.messages = [...this.messages,
      { role: 'user', content: userMessage, label },
      { role: 'assistant', content: '' },
    ];
    this.isStreaming = true;
    this._streamBuffer = '';

    // 多轮：历史 + 本轮 user（跳过空 assistant 占位）映射为 API messages，压缩后发送
    const apiMessages = this.messages
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    const { messages: compacted } = compactMessages(apiMessages, this._contextLimit);

    streamChatCompletion(compacted, systemPrompt).catch((e) => {
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

  _getSelectionRange() {
    const appShell = document.querySelector('app-shell');
    const editor = appShell?.shadowRoot?.querySelector('editor-pane');
    return editor?.getSelectionRange?.() || null;
  }

  _getFullContent() {
    const appShell = document.querySelector('app-shell');
    const editor = appShell?.shadowRoot?.querySelector('editor-pane');
    return editor?.getDocumentContent?.() || '';
  }

  _executeAction(actionKey) {
    const action = AI_ACTIONS[actionKey];
    if (!action || this.isStreaming) return;

    this.activeAction = actionKey;
    const selected = this._getSelectedText();
    const fullContent = this._getFullContent();
    // 选中→选区范围；整篇改写（润色/翻译）→整篇范围，供「接受」精确替换
    let range = selected ? this._getSelectionRange() : null;
    if (!selected && (actionKey === 'polish' || actionKey === 'translate') && fullContent) {
      range = { from: 0, to: fullContent.length };
    }
    const req = buildAiRequest(actionKey, {
      selected,
      fullContent,
      formatId: this._currentFormatId,
    });
    if (!req) return;
    const label = `${action.label}（${selected ? '选中文本' : '整篇文档'}）`;
    this._startStreaming(req.userMessage, req.systemPrompt, req.original, range, label);
  }

  _sendCustom() {
    const instruction = this._customInput?.trim();
    if (!instruction || this.isStreaming) return;
    this._customInput = '';
    const selected = this._getSelectedText();
    const range = selected ? this._getSelectionRange() : null;
    const req = buildCustomRequest(instruction, {
      selected,
      fullContent: this._getFullContent(),
      formatId: this._currentFormatId,
    });
    this._startStreaming(req.userMessage, req.systemPrompt, req.original, range, instruction);
  }

  _showDiff(msg) {
    this._diffOriginal = msg.diffOriginal || '';
    this._diffProposed = msg.content || '';
    this._diffRange = msg.diffRange || null;
    this._diffVisible = true;
    this.requestUpdate();
  }

  _acceptDiff(text) {
    // 接受：用（经逐块取舍的）结果替换原始范围
    eventBus.emit('ai-insert-text', { text, range: this._diffRange });
    this._diffVisible = false;
    this.requestUpdate();
  }

  _cancelDiff() {
    this._diffVisible = false;
    this.requestUpdate();
  }

  render() {
    return html`
      <div class="header">
        <span>🤖 ${t('ai.title')}</span>
        ${this.messages.length > 0
          ? html`<span class="token-count">≈${approxMessagesTokens(this.messages)} tokens</span>`
          : ''}
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
              <div>${msg.role === 'user' ? (msg.label || '（操作）') : msg.content}${msg.role === 'assistant' && msg.content && !this.isStreaming
                ? html`<button class="insert-btn" @click=${() => eventBus.emit('ai-insert-text', msg.content)}>${t('ai.insertToEditor')}</button>${msg.diffOriginal
                  ? html`<button class="insert-btn" @click=${() => this._showDiff(msg)}>对比修改</button>`
                  : ''}`
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
      ${this._diffVisible ? html`
        <div class="diff-overlay">
          <ai-diff-view
            .original=${this._diffOriginal}
            .proposed=${this._diffProposed}
            @accept=${(e) => this._acceptDiff(e.detail.text)}
            @reject=${() => this._cancelDiff()}
          ></ai-diff-view>
        </div>
      ` : ''}
    `;
  }
}

customElements.define('ai-panel', AiPanel);
