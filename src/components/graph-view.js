import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { editorState } from '../services/editor-state.js';
import { forceLayout } from '../services/graph-layout.js';
import { t } from '../services/i18n.js';

class GraphView extends LitElement {
  static properties = {
    visible: { type: Boolean },
    filter: { type: String },
  };

  static styles = css`
    :host {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: var(--bg-1);
      z-index: 300;
      display: none;
      flex-direction: column;
    }
    :host(.visible) {
      display: flex;
    }
    .toolbar {
      display: flex;
      align-items: center;
      padding: 8px 16px;
      gap: 12px;
      background: var(--bg-2);
      border-bottom: 1px solid var(--border-subtle);
      font-size: 13px;
      color: var(--text-1);
    }
    .toolbar .title {
      font-weight: 600;
      font-family: var(--font-display);
    }
    .toolbar input {
      padding: 4px 10px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: var(--bg-3);
      color: var(--text-1);
      font-size: 12px;
      width: 200px;
    }
    .toolbar input:focus { outline: none; border-color: var(--accent); }
    .toolbar .close {
      margin-left: auto;
      cursor: pointer;
      opacity: 0.5;
      color: var(--text-3);
      font-size: 18px;
    }
    .toolbar .close:hover { opacity: 1; color: var(--text-1); }
    canvas {
      flex: 1;
      cursor: grab;
    }
    canvas:active { cursor: grabbing; }
  `;

  constructor() {
    super();
    this.visible = false;
    this.filter = '';
    this._positions = new Map();
    this._nodes = [];
    this._edges = [];
    this._nodeMap = new Map(); // id → node（用于过滤查找）
    this._pan = { x: 0, y: 0 };
    this._zoom = 1;
    this._dragging = false;
    this._dragStart = { x: 0, y: 0 };
    this._rafId = null;
    this._labelColor = '#666'; // 缓存标签颜色
  }

  connectedCallback() {
    super.connectedCallback();
    this._toggleHandler = async () => {
      const willOpen = !this.visible;
      if (willOpen) eventBus.emit('force-close-all-panels');
      this.visible = willOpen;
      this.classList.toggle('visible', this.visible);
      eventBus.emit('graph-panel-toggled', this.visible);
      if (this.visible) {
        await this._buildGraph();
        this.updateComplete.then(() => this._draw());
      }
    };
    eventBus.on('toggle-graph-view', this._toggleHandler);
    this._forceCloseHandler = () => {
      if (!this.visible) return;
      this.visible = false;
      this.classList.remove('visible');
      eventBus.emit('graph-panel-toggled', false);
    };
    eventBus.on('force-close-all-panels', this._forceCloseHandler);
  }

  async _buildGraph() {
    try {
      const { linkIndex } = await import('../services/link-index.js');
      // 确保索引已就绪
      if (linkIndex.ready) await linkIndex.ready;
      const data = await linkIndex.getGraphData();
      this._nodes = data.nodes;
      this._edges = data.edges;
      this._nodeMap = new Map(data.nodes.map(n => [n.id, n]));
      this._positions = forceLayout(this._nodes, this._edges, {
        width: window.innerWidth,
        height: window.innerHeight - 50,
      });
      // 缓存标签颜色，避免每帧 getComputedStyle
      const cs = getComputedStyle(document.documentElement);
      this._labelColor = cs.getPropertyValue('--text-2').trim() || '#666';
    } catch (_) {
      this._nodes = [];
      this._edges = [];
    }
  }

