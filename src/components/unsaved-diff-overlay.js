import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { editorState } from '../services/editor-state.js';
import { readFile } from '../services/file-service.js';
import { t } from '../services/i18n.js';
import './ai-diff-view.js';

/**
 * 未保存修改的全屏 diff 对比 overlay。
 *
 * 复用 ai-diff-view：左侧「磁盘已保存版本」、右侧「编辑区当前内容」。三个入口
 * （tab 右键 / 关闭未保存确认框 / 状态栏 ●）都 emit `show-unsaved-diff(path)` 触发。
 * 应用 = 按逐块选择拼接结果写回编辑区（整篇替换），保持 dirty，用户再 Ctrl+S 保存。
 */
class UnsavedDiffOverlay extends LitElement {
  static properties = {
    visible: { type: Boolean },
  };

  static styles = css`
    :host { display: none; }
    :host(.visible) {
      display: flex;
      flex-direction: column;
      position: fixed;
      inset: 0;
      z-index: 300;
      background: var(--bg-1);
    }
    ai-diff-view { flex: 1; }
  `;

  constructor() {
    super();
    this.visible = false;
    this._path = '';
    this._original = '';
    this._proposed = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._showHandler = (path) => this._show(path);
    this._closeHandler = () => this._close();
    eventBus.on('show-unsaved-diff', this._showHandler);
    eventBus.on('close-unsaved-diff', this._closeHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._showHandler) eventBus.off('show-unsaved-diff', this._showHandler);
    if (this._closeHandler) eventBus.off('close-unsaved-diff', this._closeHandler);
  }

  async _show(path) {
    if (!path || path.startsWith('__untitled_')) {
      // 无磁盘版本可对比：通知关闭流程继续，避免 _resolveUnsaved 等待挂起
      eventBus.emit('unsaved-diff-closed');
      return;
    }
    this._path = path;
    // 对比与「应用」都需作用于目标 tab：非激活时先切过去，
    // 这样 getDocumentContent() 与 ai-insert-text 才指向正确文件。
    // 副作用：对比结束后激活 tab 停留在该文件（不恢复原激活）——符合「对比即要看的文件」预期。
    if (editorState.activeFilePath !== path) {
      const file = editorState.getFile(path);
      if (file) {
        editorState.setActiveFile(path);
        eventBus.emit('file-opened', { path, content: file.content });
      }
    }
    try {
      this._original = await readFile(path);
    } catch (e) {
      console.error('读取磁盘文件失败:', e);
      this._original = '';
    }
    const editor = document.querySelector('app-shell')?.shadowRoot?.querySelector('editor-pane');
    this._proposed = editor?.getDocumentContent?.() || '';
    this.visible = true;
    this.classList.add('visible');
    this.requestUpdate();
  }

  _accept(text) {
    // 写回编辑区（整篇替换），保持 dirty，用户再 Ctrl+S 保存。
    // range.to 用 _proposed.length（_show 时的编辑区快照）而非实时读取：overlay 是全屏 modal
    // （z-index:300）期间编辑区不可被外部改动，二者等价；用快照避免与 ai-diff-view 逐块选择态竞态。
    eventBus.emit('ai-insert-text', { text, range: { from: 0, to: this._proposed.length } });
    this._close();
  }

  _close() {
    this.visible = false;
    this.classList.remove('visible');
    this.requestUpdate();
    // 通知关闭流程（_resolveUnsaved 串行等待）继续
    eventBus.emit('unsaved-diff-closed');
  }

  render() {
    if (!this.visible) return html``;
    return html`
      <ai-diff-view
        title=${t('diff.unsaved.title')}
        leftLabel=${t('diff.unsaved.left')}
        rightLabel=${t('diff.unsaved.right')}
        .original=${this._original}
        .proposed=${this._proposed}
        @accept=${(e) => this._accept(e.detail.text)}
        @reject=${() => this._close()}
      ></ai-diff-view>
    `;
  }
}

customElements.define('unsaved-diff-overlay', UnsavedDiffOverlay);
