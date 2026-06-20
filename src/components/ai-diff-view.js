import { LitElement, html, css } from 'lit';
import { diffChunks, buildResult, diffStats } from '../services/line-diff.js';

/**
 * AI 改写 side-by-side 对比视图（自研，Beyond Compare 风格）。
 *
 * 三列布局：左原文 | 中间 gutter | 右 AI 修改。每个改动块在 gutter 中央放一个「采用」
 * 圆钮：+ 待采用（点击采纳）/ ✓ 已采用（点击撤销），逐块取舍；接受时按选择拼接。
 */
class AiDiffView extends LitElement {
  static properties = {
    original: { type: String },
    proposed: { type: String },
    title: { type: String },
    leftLabel: { type: String },
    rightLabel: { type: String },
    acceptLabel: { type: String },
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
      padding: 6px 14px;
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
      padding: 3px 10px;
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
      grid-template-columns: 1fr 32px 1fr;
      align-content: start;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.4;
    }
    .col-h {
      position: sticky;
      top: 0;
      padding: 4px 8px;
      background: var(--bg-2);
      border-bottom: 1px solid var(--border-medium);
      font-weight: 600;
      color: var(--text-3);
      z-index: 1;
      font-family: var(--font-sans);
    }
    .col-h.gutter-h { padding: 4px 0; text-align: center; }
    .cell {
      padding: 1px 8px;
      border-bottom: 1px solid var(--border-subtle);
      word-break: break-word;
      align-self: start;
    }
    .cell.equal { color: var(--text-3); }
    .cell.changed.a.will-remove { background: rgba(229,68,68,0.10); color: var(--text-2); }
    .cell.changed.a.kept { background: var(--bg-1); color: var(--text-1); }
    .cell.changed.b.will-apply { background: rgba(16,185,129,0.12); color: var(--text-1); }
    .cell.changed.b.rejected { background: var(--bg-1); color: var(--text-3); opacity: 0.55; }
    .muted { color: var(--text-3); font-style: italic; }
    .gutter {
      display: flex;
      align-items: center;
      justify-content: center;
      border-left: 1px solid var(--border-subtle);
      border-right: 1px solid var(--border-subtle);
      background: var(--bg-2);
      border-bottom: 1px solid var(--border-subtle);
    }
    .gutter-btn {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 1px solid var(--border-medium);
      background: var(--bg-3);
      color: var(--text-2);
      cursor: pointer;
      font-size: 13px;
      font-weight: 700;
      line-height: 1;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .gutter-btn.on {
      background: var(--color-success);
      color: #fff;
      border-color: var(--color-success);
    }
    .gutter-btn.off {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .gutter-btn:hover { opacity: 0.85; }
  `;

  constructor() {
    super();
    this.original = '';
    this.proposed = '';
    // 文案默认值（AI 改写场景）；未保存对比等复用场景可覆盖
    this.title = '对比修改';
    this.leftLabel = '原文';
    this.rightLabel = 'AI 修改';
    this.acceptLabel = '应用所选并关闭';
    this._chunks = [];
    this._applied = {};
  }

  willUpdate(changed) {
    if (changed.has('original') || changed.has('proposed')) {
      this._chunks = diffChunks(this.original, this.proposed);
      this._applied = {};
      this._chunks.forEach((c, i) => {
        if (c.type === 'changed') this._applied[i] = true;
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
    const applyCount = this._chunks.filter((c, i) => c.type === 'changed' && this._applied[i]).length;
    return html`
      <div class="toolbar">
        <span class="title">${this.title}</span>
        <span class="stats">将应用 ${applyCount}/${stats.changedBlocks} 处修改（<span class="add">+${stats.added}</span> <span class="del">-${stats.removed}</span>）</span>
        <button @click=${() => this._setAll(false)}>全部用原文</button>
        <button @click=${() => this._setAll(true)}>全部用修改</button>
        <button class="primary" @click=${this._accept}>${this.acceptLabel}</button>
        <button @click=${this._reject}>取消</button>
      </div>
      <div class="body">
        <div class="col-h">${this.leftLabel}</div>
        <div class="col-h gutter-h">采用</div>
        <div class="col-h">${this.rightLabel}</div>
        ${this._chunks.map((c, i) => this._renderChunk(c, i))}
      </div>
    `;
  }

  _renderChunk(c, i) {
    const EMPTY = ' ';
    if (c.type === 'equal') {
      return html`
        <div class="cell equal">${c.lines.map((l) => html`<div>${l || EMPTY}</div>`)}</div>
        <div class="gutter"></div>
        <div class="cell equal">${c.lines.map((l) => html`<div>${l || EMPTY}</div>`)}</div>
      `;
    }
    const applied = this._applied[i];
    return html`
      <div class="cell changed a ${applied ? 'will-remove' : 'kept'}">
        ${c.aLines.length
          ? c.aLines.map((l) => html`<div>${l || EMPTY}</div>`)
          : html`<div class="muted">（无）</div>`}
      </div>
      <div class="gutter">
        <button
          class="gutter-btn ${applied ? 'on' : 'off'}"
          @click=${() => this._toggle(i)}
          title=${applied ? '已采用，点击撤销（保留原文）' : '采用此修改'}
          aria-label=${applied ? '撤销，保留原文' : '采用此修改'}
          aria-pressed=${applied ? 'true' : 'false'}
        >${applied ? '✓' : '+'}</button>
      </div>
      <div class="cell changed b ${applied ? 'will-apply' : 'rejected'}">
        ${c.bLines.length
          ? c.bLines.map((l) => html`<div>${l || EMPTY}</div>`)
          : html`<div class="muted">（无）</div>`}
      </div>
    `;
  }
}

customElements.define('ai-diff-view', AiDiffView);
