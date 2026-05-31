import { LitElement, html, css } from 'lit';
import { loadAiConfig, saveAiConfig, testAiConnection } from '../services/ai-service.js';
import { saveEditorConfig, loadEditorConfig, savePdfConfig, loadPdfConfig } from '../services/config-service.js';
import { eventBus } from '../services/event-bus.js';
import { t, setLanguage, getLanguage } from '../services/i18n.js';
import { shortcutRegistry } from '../services/shortcut-registry.js';

class SettingsDialog extends LitElement {
  static properties = {
    visible: { type: Boolean },
    activeTab: { type: String },
    // AI
    endpoint: { type: String },
    apiKey: { type: String },
    model: { type: String },
    maxTokens: { type: Number },
    temperature: { type: Number },
    testStatus: { type: String },
    testStatusType: { type: String },
    // 外观
    theme: { type: String },
    language: { type: String },
    // 编辑器
    fontSize: { type: Number },
    tabSize: { type: Number },
    wordWrap: { type: Boolean },
    autoSaveInterval: { type: Number },
    // PDF
    commandPath: { type: String },
    outputDir: { type: String },
    outputNaming: { type: String },
    enableDiagram: { type: Boolean },
    extraArgs: { type: String },
    pdfTheme: { type: String },
    pageSize: { type: String },
    fontsDir: { type: String },
    footerCenter: { type: String },
    coverImage: { type: String },
  };

  static styles = css`
    :host {
      display: none;
    }
    :host(.visible) {
      display: flex;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(2px);
      z-index: 200;
      align-items: center;
      justify-content: center;
    }
    .dialog {
      background: var(--bg-3);
      border-radius: 12px;
      border: 1px solid var(--border-medium);
      width: 540px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 32px rgba(0,0,0,0.24);
      overflow: hidden;
    }
    .header {
      display: flex;
      align-items: center;
      padding: 14px 20px;
      background: var(--bg-2);
      border-bottom: 1px solid var(--border-subtle);
      font-weight: 600;
      font-family: var(--font-display);
      font-size: 14px;
      color: var(--text-1);
      gap: 8px;
    }
    .header .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
    }
    .header .close {
      margin-left: auto;
      cursor: pointer;
      opacity: 0.5;
      color: var(--text-3);
      font-size: 16px;
    }
    .header .close:hover { opacity: 1; color: var(--text-1); }
    .dialog-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .nav {
      width: 140px;
      background: var(--bg-2);
      border-right: 1px solid var(--border-subtle);
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex-shrink: 0;
    }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: var(--text-2);
      cursor: pointer;
      font-size: 12px;
      text-align: left;
      transition: all 0.15s;
      width: 100%;
    }
    .nav-item:hover {
      background: var(--border-subtle);
      color: var(--text-1);
    }
    .nav-item.active {
      background: var(--accent);
      color: #fff;
      font-weight: 500;
    }
    .nav-item .nav-icon {
      font-size: 14px;
      opacity: 0.8;
    }
    .content {
      flex: 1;
      background: var(--bg-1);
      padding: 20px;
      overflow-y: auto;
    }
    .field {
      margin-bottom: 14px;
    }
    .field label {
      display: block;
      font-size: 12px;
      color: var(--text-2);
      margin-bottom: 4px;
    }
    .field input, .field select {
      width: 100%;
      padding: 6px 10px;
      border: 1px solid var(--border-medium);
      border-radius: 6px;
      background: var(--bg-3);
      color: var(--text-1);
      font-size: 13px;
      box-sizing: border-box;
    }
    .field input:focus, .field select:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .field .hint {
      font-size: 11px;
      color: var(--text-3);
      margin-top: 2px;
    }
    .field-row {
      display: flex;
      gap: 12px;
    }
    .field-row .field {
      flex: 1;
    }
    .field input[type="checkbox"] {
      width: auto;
      margin-right: 6px;
    }
    .checkbox-label {
      display: flex;
      align-items: center;
      font-size: 13px;
      color: var(--text-1);
      cursor: pointer;
    }
    .footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 20px;
      background: var(--bg-2);
      border-top: 1px solid var(--border-subtle);
    }
    button.cancel-btn {
      padding: 6px 16px;
      border-radius: 6px;
      border: 1px solid var(--border-medium);
      background: transparent;
      color: var(--text-2);
      cursor: pointer;
      font-size: 12px;
      transition: all 0.15s;
    }
    button.cancel-btn:hover { background: var(--bg-3); color: var(--text-1); }
    button.primary {
      padding: 6px 16px;
      border-radius: 6px;
      border: none;
      background: var(--accent);
      color: white;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: background 0.15s;
    }
    button.primary:hover { background: var(--accent-hover); }
    button.test-btn {
      padding: 6px 14px;
      border-radius: 6px;
      border: 1px solid var(--border-medium);
      background: var(--bg-3);
      color: var(--text-2);
      cursor: pointer;
      font-size: 12px;
      transition: all 0.15s;
    }
    button.test-btn:hover { background: var(--border-subtle); color: var(--text-1); }
    .test-status {
      font-size: 11px;
      margin-top: 4px;
    }
    .test-status.ok { color: var(--color-success); }
    .test-status.fail { color: var(--color-error); }
    /* 快捷键列表 */
    .shortcut-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .shortcut-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 6px;
    }
    .shortcut-row:hover {
      background: var(--bg-3);
    }
    .shortcut-row .sc-label {
      flex: 1;
      font-size: 12px;
      color: var(--text-1);
    }
    .shortcut-row input.sc-input {
      width: 120px;
      padding: 3px 8px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: var(--bg-3);
      color: var(--text-1);
      font-size: 12px;
      font-family: var(--font-mono);
      text-align: center;
      cursor: pointer;
    }
    .shortcut-row input.sc-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .shortcut-row input.sc-input.recording {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }
    .shortcut-row .sc-conflict {
      font-size: 10px;
      color: var(--color-error);
      white-space: nowrap;
    }
    .shortcut-row button.sc-reset {
      padding: 2px 6px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: transparent;
      color: var(--text-3);
      font-size: 10px;
      cursor: pointer;
    }
    .shortcut-row button.sc-reset:hover {
      color: var(--text-1);
      border-color: var(--border-subtle);
    }
    .shortcut-row button.sc-reset.has-custom {
      border-color: var(--accent);
      color: var(--accent);
    }
    .shortcut-row button.sc-reset.has-custom:hover {
      background: var(--accent);
      color: #fff;
    }
    .shortcut-row button.sc-reset:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .shortcut-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .shortcut-header .hint {
      font-size: 11px;
      color: var(--text-3);
    }
    button.reset-all-btn {
      padding: 4px 10px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: transparent;
      color: var(--text-2);
      font-size: 11px;
      cursor: pointer;
    }
    button.reset-all-btn:hover { background: var(--bg-3); color: var(--text-1); }
  `;

