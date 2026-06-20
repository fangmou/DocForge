import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { AI_ACTIONS, streamChatCompletion, loadAiConfig, stripFenceWrapper } from '../services/ai-service.js';
import { t } from '../services/i18n.js';
import { activateOnKey } from '../services/a11y.js';
import { approxMessagesTokens } from '../services/token-count.js';
import { buildAiRequest, buildCustomRequest, buildSceneRequest } from '../services/ai-context.js';
import { loadCustomAiScenes } from '../services/config-service.js';
import { compactMessages } from '../services/ai-compact.js';
import { getFormat } from '../services/format-commands.js';
import { editorState } from '../services/editor-state.js';
import './ai-diff-view.js';
import './ai-scene-manager.js';

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
      cursor: pointer;
      /* 默认即高对比，缩小与系统窗口关闭按钮的视觉落差，降低误关整窗的概率 */
      opacity: 0.85;
      font-size: 16px;
      color: var(--text-2);
      transition: opacity 0.15s, color 0.15s, background 0.15s;
      /* 扩大点击热区（16px 字符 → 24px），减少点偏到右上角系统关闭按钮的可能 */
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 4px;
    }
    .header .close:hover { opacity: 1; color: var(--text-1); background: var(--bg-3); }
    .header .close svg { width: 16px; height: 16px; pointer-events: none; }
    .header .token-count {
      font-weight: 400;
      font-size: 11px;
      color: var(--text-3);
    }
    .actions-wrap {
      position: relative;
      border-top: 1px solid var(--border-subtle);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 8px 14px;
    }
    .action-btn {
      flex: 1 1 calc(33.333% - 4px);
      min-width: 0;
      padding: 6px 4px;
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
    .header .gear {
      margin-left: auto;
      cursor: pointer;
      opacity: 0.85;
      font-size: 15px;
      color: var(--text-2);
      transition: opacity 0.15s, color 0.15s, background 0.15s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 4px;
    }
    .header .gear:hover { opacity: 1; color: var(--text-1); background: var(--bg-3); }
    .more-menu {
      position: absolute;
      bottom: 100%;
      right: 0;
      min-width: 180px;
      background: var(--bg-2);
      border: 1px solid var(--border-medium);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
      z-index: 50;
      padding: 4px;
    }
    .more-item {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 6px 8px;
      border: none;
      background: transparent;
      color: var(--text-2);
      cursor: pointer;
      font-size: 12px;
      text-align: left;
      border-radius: 4px;
    }
    .more-item:hover { background: var(--border-subtle); color: var(--text-1); }
    .more-item.manage { color: var(--text-3); }
    .more-icon { display: inline-block; min-width: 16px; text-align: center; }
    .more-divider { height: 1px; background: var(--border-subtle); margin: 4px 0; }
    .more-empty { padding: 10px 8px; font-size: 11px; color: var(--text-3); text-align: center; line-height: 1.5; }
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .message {
      margin-bottom: 2px;
      padding: 5px 10px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.4;
      max-width: 90%;
      word-break: break-word;
    }
    .msg-body { white-space: pre-wrap; }
    .typing-cursor {
      display: inline-block;
      width: 7px;
      height: 14px;
      margin-left: 2px;
      vertical-align: text-bottom;
      background: var(--accent);
      border-radius: 1px;
      animation: typing-blink 1s steps(2, start) infinite;
    }
    @keyframes typing-blink { 50% { opacity: 0; } }
    .msg-actions { margin-top: 6px; display: flex; gap: 6px; }
    .msg-truncated {
      margin-top: 6px;
      padding: 4px 8px;
      font-size: 12px;
      line-height: 1.4;
      color: #b54708;
      background: #fef3c7;
      border: 1px solid #fcd34d;
      border-radius: 6px;
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
      margin-bottom: 0;
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
    .input-actions {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex-shrink: 0;
    }
    .act-mini {
      padding: 5px 8px;
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      background: var(--bg-3);
      color: var(--text-2);
      cursor: pointer;
      font-size: 11px;
      white-space: nowrap;
    }
    .act-mini:hover { background: var(--border-subtle); color: var(--text-1); }
    .act-mini.active { background: var(--accent); color: white; border-color: var(--accent); }
    .act-mini:disabled { opacity: 0.5; cursor: not-allowed; }
    .more-wrap { position: relative; }
    .more-wrap .act-mini { width: 100%; box-sizing: border-box; }
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
      padding: 8px 16px;
      background: var(--bg-3);
      color: var(--text-2);
      border: 1px solid var(--border-medium);
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.15s;
    }
    .send-btn:hover { background: var(--border-subtle); color: var(--text-1); }
    .send-btn.primary {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    .send-btn.primary:hover { background: var(--accent-hover); color: white; }
    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .insert-btn {
      display: inline-block;
      margin-top: 0;
      padding: 3px 8px;
      font-size: 11px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .insert-btn.secondary {
      background: transparent;
      color: var(--accent);
      border: 1px solid var(--accent);
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
    // 自定义 AI 场景 + 「更多」下拉 + 场景管理 overlay 状态
    this._customScenes = [];
    this._moreOpen = false;
    this._sceneMgrOpen = false;
    // per-tab 对话历史：每个打开的文件维护独立 AI 对话，切换 tab 时切换历史
    this._messagesByPath = new Map();
    this._activePath = null;
    // 流式输出绑定到发起它的 tab：中途切 tab 不串台，切回仍可见
    this._streamingMessages = null;
    this._streamingPath = null;
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
    // per-tab 对话历史：绑定活动文件，切换 tab 时切换历史
    this._activePath = editorState.activeFilePath;
    this._fileOpenedHandler = ({ path }) => this._onFileOpened(path);
    eventBus.on('file-opened', this._fileOpenedHandler);
    this._fileClosedHandler = (path) => this._messagesByPath.delete(path);
    eventBus.on('file-closed', this._fileClosedHandler);
    this._fileRenamedHandler = ({ oldPath, newPath }) => this._onFileRenamed(oldPath, newPath);
    eventBus.on('file-renamed', this._fileRenamedHandler);
    // 自定义 AI 场景：加载已保存的，并监听管理组件的变更广播
    this._scenesHandler = (scenes) => { this._customScenes = Array.isArray(scenes) ? scenes : []; this.requestUpdate(); };
    eventBus.on('ai-scenes-changed', this._scenesHandler);
    loadCustomAiScenes().then((s) => { this._customScenes = s || []; }).catch(() => {});
    // 加载上下文上限配置（compact 阈值）
    loadAiConfig().then((ai) => { this._contextLimit = ai?.context_limit || 100000; }).catch(() => {});
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._toggleHandler) eventBus.off('toggle-ai-panel', this._toggleHandler);
    if (this._forceCloseHandler) eventBus.off('force-close-all-panels', this._forceCloseHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
    if (this._formatHandler) eventBus.off('file-format-changed', this._formatHandler);
    if (this._fileOpenedHandler) eventBus.off('file-opened', this._fileOpenedHandler);
    if (this._fileClosedHandler) eventBus.off('file-closed', this._fileClosedHandler);
    if (this._fileRenamedHandler) eventBus.off('file-renamed', this._fileRenamedHandler);
    if (this._scenesHandler) eventBus.off('ai-scenes-changed', this._scenesHandler);
    if (this._moreDocHandler) { document.removeEventListener('click', this._moreDocHandler, true); this._moreDocHandler = null; }
    this._tauriUnlisten?.then(fn => fn());
  }

  /** 活动文件切换：保存当前 tab 历史，载入目标 tab 历史 */
  _onFileOpened(path) {
    if (path === this._activePath) return;
    // 当前 tab 的 messages 可能被流式/追加重新赋值过，回写到 Map
    if (this._activePath != null) this._messagesByPath.set(this._activePath, this.messages);
    this._activePath = path;
    this.messages = this._messagesByPath.get(path) || [];
    this.requestUpdate();
  }

  /** 文件重命名：历史与流式绑定迁移到新 path */
  _onFileRenamed(oldPath, newPath) {
    if (this._messagesByPath.has(oldPath)) {
      this._messagesByPath.set(newPath, this._messagesByPath.get(oldPath));
      this._messagesByPath.delete(oldPath);
    }
    if (this._activePath === oldPath) this._activePath = newPath;
    if (this._streamingPath === oldPath) this._streamingPath = newPath;
  }

  _handleStreamChunk(payload) {
    // 流式目标：发起流式时的 tab 历史（中途切 tab 时 token 仍写入原 tab，切回可见）
    const arr = this._streamingMessages || this.messages;
    const visible = arr === this.messages;
    if (payload.kind === 'token') {
      this._streamBuffer += payload.content;
      if (arr.length > 0) {
        const last = arr[arr.length - 1];
        if (last.role === 'assistant') {
          last.content = this._streamBuffer;
          if (visible) this.requestUpdate();
        }
      }
    } else if (payload.kind === 'done') {
      this.isStreaming = false;
      if (arr.length > 0) {
        const last = arr[arr.length - 1];
        // 统一去掉 AI 输出首尾换行：让消息体显示、对比修改、插入编辑器三者一致
        if (last.role === 'assistant' && last.content) {
          // 先兜底剥掉模型偶发的整体代码围栏（```adoc … ```），再去首尾换行
          last.content = stripFenceWrapper(last.content).replace(/^\n+|\n+$/g, '');
        }
        // 给最后一条 assistant 消息附上原文与选区范围，供「对比修改/接受」使用
        if (last.role === 'assistant' && this._pendingDiffOriginal) {
          last.diffOriginal = this._pendingDiffOriginal;
          last.diffRange = this._pendingDiffRange;
          this._pendingDiffOriginal = '';
          this._pendingDiffRange = null;
        }
      }
      this._streamingMessages = null;
      this._streamingPath = null;
      this.requestUpdate();
    } else if (payload.kind === 'truncated') {
      // 标记最后一条 assistant 消息被截断（独立标志，不混入 content，避免污染对比修改/插入）
      if (arr.length > 0) {
        const last = arr[arr.length - 1];
        if (last.role === 'assistant') last.truncated = true;
      }
      if (visible) this.requestUpdate();
    } else if (payload.kind === 'error') {
      this.isStreaming = false;
      arr.push({ role: 'assistant', content: `${t('ai.errorPrefix')}${payload.content}` });
      if (this._streamingPath != null) this._messagesByPath.set(this._streamingPath, arr);
      this._streamingMessages = null;
      this._streamingPath = null;
      this.requestUpdate();
    }
  }

  _startStreaming(userMessage, systemPrompt, original = '', range = null, label = '') {
    this._pendingDiffOriginal = original;
    // 仅对有原文的改写记录范围，供「接受」精确还原原选区
    this._pendingDiffRange = original ? range : null;
    // push（保持引用）：让 _messagesByPath 与 this.messages 始终同一引用，切 tab 不脱节
    this.messages.push(
      { role: 'user', content: userMessage, label },
      { role: 'assistant', content: '' },
    );
    // 绑定流式目标到当前 tab：中途切 tab 时 token 仍写入此 tab 的历史
    this._streamingMessages = this.messages;
    this._streamingPath = this._activePath;
    if (this._activePath != null) this._messagesByPath.set(this._activePath, this.messages);
    this.isStreaming = true;
    this._streamBuffer = '';

    // 多轮：历史 + 本轮 user（跳过空 assistant 占位）映射为 API messages，压缩后发送
    const apiMessages = this.messages
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    const { messages: compacted } = compactMessages(apiMessages, this._contextLimit);

    streamChatCompletion(compacted, systemPrompt).catch((e) => {
      this.isStreaming = false;
      const arr = this._streamingMessages || this.messages;
      arr.push({ role: 'assistant', content: t('ai.requestFailed', { error: e }) });
      if (this._streamingPath != null) this._messagesByPath.set(this._streamingPath, arr);
      this._streamingMessages = null;
      this._streamingPath = null;
      if (arr === this.messages) this.requestUpdate();
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

  _toggleMore() {
    this._moreOpen = !this._moreOpen;
    this.requestUpdate();
    if (this._moreOpen) {
      // 延迟绑 document click：点 more-wrap 外部关闭菜单（setTimeout 避开本次按钮 click）
      setTimeout(() => {
        this._moreDocHandler = (e) => {
          if (!this._moreOpen) {
            document.removeEventListener('click', this._moreDocHandler, true);
            this._moreDocHandler = null;
            return;
          }
          const wrap = this.renderRoot.querySelector('.more-wrap');
          if (wrap && !e.composedPath().includes(wrap)) {
            this._moreOpen = false;
            this.requestUpdate();
            document.removeEventListener('click', this._moreDocHandler, true);
            this._moreDocHandler = null;
          }
        };
        document.addEventListener('click', this._moreDocHandler, true);
      }, 0);
    } else if (this._moreDocHandler) {
      document.removeEventListener('click', this._moreDocHandler, true);
      this._moreDocHandler = null;
    }
  }

  _executeAction(actionKey) {
    const action = AI_ACTIONS[actionKey];
    if (!action || this.isStreaming) return;

    this.activeAction = actionKey;
    const selected = this._getSelectedText();
    const fullContent = this._getFullContent();
    // 选中→选区范围；整篇改写类（behavior=rewrite）→整篇范围，供「接受」精确替换
    let range = selected ? this._getSelectionRange() : null;
    if (!selected && action.behavior === 'rewrite' && fullContent) {
      // fullDoc 标记区分「整篇改写」与「选区改写」（选区也可能从 0 起），供 _showDiff 判定
      range = { from: 0, to: fullContent.length, fullDoc: true };
    }
    const req = buildAiRequest(actionKey, {
      selected,
      fullContent,
      formatId: this._currentFormatId,
    });
    if (!req) return;
    // 场景按钮也带上输入框内容（与「发送」统一：场景即「预设指令的发送」）
    const extra = (this._customInput || '').trim();
    if (extra) {
      req.userMessage = `${extra}\n\n${req.userMessage}`;
      this._customInput = '';
      this.requestUpdate();
    }
    const label = `${t(action.labelKey)}（${selected ? '选中文本' : '整篇文档'}）`;
    this._startStreaming(req.userMessage, req.systemPrompt, req.original, range, label);
  }

  /** 自定义场景：与内置场景同构，走 buildSceneRequest */
  _executeScene(scene) {
    if (!scene || this.isStreaming) return;
    this._moreOpen = false;
    this.activeAction = scene.id;
    const selected = this._getSelectedText();
    const fullContent = this._getFullContent();
    let range = selected ? this._getSelectionRange() : null;
    if (!selected && scene.behavior === 'rewrite' && fullContent) {
      range = { from: 0, to: fullContent.length, fullDoc: true };
    }
    const req = buildSceneRequest(scene, {
      selected,
      fullContent,
      formatId: this._currentFormatId,
    });
    const label = `${scene.name}（${selected ? '选中文本' : '整篇文档'}）`;
    this._startStreaming(req.userMessage, req.systemPrompt, req.original, range, label);
  }

  _sendCustom() {
    const instruction = this._customInput?.trim();
    if (!instruction || this.isStreaming) return;
    this._customInput = '';
    // 发送=自定义指令（非场景），清场景高亮，发送回归 primary
    this.activeAction = '';
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
    this._diffMsg = msg;
    // 整篇改写（fullDoc 标记）：基于「当前编辑区」对比（点击前可能已手工调整），让差异反映真实待应用状态。
    // 不能用 from===0 判定——选区改写选中文档开头时 from 同样为 0，会误进此分支覆盖全文。
    if (msg.diffRange?.fullDoc) {
      const currentFull = this._getFullContent();
      this._diffOriginal = currentFull;
      this._diffRange = { from: 0, to: currentFull.length };
    } else {
      this._diffOriginal = msg.diffOriginal || '';
      this._diffRange = msg.diffRange || null;
    }
    this._diffProposed = msg.content || '';
    this._diffVisible = true;
    this.requestUpdate();
  }

  _acceptDiff(text) {
    // 接受：用（经逐块取舍的）结果替换原始范围
    eventBus.emit('ai-insert-text', { text, range: this._diffRange });
    // 标记该消息已应用：移除「对比修改」按钮，避免用旧 range 重复对编辑区操作
    if (this._diffMsg) {
      this._diffMsg.diffOriginal = null;
      this._diffMsg.diffRange = null;
      this._diffMsg.applied = true;
    }
    this._diffMsg = null;
    this._diffVisible = false;
    this.requestUpdate();
  }

  _insertMessage(msg) {
    eventBus.emit('ai-insert-text', msg.content);
    // 标记已用：移除「插入编辑器/对比修改」，避免重复插入
    msg.applied = true;
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
        <span class="gear" @click=${() => { this._sceneMgrOpen = true; this._moreOpen = false; this.requestUpdate(); }} title="${t('ai.manageScenes')}">⚙</span>
        <span class="close" role="button" tabindex="0" title="${t('panel.collapseWithName', { name: t('ai.title') })}" @keydown=${activateOnKey} @click=${() => { this.classList.remove('visible'); eventBus.emit('ai-panel-toggled', false); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2"></rect>
            <line x1="15" y1="3" x2="15" y2="21"></line>
          </svg>
        </span>
      </div>
      <div class="content">
        ${this.messages.length === 0
          ? html`<div class="empty">${t('ai.emptyState')}</div>`
          : this.messages.map((msg, i) => html`
            <div class="message ${msg.role}">
              <div class="label">${msg.role === 'user' ? t('ai.you') : t('ai.aiLabel')}</div>
              <div class="msg-body">${msg.role === 'user' ? (msg.label || '（操作）') : (msg.content || '')}${msg.role === 'assistant' && this.isStreaming && i === this.messages.length - 1 ? html`<span class="typing-cursor"></span>` : ''}</div>
              ${msg.role === 'assistant' && msg.truncated && msg.content
                ? html`<div class="msg-truncated">⚠️ ${t('ai.truncated')}</div>`
                : ''}
              ${msg.role === 'assistant' && msg.content && !this.isStreaming && !msg.applied
                ? html`<div class="msg-actions">
                    <button class="insert-btn" @click=${() => this._insertMessage(msg)}>${t('ai.insertToEditor')}</button>
                    ${msg.diffOriginal ? html`<button class="insert-btn secondary" @click=${() => this._showDiff(msg)}>对比修改</button>` : ''}
                  </div>`
                : ''}
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
        <div class="input-actions">
          ${Object.entries(AI_ACTIONS).filter(([key]) => key === 'continue' || key === 'improve').map(([key, action]) => html`
            <button
              class="act-mini ${this.activeAction === key ? 'active' : ''}"
              @click=${() => this._executeAction(key)}
              ?disabled=${this.isStreaming}
            >${action.icon} ${t(action.labelKey)}</button>
          `)}
          <button class="send-btn ${this.activeAction ? '' : 'primary'}" ?disabled=${this.isStreaming} @click=${this._sendCustom}>➤ ${t('ai.send')}</button>
          <div class="more-wrap">
            <button
              class="act-mini ${this._moreOpen ? 'active' : ''}"
              @click=${() => this._toggleMore()}
              ?disabled=${this.isStreaming}
            >⋯ ${t('ai.more')}</button>
            ${this._moreOpen ? html`
              <div class="more-menu">
                ${Object.entries(AI_ACTIONS).filter(([key]) => key !== 'continue' && key !== 'improve').map(([key, action]) => html`
                  <button class="more-item" @click=${() => { this._moreOpen = false; this._executeAction(key); }}>
                    <span class="more-icon">${action.icon}</span>${t(action.labelKey)}
                  </button>
                `)}
                <div class="more-divider"></div>
                ${this._customScenes.length === 0
                  ? html`<div class="more-empty">${t('ai.scene.empty')}</div>`
                  : this._customScenes.map((scene) => html`
                    <button class="more-item" @click=${() => this._executeScene(scene)}>
                      <span class="more-icon">${scene.icon || '✦'}</span>${scene.name}
                    </button>
                  `)}
                <div class="more-divider"></div>
                <button class="more-item manage" @click=${() => { this._moreOpen = false; this._sceneMgrOpen = true; this.requestUpdate(); }}>
                  ⚙ ${t('ai.manageScenes')}
                </button>
              </div>
            ` : ''}
          </div>
        </div>
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
      ${this._sceneMgrOpen ? html`
        <ai-scene-manager
          .scenes=${this._customScenes}
          @close=${() => { this._sceneMgrOpen = false; this.requestUpdate(); }}
        ></ai-scene-manager>
      ` : ''}
    `;
  }
}

customElements.define('ai-panel', AiPanel);
