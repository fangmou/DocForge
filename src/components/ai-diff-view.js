import { LitElement, html, css } from 'lit';
import { diffChunks, buildResult, diffStats } from '../services/line-diff.js';

/**
 * AI 改写 side-by-side 对比视图（自研）。
 *
 * @codemirror/merge 的 MergeView（side-by-side）没有 per-chunk 按钮，per-chunk 的
 * mergeControls 只在单栏 unifiedMergeView。本组件用行级 LCS diff 自绘两栏，每个改动块
 * 可单独切换「用原文 / 用修改」，接受时按选择拼接为最终文本。
 */
class AiDiffView extends LitElement {
  static properties = {
    original: { type: String },
    proposed: { type: String },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-1);
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border-medium);
      background: var(--bg-2);
      font-size: 12px;
      color: var(--text-2);
      flex-shrink: 0;
    }
    .title {
      margin-right: auto;
      font-weight: 600;
      color: var(--text-1);
      font-family: var(--font-display);
    }
    .stats { color: var(--text-3); margin-right: 4px; }
    .stats .add { color: var(--color-success); }
    .stats .del { color: var(--color-error); }
    button {
      padding: 4px 12px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: var(--bg-3);
      color: var(--text-2);
      cursor: pointer;
      font-size: 12px;
    }
    button:hover { color: var(--text-1); }
    button.primary {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .body {
      flex: 1;
      overflow: auto;
      display: grid;
      grid-template-columns: 1fr 1fr;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.6;
    }
    .col-h {
      position: sticky;
      top: 0;
      padding: 6px 12px;
      background: var(--bg-2);
      border-bottom: 1px solid var(--border-medium);
      font-weight: 600;
      color: var(--text-3);
      z-index: 1;
      font-family: var(--font-sans);
    }
    .cell {
      padding: 2px 12px;
      border-bottom: 1px solid var(--border-subtle);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .cell.equal { color: var(--text-3); }
    .cell.changed.a.will-remove { background: rgba(229,68,68,0.10); color: var(--text-2); }
    .cell.changed.a.kept { background: var(--bg-1); color: var(--text-1); }
    .cell.changed.b.will-apply { background: rgba(16,185,129,0.12); color: var(--text-1); }
    .cell.changed.b.rejected { background: var(--bg-1); color: var(--text-3); opacity: 0.55; }
    .muted { color: var(--text-3); font-style: italic; }
    .chunk-btn {
      display: inline-block;
      margin-top: 4px;
      padding: 1px 8px;
      font-size: 11px;
      border: 1px solid var(--border-medium);
      border-radius: 3px;
      background: var(--bg-2);
      color: var(--text-2);
      cursor: pointer;
      font-family: var(--font-sans);
    }
    .chunk-btn:hover { color: var(--text-1); border-color: var(--accent); }
  `;

  constructor() {
    super();
    this.original = '';
    this.proposed = '';
    this._chunks = [];
    this._applied = {};
  }

  willUpdate(changed) {
    if (changed.has('original') || changed.has('proposed')) {
      this._chunks = diffChunks(this.original, this.proposed);
      this._applied = {};
      this._chunks.forEach((c, i) => {
        if (c.type === 'changed') this._applied[i] = true; // 默认采用修改
      });
    }
  }

  _toggle(i) {
    this._applied = { ...this._applied, [i]: !this._applied[i] };
    this.requestUpdate();
  }

  _setAll(value) {
    const next = {};
    this._chunks.forEach((c, i) => {
      if (c.type === 'changed') next[i] = value;
    });
    this._applied = next;
    this.requestUpdate();
  }

  _accept() {
    this.dispatchEvent(
      new CustomEvent('accept', {
        detail: { text: buildResult(this._chunks, this._applied) },
      }),
    );
  }

  _reject() {
    this.dispatchEvent(new CustomEvent('reject'));
  }

  render() {
    const stats = diffStats(this._chunks);
    return html`
      <div class="toolbar">
        <span class="title">对比修改</span>
        <span class="stats">
          <span class="add">+${stats.added}</span>
          <span class="del">-${stats.removed}</span>
          · ${stats.changedBlocks} 处改动
        </span>
        <button @click=${() => this._setAll(false)}>全部用原文</button>
        <button @click=${() => this._setAll(true)}>全部用修改</button>
        <button class="primary" @click=${this._accept}>接受</button>
        <button @click=${this._reject}>取消</button>
      </div>
      <div class="body">
        <div class="col-h">原文</div>
        <div class="col-h">AI 修改</div>
        ${this._chunks.map((c, i) => this._renderChunk(c, i))}
      </div>
    `;
  }

  _renderChunk(c, i) {
    const NBSP = ' ';
    if (c.type === 'equal') {
      return html`
        <div class="cell equal">${c.lines.map((l) => html`<div>${l || NBSP}</div>`)}</div>
        <div class="cell equal">${c.lines.map((l) => html`<div>${l || NBSP}</div>`)}</div>
      `;
    }
    const applied = this._applied[i];
    return html`
      <div class="cell changed a ${applied ? 'will-remove' : 'kept'}">
        ${c.aLines.length
          ? c.aLines.map((l) => html`<div>${l || NBSP}</div>`)
          : html`<div class="muted">（无）</div>`}
        <button class="chunk-btn" @click=${() => this._toggle(i)}>
          ${applied ? '↶ 撤销（保留原文）' : '→ 采用此修改'}
        </button>
      </div>
      <div class="cell changed b ${applied ? 'will-apply' : 'rejected'}">
        ${c.bLines.length
          ? c.bLines.map((l) => html`<div>${l || NBSP}</div>`)
          : html`<div class="muted">（无）</div>`}
      </div>
    `;
  }
}

customElements.define('ai-diff-view', AiDiffView);