  constructor() {
    super();
    this.visible = false;
    this.activeTab = 'editor';
    // AI 默认值
    this.endpoint = 'https://api.openai.com';
    this.apiKey = '';
    this.model = 'gpt-4o';
    this.maxTokens = 2048;
    this.temperature = 0.7;
    this.testStatus = '';
    this.testStatusType = '';
    // 外观
    this.theme = 'light';
    this.language = 'zh';
    // 编辑器默认值
    this.fontSize = 14;
    this.tabSize = 4;
    this.wordWrap = false;
    this.autoSaveInterval = 3;
    // PDF 默认值
    this.commandPath = 'asciidoctor-pdf';
    this.outputDir = '';
    this.outputNaming = 'title';
    this.enableDiagram = false;
    this.extraArgs = '';
    this.pdfTheme = '';
    this.pageSize = '';
    this.fontsDir = '';
    this.footerCenter = '';
    this.coverImage = '';
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

  async show() {
    this.visible = true;
    this.classList.add('visible');
    this.activeTab = 'editor';
    this._loadAll();
  }

  async _loadAll() {
    try {
      const ai = await loadAiConfig();
      this.endpoint = ai.endpoint;
      this.apiKey = ai.api_key;
      this.model = ai.model;
      this.maxTokens = ai.max_tokens;
      this.temperature = ai.temperature;
    } catch (_) {}

    try {
      const ed = await loadEditorConfig();
      this.fontSize = ed.font_size || 14;
      this.tabSize = ed.tab_size || 4;
      this.theme = ed.theme || 'light';
      this.wordWrap = ed.word_wrap || false;
      this.autoSaveInterval = ed.auto_save_interval || 3;
      this.language = ed.language || 'zh';
    } catch (_) {}

    try {
      const pdf = await loadPdfConfig();
      this.commandPath = pdf.command_path || 'asciidoctor-pdf';
      this.outputDir = pdf.output_dir || '';
      this.outputNaming = pdf.output_naming || 'title';
      this.enableDiagram = pdf.enable_diagram || false;
      this.extraArgs = pdf.extra_args || '';
      this.pdfTheme = pdf.theme || '';
      this.pageSize = pdf.page_size || '';
      this.fontsDir = pdf.fonts_dir || '';
      this.footerCenter = pdf.footer_center || '';
      this.coverImage = pdf.cover_image || '';
    } catch (_) {}
  }

  _hide() {
    this.visible = false;
    this.classList.remove('visible');
  }

  async _save() {
    // 保存 AI 配置
    try {
      await saveAiConfig({
        endpoint: this.endpoint,
        api_key: this.apiKey,
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      });
    } catch (e) {
      console.error('保存AI配置失败:', e);
    }

    // 保存编辑器配置（含语言）
    try {
      await saveEditorConfig({
        font_size: this.fontSize,
        tab_size: this.tabSize,
        theme: this.theme,
        word_wrap: this.wordWrap,
        auto_save_interval: this.autoSaveInterval,
        language: this.language,
      });
      // 立即应用编辑器配置
      eventBus.emit('font-size-set', this.fontSize);
      eventBus.emit('set-word-wrap', this.wordWrap);
      // 应用语言
      if (this.language !== getLanguage()) {
        await setLanguage(this.language);
        eventBus.emit('language-changed', this.language);
      }
    } catch (e) {
      console.error('保存编辑器配置失败:', e);
    }

    // 保存 PDF 配置
    try {
      await savePdfConfig({
        command_path: this.commandPath,
        output_dir: this.outputDir,
        output_naming: this.outputNaming,
        enable_diagram: this.enableDiagram,
        extra_args: this.extraArgs,
        theme: this.pdfTheme,
        page_size: this.pageSize,
        fonts_dir: this.fontsDir,
        footer_center: this.footerCenter,
        cover_image: this.coverImage,
      });
    } catch (e) {
      console.error('保存PDF配置失败:', e);
    }

    this._hide();
  }

  async _testConnection() {
    this.testStatus = t('settings.ai.testOk').replace('成功', '...').replace('successful', '...');
    this.testStatusType = '';
    this.requestUpdate();
    try {
      const ok = await testAiConnection();
      this.testStatus = ok ? t('settings.ai.testOk') : t('settings.ai.testFail');
      this.testStatusType = ok ? 'ok' : 'fail';
    } catch (e) {
      this.testStatus = `${t('settings.ai.testFail')}: ${e}`;
      this.testStatusType = 'fail';
    }
    this.requestUpdate();
  }

  _changeTheme(e) {
    this.theme = e.target.value;
    eventBus.emit('theme-changed', this.theme);
  }

  _changeLanguage(e) {
    this.language = e.target.value;
  }

  _switchTab(tab) {
    this.activeTab = tab;
  }

  render() {
    return html`
      <div class="dialog">
        <div class="header">
          <span class="dot"></span>
          ${t('settings.title')}
          <span class="close" @click=${this._hide}>✕</span>
        </div>
        <div class="dialog-body">
          <div class="nav">
            <button class="nav-item ${this.activeTab === 'editor' ? 'active' : ''}" @click=${() => this._switchTab('editor')}>
              <span class="nav-icon">📝</span> ${t('settings.tab.editor')}
            </button>
            <button class="nav-item ${this.activeTab === 'appearance' ? 'active' : ''}" @click=${() => this._switchTab('appearance')}>
              <span class="nav-icon">🎨</span> ${t('settings.tab.appearance')}
            </button>
            <button class="nav-item ${this.activeTab === 'ai' ? 'active' : ''}" @click=${() => this._switchTab('ai')}>
              <span class="nav-icon">🤖</span> ${t('settings.tab.ai')}
            </button>
            <button class="nav-item ${this.activeTab === 'pdf' ? 'active' : ''}" @click=${() => this._switchTab('pdf')}>
              <span class="nav-icon">📄</span> ${t('settings.tab.export')}
            </button>
            <button class="nav-item ${this.activeTab === 'shortcuts' ? 'active' : ''}" @click=${() => this._switchTab('shortcuts')}>
              <span class="nav-icon">⌨</span> ${t('settings.tab.shortcuts')}
            </button>
          </div>
          <div class="content">
            ${this.activeTab === 'editor' ? this._renderEditorTab() : ''}
            ${this.activeTab === 'appearance' ? this._renderAppearanceTab() : ''}
            ${this.activeTab === 'ai' ? this._renderAiTab() : ''}
            ${this.activeTab === 'pdf' ? this._renderPdfTab() : ''}
            ${this.activeTab === 'shortcuts' ? this._renderShortcutsTab() : ''}
          </div>
        </div>
        <div class="footer">
          <button class="cancel-btn" @click=${this._hide}>${t('settings.cancel')}</button>
          <button class="primary" @click=${this._save}>${t('settings.save')}</button>
        </div>
      </div>
    `;
  }

  _renderAiTab() {
    return html`
      <div class="field">
        <label>${t('settings.ai.endpoint')}</label>
        <input type="text" .value=${this.endpoint} @input=${(e) => this.endpoint = e.target.value} />
        <div class="hint">${t('settings.ai.endpointHint')}</div>
      </div>
      <div class="field">
        <label>${t('settings.ai.apiKey')}</label>
        <input type="password" .value=${this.apiKey} @input=${(e) => this.apiKey = e.target.value} />
      </div>
      <div class="field">
        <label>${t('settings.ai.model')}</label>
        <input type="text" .value=${this.model} @input=${(e) => this.model = e.target.value} />
      </div>
      <div class="field-row">
        <div class="field">
          <label>${t('settings.ai.maxTokens')}</label>
          <input type="number" .value=${this.maxTokens} @input=${(e) => this.maxTokens = parseInt(e.target.value)} />
        </div>
        <div class="field">
          <label>${t('settings.ai.temperature')}</label>
          <input type="number" step="0.1" min="0" max="2" .value=${this.temperature} @input=${(e) => this.temperature = parseFloat(e.target.value)} />
        </div>
      </div>
      <button class="test-btn" @click=${this._testConnection}>${t('settings.ai.testConnection')}</button>
      ${this.testStatus ? html`<div class="test-status ${this.testStatusType}">${this.testStatus}</div>` : ''}
    `;
  }

  _renderEditorTab() {
    return html`
      <div class="field-row">
        <div class="field">
          <label>${t('settings.editor.fontSize')}</label>
          <input type="number" min="10" max="32" .value=${this.fontSize} @input=${(e) => this.fontSize = parseInt(e.target.value)} />
        </div>
        <div class="field">
          <label>${t('settings.editor.tabSize')}</label>
          <input type="number" min="2" max="8" .value=${this.tabSize} @input=${(e) => this.tabSize = parseInt(e.target.value)} />
        </div>
      </div>
      <div class="field">
        <label>${t('settings.editor.autoSave')}</label>
        <input type="number" min="0" max="60" .value=${this.autoSaveInterval} @input=${(e) => this.autoSaveInterval = parseInt(e.target.value)} />
      </div>
      <div class="field">
        <label class="checkbox-label">
          <input type="checkbox" .checked=${this.wordWrap} @change=${(e) => this.wordWrap = e.target.checked} />
          ${t('settings.editor.wordWrap')}
        </label>
      </div>
    `;
  }

  _renderAppearanceTab() {
    return html`
      <div class="field">
        <label>${t('settings.appearance.theme')}</label>
        <select .value=${this.theme} @change=${this._changeTheme}>
          <option value="light">${t('settings.appearance.themeLight')}</option>
          <option value="dark">${t('settings.appearance.themeDark')}</option>
        </select>
      </div>
      <div class="field">
        <label>${t('settings.language')}</label>
        <select .value=${this.language} @change=${this._changeLanguage}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>
    `;
  }

  _renderPdfTab() {
    return html`
      <div class="field">
        <label>${t('settings.export.commandPath')}</label>
        <input type="text" .value=${this.commandPath} @input=${(e) => this.commandPath = e.target.value} />
        <div class="hint">${t('settings.export.commandPathHint')}</div>
      </div>
      <div class="field">
        <label>${t('settings.export.outputDir')}</label>
        <input type="text" .value=${this.outputDir} @input=${(e) => this.outputDir = e.target.value} placeholder="/path/to/output" />
      </div>
      <div class="field">
        <label>${t('settings.export.outputNaming')}</label>
        <select .value=${this.outputNaming} @change=${(e) => this.outputNaming = e.target.value}>
          <option value="title">${t('settings.export.outputNamingTitle')}</option>
          <option value="stem">${t('settings.export.outputNamingStem')}</option>
        </select>
        <div class="hint">${t('settings.export.outputNamingHint')}</div>
      </div>
      <div class="field">
        <label class="checkbox-label">
          <input type="checkbox" .checked=${this.enableDiagram} @change=${(e) => this.enableDiagram = e.target.checked} />
          ${t('settings.export.enableDiagram')}
        </label>
        <div class="hint">${t('settings.export.enableDiagramHint')}</div>
      </div>
      <div class="field">
        <label>${t('settings.export.extraArgs')}</label>
        <input type="text" .value=${this.extraArgs} @input=${(e) => this.extraArgs = e.target.value} placeholder="-a toc -a source-highlighter=rouge" />
        <div class="hint">${t('settings.export.extraArgsHint')}</div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>${t('settings.export.pdfTheme')}</label>
          <input type="text" .value=${this.pdfTheme} @input=${(e) => this.pdfTheme = e.target.value} placeholder="e.g. default-with-fallback-font" />
        </div>
        <div class="field">
          <label>${t('settings.export.pageSize')}</label>
          <input type="text" .value=${this.pageSize} @input=${(e) => this.pageSize = e.target.value} placeholder="A4" />
        </div>
      </div>
      <div class="field">
        <label>${t('settings.export.fontsDir')}</label>
        <input type="text" .value=${this.fontsDir} @input=${(e) => this.fontsDir = e.target.value} placeholder="/path/to/fonts" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>${t('settings.export.footerCenter')}</label>
          <input type="text" .value=${this.footerCenter} @input=${(e) => this.footerCenter = e.target.value} />
        </div>
        <div class="field">
          <label>${t('settings.export.coverImage')}</label>
          <input type="text" .value=${this.coverImage} @input=${(e) => this.coverImage = e.target.value} />
        </div>
      </div>
      <div class="hint" style="margin-top:8px;">${t('settings.export.adocPriorityHint')}</div>
    `;
  }

  _renderShortcutsTab() {
    const shortcuts = shortcutRegistry.getAll();
    return html`
      <div class="shortcut-header">
        <span class="hint">${t('settings.shortcuts.hint')}</span>
        <button class="reset-all-btn" @click=${this._resetAllShortcuts}>${t('settings.shortcuts.resetAll')}</button>
      </div>
      <div class="shortcut-list">
        ${shortcuts.map(sc => {
          const conflict = this._shortcutConflict(sc.id);
          return html`
          <div class="shortcut-row">
            <span class="sc-label">${sc.label}</span>
            ${conflict ? html`
              <span class="sc-conflict">${t('settings.shortcuts.conflict', { label: conflict.label })}</span>
            ` : ''}
            <input class="sc-input"
                   .value=${sc.shortcut}
                   data-sc-id=${sc.id}
                   placeholder="${sc.defaultShortcut}"
                   @focus=${this._startRecording}
                   @blur=${this._stopRecording}
                   @keydown=${this._captureKey} />
            <button class="sc-reset ${sc.isCustom ? 'has-custom' : ''}" @click=${() => this._resetShortcut(sc.id)} ?disabled=${!sc.isCustom}>${t('settings.shortcuts.reset')}</button>
          </div>
        `;
        })}
      </div>
    `;
  }

  _startRecording(e) {
    e.target.classList.add('recording');
    e.target.value = '';
  }

  _stopRecording(e) {
    const input = e.target;
    input.classList.remove('recording');
    const id = input.dataset.scId;
    if (!input.value.trim()) {
      // 恢复当前值
      input.value = shortcutRegistry.getShortcut(id);
    }
  }

  _captureKey(e) {
    e.preventDefault();
    e.stopPropagation();
    const input = e.target;
    const id = input.dataset.scId;

    // Escape 取消录制
    if (e.key === 'Escape') {
      input.value = shortcutRegistry.getShortcut(id);
      input.blur();
      return;
    }

    // Backspace/Delete 清除快捷键
    if (e.key === 'Backspace' || e.key === 'Delete') {
      shortcutRegistry.setShortcut(id, '').catch(() => {});
      input.value = '';
      this.requestUpdate();
      return;
    }

    // 忽略单独修饰键
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    let key = e.key;
    if (key === ' ') key = 'Space';
    if (key.length === 1) key = key.toUpperCase();
    parts.push(key);

    const combo = parts.join('+');
    shortcutRegistry.setShortcut(id, combo).catch(() => {});
    input.value = combo;
    this.requestUpdate();
  }

  _shortcutConflict(id) {
    const keys = shortcutRegistry.getShortcut(id);
    if (!keys) return null;
    return shortcutRegistry.findConflict(keys, id);
  }

  _resetShortcut(id) {
    shortcutRegistry.reset(id).then(() => this.requestUpdate());
  }

  _resetAllShortcuts() {
    shortcutRegistry.resetAll().then(() => this.requestUpdate());
  }
}

customElements.define('settings-dialog', SettingsDialog);
