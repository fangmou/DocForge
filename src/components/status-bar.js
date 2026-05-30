import { LitElement, html, css } from 'lit';
import { editorState } from '../services/editor-state.js';
import { eventBus } from '../services/event-bus.js';
import { t } from '../services/i18n.js';

// 检测编码：检查 BOM 或回退 UTF-8
function detectEncoding(content) {
  if (!content) return 'UTF-8';
  if (content.charCodeAt(0) === 0xFEFF) return 'UTF-8 BOM';
  return 'UTF-8';
}

// 根据扩展名检测文件类型
function detectFileType(path) {
  if (!path) return '';
  if (path.startsWith('__untitled_')) return 'AsciiDoc';
  const ext = path.split('.').pop().toLowerCase();
  const map = { adoc: 'AsciiDoc', asc: 'AsciiDoc', ad: 'AsciiDoc', txt: 'Plain Text', md: 'Markdown' };
  return map[ext] || ext.toUpperCase();
}

class StatusBar extends LitElement {
  static properties = {
    filePath: { type: String },
    line: { type: Number },
    col: { type: Number },
    totalLines: { type: Number },
    words: { type: Number },
    isDirty: { type: Boolean },
    encoding: { type: String },
    fileType: { type: String },
    message: { type: String },
  };

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      height: var(--statusbar-height);
      padding: 0 14px;
      background: var(--bg-2);
      border-top: 1px solid var(--border-subtle);
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-3);
      gap: 14px;
      user-select: none;
    }
    .left, .right {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .spacer { flex: 1; }
    .file-name {
      color: var(--text-1);
      font-weight: 500;
      font-family: var(--font-sans);
    }
    .indicator {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--color-success);
      flex-shrink: 0;
    }
    .indicator.dirty {
      background: var(--color-warning);
    }
    .message {
      color: var(--text-1);
      font-weight: 500;
      font-family: var(--font-sans);
    }
    .format-label {
      color: var(--accent);
      font-weight: 600;
    }
    .sep {
      color: var(--border-medium);
    }
  `;

  constructor() {
    super();
    this.filePath = '';
    this.line = 1;
    this.col = 1;
    this.totalLines = 0;
    this.words = 0;
    this.isDirty = false;
    this.encoding = 'UTF-8';
    this.fileType = '';
    this.message = '';
    this._msgTimer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._unsub = editorState.onChange(() => this._update());
    this._cursorHandler = ({ line, col }) => {
      this.line = line;
      this.col = col;
    };
    eventBus.on('cursor-changed', this._cursorHandler);
    this._msgHandler = (msg) => {
      this.message = msg;
      clearTimeout(this._msgTimer);
      this._msgTimer = setTimeout(() => { this.message = ''; }, 4000);
    };
    eventBus.on('status-message', this._msgHandler);
    this._langHandler = () => this.requestUpdate();
    eventBus.on('language-changed', this._langHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    if (this._cursorHandler) eventBus.off('cursor-changed', this._cursorHandler);
    if (this._msgHandler) eventBus.off('status-message', this._msgHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
    clearTimeout(this._msgTimer);
  }

  _update() {
    const active = editorState.getActiveFile();
    if (active) {
      this.filePath = active.path;
      this.isDirty = active.isDirty;
      this.totalLines = active.content ? active.content.split('\n').length : 0;
      this.words = active.content ? active.content.split(/\s+/).filter(Boolean).length : 0;
      this.encoding = detectEncoding(active.content);
      this.fileType = detectFileType(active.path);
    } else {
      this.filePath = '';
      this.isDirty = false;
      this.totalLines = 0;
      this.words = 0;
      this.encoding = 'UTF-8';
      this.fileType = '';
    }
    this.requestUpdate();
  }

  render() {
    const name = this.filePath
      ? (this.filePath.startsWith('__untitled_') ? 'untitled.adoc' : this.filePath.split('/').pop())
      : t('statusBar.noFile');
    return html`
      <div class="left">
        <span class="indicator ${this.isDirty ? 'dirty' : ''}"></span>
        <span class="file-name">${name}</span>
        <span>${t('statusBar.lines', { count: this.totalLines })}</span>
        <span>${t('statusBar.words', { count: this.words })}</span>
        ${this.message ? html`<span class="message">${this.message}</span>` : ''}
      </div>
      <div class="spacer"></div>
      <div class="right">
        <span>${t('statusBar.lineCol', { line: this.line, col: this.col })}</span>
        <span class="sep">|</span>
        <span>${this.encoding}</span>
        <span class="sep">|</span>
        <span class="format-label">${this.fileType}</span>
      </div>
    `;
  }
}

customElements.define('status-bar', StatusBar);
