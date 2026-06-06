import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { eventBus } from '../services/event-bus.js';
import { setPreviewSync, syncEditor } from '../services/scroll-sync.js';
import { editorState } from '../services/editor-state.js';
import { t } from '../services/i18n.js';
import { buildAttributes } from '../services/asciidoc-attrs.js';

let asciidoctor = null;
let markedInstance = null;

async function getMarked() {
  if (!markedInstance) {
    const { marked } = await import('marked');
    markedInstance = marked;
  }
  return markedInstance;
}

class PreviewPane extends LitElement {
  static properties = {
    renderedHtml: { type: String },
  };

  static styles = css`
    :host {
      display: block;
      padding: 24px 32px;
      overflow-y: auto;
      height: 100%;
      background: var(--bg-1);
    }
    .close-bar {
      position: sticky;
      top: 0;
      display: flex;
      justify-content: flex-end;
      z-index: 10;
      height: 0;
      pointer-events: none;
    }
    .close-btn {
      pointer-events: auto;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-3);
      font-size: 14px;
      padding: 4px 8px;
      opacity: 0.5;
      transition: opacity 0.15s, color 0.15s;
    }
    .close-btn:hover {
      opacity: 1;
      color: var(--text-1);
    }
    .placeholder {
      color: var(--text-3);
      text-align: center;
      padding-top: 40px;
      font-size: 13px;
    }
    :host ::slotted(*),
    .preview-content {
      font-family: var(--font-sans);
      line-height: 1.7;
      color: var(--text-1);
    }
    .preview-content h1 {
      font-size: 1.8em;
      font-family: var(--font-display);
      margin: 0.5em 0 0.3em;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 0.3em;
      letter-spacing: -0.01em;
    }
    .preview-content h2 {
      font-size: 1.5em;
      font-family: var(--font-display);
      margin: 0.5em 0 0.3em;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 0.2em;
    }
    .preview-content h3 { font-size: 1.3em; margin: 0.5em 0 0.3em; }
    .preview-content h4 { font-size: 1.1em; margin: 0.5em 0 0.3em; }
    .preview-content p { margin: 0.5em 0; }
    .preview-content ul, .preview-content ol { padding-left: 2em; margin: 0.5em 0; }
    .preview-content code {
      font-family: var(--font-mono);
      font-size: 0.9em;
      background: var(--bg-3);
      padding: 2px 4px;
      border-radius: 3px;
    }
    .preview-content pre {
      background: var(--bg-2);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 12px 16px;
      overflow-x: auto;
      margin: 0.8em 0;
    }
    .preview-content pre code {
      background: transparent;
      padding: 0;
    }
    .preview-content blockquote {
      border-left: 3px solid var(--accent);
      padding-left: 1em;
      margin: 0.5em 0;
      color: var(--text-2);
    }
    .preview-content table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.8em 0;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      overflow: hidden;
    }
    .preview-content th, .preview-content td {
      border: 1px solid var(--border-subtle);
      padding: 6px 12px;
      text-align: left;
    }
    .preview-content th {
      background: var(--bg-3);
      font-weight: 600;
      font-family: var(--font-display);
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .preview-content a {
      color: var(--accent);
      text-decoration: none;
    }
    .preview-content a:hover {
      text-decoration: underline;
    }
    .preview-content img {
      max-width: 100%;
      border-radius: 6px;
    }
    /* Admonition 块 */
    .preview-content .admonitionblock {
      margin: 16px 0;
      padding: 16px;
      border-radius: 6px;
      border-left: 4px solid var(--accent);
      background: var(--bg-2);
    }
    .preview-content .admonitionblock.note {
      border-left-color: var(--color-success);
      background: rgba(16, 185, 129, 0.05);
    }
    .preview-content .admonitionblock.warning {
      border-left-color: var(--color-warning);
      background: rgba(245, 158, 11, 0.05);
    }
    .preview-content .admonitionblock.important {
      border-left-color: var(--color-error);
      background: rgba(239, 68, 68, 0.05);
    }
    .preview-content .admonitionblock.caution {
      border-left-color: #d97706;
      background: rgba(217, 119, 6, 0.05);
    }
  `;