  _draw() {
    const canvas = this.shadowRoot.querySelector('canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);

    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const filterLower = this.filter.toLowerCase();

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(this._pan.x, this._pan.y);
    ctx.scale(this._zoom, this._zoom);

    // 最大连接数（用于颜色映射）
    let maxLinks = 1;
    for (const n of this._nodes) { if (n.links > maxLinks) maxLinks = n.links; }

    // 预计算匹配过滤的节点 ID 集合
    const matchSet = new Set();
    if (filterLower) {
      for (const node of this._nodes) {
        if (node.label.toLowerCase().includes(filterLower) || node.id.toLowerCase().includes(filterLower)) {
          matchSet.add(node.id);
        }
      }
      // 加入匹配节点的直接邻居
      for (const e of this._edges) {
        if (matchSet.has(e.source)) matchSet.add(e.target);
        if (matchSet.has(e.target)) matchSet.add(e.source);
      }
    }

    // 绘制边
    ctx.strokeStyle = 'rgba(150, 150, 150, 0.3)';
    ctx.lineWidth = 1;
    for (const e of this._edges) {
      if (filterLower && !matchSet.has(e.source) && !matchSet.has(e.target)) continue;
      const a = this._positions.get(e.source);
      const b = this._positions.get(e.target);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // 绘制节点
    const labelColor = this._labelColor;
    for (const node of this._nodes) {
      if (filterLower && !matchSet.has(node.id)) continue;
      const pos = this._positions.get(node.id);
      if (!pos) continue;

      const ratio = node.links / maxLinks;
      const radius = 4 + ratio * 10;

      // 冷暖色渐变：少链接=蓝灰，多链接=锻造金
      const r = Math.round(80 + ratio * 140);
      const g = Math.round(100 + ratio * 40);
      const b = Math.round(140 - ratio * 80);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();

      // 标签（使用缓存颜色）
      ctx.fillStyle = labelColor;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, pos.x, pos.y + radius + 12);
    }

    ctx.restore();
  }

  _onMouseDown(e) {
    this._dragging = true;
    this._dragStart = { x: e.clientX - this._pan.x, y: e.clientY - this._pan.y };
  }

  _onMouseMove(e) {
    if (!this._dragging) return;
    this._pan.x = e.clientX - this._dragStart.x;
    this._pan.y = e.clientY - this._dragStart.y;
    if (!this._rafId) {
      this._rafId = requestAnimationFrame(() => {
        this._draw();
        this._rafId = null;
      });
    }
  }

  _onMouseUp() {
    this._dragging = false;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._toggleHandler) eventBus.off('toggle-graph-view', this._toggleHandler);
    if (this._forceCloseHandler) eventBus.off('force-close-all-panels', this._forceCloseHandler);
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  _onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    this._zoom = Math.max(0.2, Math.min(3, this._zoom * delta));
    this._draw();
  }

  _onCanvasClick(e) {
    // 点击节点打开文件
    const canvas = this.shadowRoot.querySelector('canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - this._pan.x) / this._zoom;
    const y = (e.clientY - rect.top - this._pan.y) / this._zoom;

    for (const node of this._nodes) {
      const pos = this._positions.get(node.id);
      if (!pos) continue;
      const dx = pos.x - x;
      const dy = pos.y - y;
      if (dx * dx + dy * dy < 225) { // 15px 半径
        (async () => {
          try {
            const { readFile } = await import('../services/file-service.js');
            const content = await readFile(node.id);
            editorState.openFile(node.id, content);
            eventBus.emit('file-opened', { path: node.id, content });
            this.visible = false;
            this.classList.remove('visible');
            eventBus.emit('graph-panel-toggled', false);
          } catch (_) {}
        })();
        return;
      }
    }
  }

  render() {
    return html`
      <div class="toolbar">
        <span class="title">🕸️ ${t('graph.title')}</span>
        <input
          type="text"
          placeholder="${t('graph.filterPlaceholder')}"
          .value=${this.filter}
          @input=${(e) => { this.filter = e.target.value; this._draw(); }}
        />
        <span style="color:var(--text-3);font-size:11px">${this._nodes.length} ${t('graph.nodeCount')} · ${this._edges.length} ${t('graph.edgeCount')}</span>
        <span class="close" @click=${() => { this.visible = false; this.classList.remove('visible'); eventBus.emit('graph-panel-toggled', false); }}>✕</span>
      </div>
      <canvas
        @mousedown=${this._onMouseDown}
        @mousemove=${this._mousemoveHandler || (this._mousemoveHandler = (e) => this._onMouseMove(e))}
        @mouseup=${this._onMouseUp}
        @mouseleave=${this._onMouseUp}
        @wheel=${this._onWheel}
        @click=${this._onCanvasClick}
      ></canvas>
    `;
  }
}

customElements.define('graph-view', GraphView);
