import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { saveCustomAiScenes } from '../services/config-service.js';
import { showConfirm } from '../services/dialog.js';
import { t } from '../services/i18n.js';
import { activateOnKey } from '../services/a11y.js';

/**
 * 自定义 AI 场景管理（全屏 overlay，参照 ai-panel 的 diff-overlay 模式）。
 * 内联编辑（参照 settings-dialog 的 snippet 卡片）；点「完成」时持久化并广播 ai-scenes-changed。
 * 删除走 showConfirm；behavior 第一版不暴露 UI，默认 rewrite。
 */
class AiSceneManager extends LitElement {
  static properties = {
    scenes: { type: Array },
  };

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 300;
      background: var(--bg-1);
      display: flex;
      flex-direction: column;
    }
    .mgr-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      font-weight: 600;
      font-family: var(--font-display);
      font-size: 13px;
      color: var(--text-1);
    }
    .mgr-header .close {
      margin-left: auto;
      cursor: pointer;
      opacity: 0.85;
      font-size: 16px;
      color: var(--text-2);
      transition: opacity 0.15s, color 0.15s, background 0.15s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 4px;
    }
    .mgr-header .close:hover { opacity: 1; color: var(--text-1); background: var(--bg-3); }
    .mgr-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .mgr-toolbar .hint {
      font-size: 11px;
      color: var(--text-3);
      line-height: 1.4;
    }
    .add-btn {
      margin-left: auto;
      padding: 4px 10px;
      border: 1px solid var(--accent);
      border-radius: 4px;
      background: var(--accent);
      color: white;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
    }
    .add-btn:hover { background: var(--accent-hover); }
    .mgr-body {
      flex: 1;
      overflow-y: auto;
      padding: 10px 14px;
    }
    .scene-card {
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 10px;
      background: var(--bg-3);
    }
    .scene-top {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }
    .icon-input {
      width: 36px;
      padding: 6px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: var(--bg-2);
      color: var(--text-1);
      font-size: 13px;
      text-align: center;
    }
    .name-input {
      flex: 1;
      min-width: 0;
      padding: 6px 8px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: var(--bg-2);
      color: var(--text-1);
      font-size: 12px;
    }
    .icon-input:focus, .name-input:focus { outline: none; border-color: var(--accent); }
    .del-btn {
      padding: 6px 9px;
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      background: var(--bg-2);
      color: var(--text-3);
      cursor: pointer;
      font-size: 12px;
    }
    .del-btn:hover { color: var(--text-1); }
    .scene-prompt {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: var(--bg-2);
      color: var(--text-1);
      font-size: 12px;
      resize: vertical;
      min-height: 64px;
      font-family: var(--font-sans);
    }
    .scene-prompt:focus { outline: none; border-color: var(--accent); }
    .empty {
      text-align: center;
      color: var(--text-3);
      padding: 40px 0;
      font-size: 12px;
      line-height: 1.6;
    }
    .mgr-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 14px;
      border-top: 1px solid var(--border-subtle);
    }
    .done-btn {
      padding: 6px 18px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .done-btn:hover { background: var(--accent-hover); }
  `;

  constructor() {
    super();
    this.scenes = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this._langHandler = () => this.requestUpdate();
    eventBus.on('language-changed', this._langHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
  }

  _addScene() {
    const id = 'scene_' + Date.now();
    this.scenes = [...this.scenes, { id, name: '', icon: '✦', systemPrompt: '', behavior: 'rewrite' }];
  }

  _updateScene(index, updated) {
    const copy = [...this.scenes];
    copy[index] = updated;
    this.scenes = copy;
  }

  async _deleteScene(index) {
    const scene = this.scenes[index];
    const name = (scene?.name || '').trim() || t('ai.scene.title');
    const ok = await showConfirm(t('ai.scene.confirmDelete', { name }));
    if (!ok) return;
    this.scenes = this.scenes.filter((_, i) => i !== index);
  }

  async _done() {
    // 过滤空场景（无名称或无提示词），规范化字段
    const cleaned = this.scenes
      .filter((s) => (s.name || '').trim() && (s.systemPrompt || '').trim())
      .map((s) => ({
        id: s.id,
        name: s.name.trim(),
        icon: (s.icon || '').trim() || '✦',
        systemPrompt: s.systemPrompt.trim(),
        behavior: s.behavior === 'generate' ? 'generate' : 'rewrite',
      }));
    try {
      await saveCustomAiScenes(cleaned);
    } catch (e) {
      console.error('保存自定义场景失败', e);
    }
    eventBus.emit('ai-scenes-changed', cleaned);
    this._close();
  }

  _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <div class="mgr-header">
        <span>⚙ ${t('ai.scene.title')}</span>
        <span class="close" role="button" tabindex="0" title="${t('dialog.close')}" @keydown=${activateOnKey} @click=${this._close}>✕</span>
      </div>
      <div class="mgr-toolbar">
        <span class="hint">${t('ai.scene.promptHint')}</span>
        <button class="add-btn" @click=${this._addScene}>${t('ai.scene.add')}</button>
      </div>
      <div class="mgr-body">
        ${this.scenes.length === 0
          ? html`<div class="empty">${t('ai.scene.empty')}</div>`
          : this.scenes.map((s, i) => html`
            <div class="scene-card">
              <div class="scene-top">
                <input class="icon-input"
                       .value=${s.icon || ''}
                       placeholder="✦"
                       title="${t('ai.scene.icon')}"
                       @input=${(e) => this._updateScene(i, { ...s, icon: e.target.value })} />
                <input class="name-input"
                       .value=${s.name || ''}
                       placeholder="${t('ai.scene.name')}"
                       @input=${(e) => this._updateScene(i, { ...s, name: e.target.value })} />
                <button class="del-btn" @click=${() => this._deleteScene(i)} title="${t('ai.scene.delete')}">✕</button>
              </div>
              <textarea class="scene-prompt"
                        .value=${s.systemPrompt || ''}
                        placeholder="${t('ai.scene.prompt')}"
                        @input=${(e) => this._updateScene(i, { ...s, systemPrompt: e.target.value })}></textarea>
            </div>
          `)
        }
      </div>
      <div class="mgr-footer">
        <button class="done-btn" @click=${this._done}>${t('ai.scene.done')}</button>
      </div>
    `;
  }
}

customElements.define('ai-scene-manager', AiSceneManager);