  constructor() {
    super();
    this.renderedHtml = '';
    this._debounceTimer = null;
    this._ignoreScroll = false;
    this._visible = true;
    this._currentFormat = null;
  }

  async connectedCallback() {
    super.connectedCallback();
    if (!asciidoctor) {
      const module = await import('@asciidoctor/core');
      asciidoctor = module.default();
    }
    this._contentHandler = (content) => this._render(content);
    eventBus.on('content-changed', this._contentHandler);
    this._lastContent = '';
    this._langHandler = () => { if (this._lastContent) this._render(this._lastContent); };
    eventBus.on('language-changed', this._langHandler);
    // 编辑器-预览滚动同步（直接函数调用，零 GC 开销）
    setPreviewSync((ratio) => this._onEditorScrolled(ratio));
    this._scrollHandler = () => {
      if (this._ignoreScroll || !this._visible) return;
      const max = this.scrollHeight - this.clientHeight;
      if (max > 0) syncEditor(this.scrollTop / max);
    };
    this.addEventListener('scroll', this._scrollHandler, { passive: true });
    this._visHandler = (v) => { this._visible = v; };
    eventBus.on('preview-visibility-changed', this._visHandler);
    this._formatHandler = (format) => {
      this._currentFormat = format;
      if (this._lastContent) this._render(this._lastContent);
    };
    eventBus.on('file-format-changed', this._formatHandler);
    // 初始化时同步当前格式（编辑器可能已打开文件）
    this._currentFormat = editorState.activeFilePath
      ? (await import('../services/format-commands.js')).getFormat(editorState.activeFilePath)
      : null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._contentHandler) eventBus.off('content-changed', this._contentHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
    setPreviewSync(null);
    if (this._scrollHandler) this.removeEventListener('scroll', this._scrollHandler);
    if (this._visHandler) eventBus.off('preview-visibility-changed', this._visHandler);
    if (this._formatHandler) eventBus.off('file-format-changed', this._formatHandler);
    clearTimeout(this._debounceTimer);
  }

  _render(content) {
    this._lastContent = content;
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(async () => {
      const isMd = this._currentFormat?.id === 'md';
      try {
        if (isMd) {
          const marked = await getMarked();
          this.renderedHtml = marked.parse(content);
        } else {
          if (!asciidoctor) return;
          // 解析 include 指令
          let resolved = content;
          const activePath = editorState.activeFilePath;
          if (activePath && !activePath.startsWith('__untitled_') && content.includes('include::')) {
            try {
              const { resolveIncludes } = await import('../services/export-service.js');
              const dir = activePath.replace(/\/[^/]+$/, '');
              resolved = await resolveIncludes(content, dir);
            } catch (_) {}
          }
          const baseAttrs = {
            showtitle: true,
            toc: 'auto',
            'source-highlighter': 'highlight.js',
            sectanchors: '',
            icons: 'font',
          };
          const attrs = buildAttributes(resolved, baseAttrs);
          this.renderedHtml = asciidoctor.convert(resolved, {
            safe: 'safe',
            attributes: attrs,
          });
        }
      } catch (e) {
        console.error('渲染错误:', e);
        this.renderedHtml = `<p style="color:red">${t('msg.renderError', { error: e.message })}</p>`;
      }
    }, 200);
  }

  // 滚动同步：编辑器滚动时跟随（scrollTop 赋值同步触发 scroll 事件）
  _onEditorScrolled(ratio) {
    if (!this._visible) return;
    const max = this.scrollHeight - this.clientHeight;
    if (max <= 0) return;
    this._ignoreScroll = true;
    this.scrollTop = ratio * max;
    this._ignoreScroll = false;
  }

  _close() {
    eventBus.emit('preview-close');
  }

  render() {
    return html`
      <div class="close-bar">
        <button class="close-btn" @click=${this._close}>✕</button>
      </div>
      ${!this.renderedHtml
        ? html`<div class="placeholder">${t('preview.placeholder')}</div>`
        : html`<div class="preview-content">${unsafeHTML(this.renderedHtml)}</div>`
      }
    `;
  }
}

customElements.define('preview-pane', PreviewPane);
