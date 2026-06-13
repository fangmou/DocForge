import { LitElement, html, css } from 'lit';
import { eventBus } from '../services/event-bus.js';
import { editorState } from '../services/editor-state.js';
import { t } from '../services/i18n.js';
import { listDirectory, readFile } from '../services/file-service.js';

// 内置模板
function getBuiltinTemplates() {
  const date = new Date().toISOString().slice(0, 10);
  return [
    { key: 'blank', label: t('template.blank'), content: '' },
    { key: 'article', label: t('template.article'), content: `= \n\nv1.0, ${date}\n:toc: auto\n\n== \n\n== \n\n== \n` },
    { key: 'blog', label: t('template.blog'), content: `= \n\n${date}\n:toc:\n\n== \n\n` },
    { key: 'meeting', label: t('template.meeting'), content: `= ${t('template.meetingTitle')}\n:date: ${date}\n:attendees: \n\n== ${t('template.agenda')}\n\n== ${t('template.decisions')}\n\n== ${t('template.actionItems')}\n` },
    { key: 'api', label: t('template.api'), content: `= API\n:toc: auto\n:source-highlighter: highlight.js\n\n== ${t('template.overview')}\n\n== ${t('template.endpoints')}\n\n=== GET /api/resource\n\n[source,http]\n----\nGET /api/resource\n----\n\n== ${t('template.errorCodes')}\n` },
  ];
}

class TemplatePanel extends LitElement {
  static properties = {
    visible: { type: Boolean },
    customTemplates: { type: Array },
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
      width: 220px;
      min-width: 220px;
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
      color: var(--text-3);
    }
    .header .close:hover { opacity: 1; color: var(--text-1); }
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }
    .section-title {
      padding: 8px 14px 4px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-3);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .template-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text-2);
      transition: all 0.1s;
    }
    .template-item:hover {
      background: var(--bg-3);
      color: var(--text-1);
    }
    .template-item .icon {
      font-size: 14px;
      flex-shrink: 0;
    }
    .template-item .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hint {
      padding: 12px 14px;
      border-top: 1px solid var(--border-subtle);
      font-size: 11px;
      color: var(--text-3);
      line-height: 1.5;
    }
    .empty {
      color: var(--text-3);
      text-align: center;
      padding: 16px 14px;
      font-size: 12px;
    }
  `;

  constructor() {
    super();
    this.visible = false;
    this.customTemplates = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this._toggleHandler = async () => {
      const willOpen = !this.visible;
      if (willOpen) eventBus.emit('force-close-all-panels');
      this.visible = willOpen;
      this.classList.toggle('visible', this.visible);
      eventBus.emit('template-panel-toggled', this.visible);
      if (this.visible) {
        await this._loadCustomTemplates();
        this.requestUpdate();
      }
    };
    eventBus.on('toggle-template-panel', this._toggleHandler);
    this._forceCloseHandler = () => {
      if (!this.visible && !this.classList.contains('visible')) return;
      this.visible = false;
      this.classList.remove('visible');
      eventBus.emit('template-panel-toggled', false);
    };
    eventBus.on('force-close-all-panels', this._forceCloseHandler);
    this._langHandler = () => this.requestUpdate();
    eventBus.on('language-changed', this._langHandler);
    this._wsHandler = () => {
      this.customTemplates = [];
    };
    eventBus.on('workspace-opened', this._wsHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._toggleHandler) eventBus.off('toggle-template-panel', this._toggleHandler);
    if (this._forceCloseHandler) eventBus.off('force-close-all-panels', this._forceCloseHandler);
    if (this._langHandler) eventBus.off('language-changed', this._langHandler);
    if (this._wsHandler) eventBus.off('workspace-opened', this._wsHandler);
  }

  async _loadCustomTemplates() {
    const wsRoot = editorState.workspaceRoot;
    if (!wsRoot) {
      this.customTemplates = [];
      return;
    }
    try {
      const templateDir = wsRoot + '/.docforge/templates';
      const entries = await listDirectory(templateDir);
      const files = (entries || []).filter(e => !e.is_dir && (e.name.endsWith('.adoc') || e.name.endsWith('.asciidoc') || e.name.endsWith('.txt')));
      const templates = [];
      for (const f of files) {
        try {
          const content = await readFile(f.path);
          templates.push({ name: f.name.replace(/\.(adoc|asciidoc|txt)$/, ''), content });
        } catch (_) {}
      }
      this.customTemplates = templates;
    } catch (_) {
      this.customTemplates = [];
    }
  }

  _useTemplate(content) {
    eventBus.emit('create-from-template', { content });
    this.visible = false;
    this.classList.remove('visible');
    eventBus.emit('template-panel-toggled', false);
  }

  render() {
    const builtins = getBuiltinTemplates();
    return html`
      <div class="header">
        <span>📋 ${t('template.panelTitle')}</span>
        <span class="close" @click=${() => { this.visible = false; this.classList.remove('visible'); eventBus.emit('template-panel-toggled', false); }}>✕</span>
      </div>
      <div class="content">
        <div class="section-title">${t('template.builtin')}</div>
        ${builtins.map(tpl => html`
          <div class="template-item" @click=${() => this._useTemplate(tpl.content)}>
            <span class="icon">📄</span>
            <span class="name">${tpl.label}</span>
          </div>
        `)}
        <div class="section-title">${t('template.custom')}</div>
        ${this.customTemplates.length === 0
          ? html`<div class="empty">${t('template.emptyCustom')}</div>`
          : this.customTemplates.map(tpl => html`
            <div class="template-item" @click=${() => this._useTemplate(tpl.content)}>
              <span class="icon">📝</span>
              <span class="name">${tpl.name}</span>
            </div>
          `)
        }
      </div>
      <div class="hint">${t('template.customHint')}</div>
    `;
  }
}

customElements.define('template-panel', TemplatePanel);
