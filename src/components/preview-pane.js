import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { eventBus } from '../services/event-bus.js';
import { setPreviewSync, syncEditor } from '../services/scroll-sync.js';
import { editorState } from '../services/editor-state.js';
import { parseOutline } from '../services/outline-parser.js';
import { t } from '../services/i18n.js';
import { buildAttributes } from '../services/asciidoc-attrs.js';
import { getFileCategory, getFormat } from '../services/format-commands.js';
import { readBinaryFile } from '../services/file-service.js';
import { resolveIncludesIfAny } from '../services/export-service.js';
import { getAsciidoctor } from '../services/asciidoctor-instance.js';
import { getRendered, setRendered } from '../services/preview-cache.js';

let markedInstance = null;

async function getMarked() {
  if (!markedInstance) {
    const { marked } = await import('marked');
    markedInstance = marked;
  }
  return markedInstance;
}

function stripFrontMatter(content) {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return content;
  const endIdx = lines.slice(1).findIndex(l => l.trim() === '---') + 1;
  if (endIdx <= 0) return content;
  return lines.slice(endIdx + 1).join('\n');
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
    /* 纯文本预览 */
    .preview-content pre.plain-text {
      background: var(--bg-2);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 16px 20px;
      overflow-x: auto;
      margin: 0;
      font-family: var(--font-mono);
      font-size: 0.9em;
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .preview-content pre.plain-text code {
      background: transparent;
      padding: 0;
      font-family: inherit;
      font-size: inherit;
    }
    /* 二进制文件预览（图片/音频/视频） */
    .preview-content .binary-preview {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 200px;
      padding: 24px;
    }
    .preview-content .binary-preview img {
      max-width: 100%;
      max-height: 80vh;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .preview-content .binary-preview audio,
    .preview-content .binary-preview video {
      max-width: 100%;
      border-radius: 6px;
    }
    /* HTML / PDF iframe 预览 */
    .preview-content .html-preview,
    .preview-content .pdf-preview {
      width: 100%;
      height: 80vh;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      background: white;
    }
  `;

  constructor() {
    super();
    this.renderedHtml = '';
    this._debounceTimer = null;
    this._ignoreScroll = false;
    this._visible = true;
    this._viewMode = 'split';
    this._currentFormat = null;
  }

  async connectedCallback() {
    super.connectedCallback();
    this._asciidoctor = await getAsciidoctor();
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
    this._viewModeHandler = (mode) => {
      this._viewMode = mode;
      this._visible = mode === 'split';
      // 从 edit 模式切回 split/preview 时重新渲染
      if (mode !== 'edit' && this._lastContent) this._render(this._lastContent);
    };
    eventBus.on('view-mode-changed', this._viewModeHandler);
    // 大纲/反链点击定位：仅 preview 模式（编辑器隐藏）由预览接管，edit/split 仍交给编辑器
    this._jumpHandler = (line) => this._scrollToHeading({ line });
    eventBus.on('jump-to-line', this._jumpHandler);
    // 大纲点击定位（含 include 标题）：优先用 id 精确滚到预览标题；id 缺失回退行号映射
    this._jumpToHeadingHandler = (payload) => this._scrollToHeading(payload || {});
    eventBus.on('jump-to-heading', this._jumpToHeadingHandler);
    this._formatHandler = (format) => {
      this._currentFormat = format;
      if (this._lastContent) this._render(this._lastContent);
    };
    eventBus.on('file-format-changed', this._formatHandler);
    // 初始化时同步当前格式（编辑器可能已打开文件）
    this._currentFormat = editorState.activeFilePath
      ? getFormat(editorState.activeFilePath)
      : null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._contentHandler) eventBus.off('content-changed', this._contentHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
    setPreviewSync(null);
    if (this._scrollHandler) this.removeEventListener('scroll', this._scrollHandler);
    if (this._visHandler) eventBus.off('preview-visibility-changed', this._visHandler);
    if (this._viewModeHandler) eventBus.off('view-mode-changed', this._viewModeHandler);
    if (this._formatHandler) eventBus.off('file-format-changed', this._formatHandler);
    if (this._jumpHandler) eventBus.off('jump-to-line', this._jumpHandler);
    if (this._jumpToHeadingHandler) eventBus.off('jump-to-heading', this._jumpToHeadingHandler);
    clearTimeout(this._debounceTimer);
  }

  _render(content) {
    this._lastContent = content;
    clearTimeout(this._debounceTimer);
    // edit 模式下跳过渲染（节省 CPU）
    if (this._viewMode === 'edit') return;
    this._debounceTimer = setTimeout(async () => {
      const filePath = editorState.activeFilePath;
      const category = getFileCategory(filePath);
      try {
        switch (category) {
          case 'markup':
            await this._renderMarkup(content);
            break;
          case 'svg':
            this.renderedHtml = `<div class="binary-preview"><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}" alt="" /></div>`;
            break;
          case 'html':
            this._renderHtml(content);
            break;
          case 'image':
          case 'audio':
          case 'video':
          case 'pdf':
            await this._renderBinary(filePath, category);
            break;
          case 'text':
          default:
            this._renderPlainText(content);
            break;
        }
      } catch (e) {
        console.error('渲染错误:', e);
        this.renderedHtml = `<p style="color:red">${t('msg.renderError', { error: e.message })}</p>`;
      }
    }, 200);
  }

  async _renderMarkup(content) {
    const isMd = this._currentFormat?.id === 'md';
    if (isMd) {
      const body = content.startsWith('---') ? stripFrontMatter(content) : content;
      // 渲染缓存：以渲染原文做指纹，命中即跳过 marked.parse
      const mdCached = getRendered('md', null, body);
      if (mdCached !== null) { this.renderedHtml = mdCached; return; }
      const marked = await getMarked();
      const mdHtml = marked.parse(body);
      this.renderedHtml = mdHtml;
      setRendered('md', null, body, mdHtml);
    } else {
      if (!this._asciidoctor) return;
      const baseAttrs = {
        showtitle: true,
        toc: 'auto',
        'source-highlighter': 'highlight.js',
        sectanchors: '',
        icons: 'font',
      };
      // 渲染缓存：以原文内容做指纹，命中即跳过 include 解析与 asciidoctor.convert。
      // 残留风险见 preview-cache.js：include 引用的外部文件被本软件外修改时不失效。
      const adocCached = getRendered('adoc', baseAttrs, content);
      if (adocCached !== null) { this.renderedHtml = adocCached; return; }
      // 解析 include 指令（仅缓存未命中时执行）
      const resolved = await resolveIncludesIfAny(content, editorState.activeFilePath);
      const attrs = buildAttributes(resolved, baseAttrs);
      const html = this._asciidoctor.convert(resolved, {
        safe: 'safe',
        attributes: attrs,
      });
      this.renderedHtml = html;
      setRendered('adoc', baseAttrs, content, html);
    }
  }

  _renderPlainText(content) {
    const escaped = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    this.renderedHtml = `<pre class="plain-text"><code>${escaped}</code></pre>`;
  }

  _renderHtml(content) {
    const escaped = content
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
    this.renderedHtml = `<iframe srcdoc="${escaped}" sandbox class="html-preview"></iframe>`;
  }

  async _renderBinary(filePath, type) {
    if (!filePath) return;
    try {
      const { base64, mime } = await readBinaryFile(filePath);
      const src = `data:${mime};base64,${base64}`;
      switch (type) {
        case 'image':
          this.renderedHtml = `<div class="binary-preview"><img src="${src}" alt="" /></div>`;
          break;
        case 'audio':
          this.renderedHtml = `<div class="binary-preview"><audio controls src="${src}"></audio></div>`;
          break;
        case 'video':
          this.renderedHtml = `<div class="binary-preview"><video controls src="${src}"></video></div>`;
          break;
        case 'pdf':
          this.renderedHtml = `<iframe src="${src}" class="pdf-preview"></iframe>`;
          break;
      }
    } catch (e) {
      console.error('[preview] readBinaryFile failed:', e);
      this.renderedHtml = `<p style="color:var(--text-3);text-align:center;padding-top:40px;">Preview not available</p>`;
    }
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

  // renderedHtml 更新后（DOM 已注入）建立 行号→标题元素 映射
  updated(changedProps) {
    if (changedProps.has('renderedHtml') && this.renderedHtml) this._buildHeadingMap();
  }

  // renderedHtml 更新后建立 行号→标题元素 映射（供 backlinks 的 jump-to-line、以及无 id 标题的回退定位）
  async _buildHeadingMap() {
    const path = editorState.activeFilePath;
    if (!path) { this._lineToHeadingEl = null; return; }
    const content = editorState.getFile(path)?.content ?? '';
    try {
      // 复用 outline-parser：adoc 含 include 时标题序列与预览 DOM 同源（同为 asciidoctor），下标对齐可靠
      const headings = await parseOutline(content, path);
      const els = [...this.shadowRoot.querySelectorAll('.preview-content :is(h1,h2,h3,h4,h5,h6)')];
      const map = new Map();
      const n = Math.min(els.length, headings.length);
      for (let i = 0; i < n; i++) {
        if (parseInt(els[i].tagName.slice(1), 10) !== headings[i].level) break;
        if (headings[i].line != null) map.set(headings[i].line, els[i]);
      }
      this._lineToHeadingEl = map;
    } catch (_) {
      this._lineToHeadingEl = null;
    }
  }

  // 预览侧统一入口：优先用 id 精确定位（asciidoctor 标题）；id 缺失（doc title / Markdown）回退行号映射。
  // 仅 preview 模式接管——edit/split 由编辑器定位 + 比例同步跟随，避免双向滚动打架。
  _scrollToHeading({ id, line }) {
    if (this._viewMode !== 'preview') return;
    let el = null;
    if (id != null) el = this.shadowRoot.getElementById(id);
    if (!el && line != null) el = this._lineToHeadingEl?.get(line);
    el?.scrollIntoView({ block: 'start' });
  }

  // 拦截预览内的内部锚点链接（asciidoc TOC / <<anchor>> / xref / sectanchors）。
  // shadow DOM 内浏览器默认 fragment 导航不穿透 shadowRoot，需手动定位。
  _onPreviewClick(e) {
    if (this._viewMode === 'edit') return;
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('#') || href === '#') return;
    e.preventDefault();
    const raw = href.slice(1);
    // 先按原始 id 查（asciidoctor 生成的 id 无编码）；未命中再 decode（浏览器编码的中文锚点），畸形 % 兜底
    let target = this.shadowRoot.getElementById(raw);
    if (!target) { try { target = this.shadowRoot.getElementById(decodeURIComponent(raw)); } catch (_) {} }
    target?.scrollIntoView({ block: 'start' });
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
        : html`<div class="preview-content" @click=${(e) => this._onPreviewClick(e)}>${unsafeHTML(this.renderedHtml)}</div>`
      }
    `;
  }
}

customElements.define('preview-pane', PreviewPane);
