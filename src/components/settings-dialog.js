import { LitElement, html, css } from 'lit';
import { loadAiConfig, saveAiConfig, testAiConnection } from '../services/ai-service.js';
import {
  saveEditorConfig, loadEditorConfig,
  loadExportConfig, saveExportConfig, savePandocConfig,
  loadAsciidocExportConfig, saveAsciidocExportConfig,
  savePdfConfig, loadPdfConfig,
  saveDocxConfig, loadDocxConfig,
  getDefaultExtraArgs, loadCustomSnippets, saveCustomSnippets,
} from '../services/config-service.js';
import { eventBus } from '../services/event-bus.js';
import { t, setLanguage, getLanguage } from '../services/i18n.js';
import { shortcutRegistry, keyFromEvent } from '../services/shortcut-registry.js';

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
    // 导出通用
    outputDir: { type: String },
    outputNaming: { type: String },
    outputDirResolved: { type: String },
    // 全局 pandoc
    pandocCommandPath: { type: String },
    pandocStatus: { type: String },
    pandocStatusType: { type: String },
    // AsciiDoc 引擎
    enableDiagram: { type: Boolean },
    extraArgs: { type: String },
    // PDF（仅 PDF 独有字段）
    commandPath: { type: String },
    pdfTheme: { type: String },
    pageSize: { type: String },
    fontsDir: { type: String },
    footerCenter: { type: String },
    coverImage: { type: String },
    titleLogoImage: { type: String },
    pageForegroundImage: { type: String },
    pdfStatus: { type: String },
    pdfStatusType: { type: String },
    // 路径解析提示
    fontsDirResolved: { type: String },
    coverImageResolved: { type: String },
    titleLogoImageResolved: { type: String },
    pageForegroundImageResolved: { type: String },
    // Word (docx)
    docxReferenceDoc: { type: String },
    docxReferenceDocResolved: { type: String },
    // 自定义标记
    customSnippets: { type: Array },
    // 树状导航展开状态
    _exportExpanded: { state: true },
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
      width: 720px;
      max-height: 85vh;
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
      width: 170px;
      background: var(--bg-2);
      border-right: 1px solid var(--border-subtle);
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex-shrink: 0;
      overflow-y: auto;
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
    /* 树状导航 section header */
    .nav-section {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: var(--text-1);
      cursor: pointer;
      font-size: 12px;
      text-align: left;
      width: 100%;
      font-weight: 600;
    }
    .nav-section:hover {
      background: var(--border-subtle);
    }
    .nav-section .toggle-icon {
      font-size: 10px;
      transition: transform 0.15s;
    }
    .nav-section .toggle-icon.collapsed {
      transform: rotate(-90deg);
    }
    .nav-child {
      padding-left: 12px;
    }
    .nav-children.collapsed {
      display: none;
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
    .aligned-label {
      margin-top: 20px;
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
    .field-reset-btn {
      padding: 3px 8px;
      border: 1px solid var(--accent);
      border-radius: 4px;
      background: transparent;
      color: var(--accent);
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .field-reset-btn:hover {
      background: var(--accent);
      color: #fff;
    }
    /* 自定义标记片段 */
    .snippet-card {
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 0;
      margin-bottom: 6px;
      overflow: hidden;
    }
    .snippet-top {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      background: var(--bg-3);
    }
    .snippet-top input.sn-name {
      flex: 1;
      min-width: 0;
      padding: 3px 8px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: var(--bg-1);
      color: var(--text-1);
      font-size: 12px;
    }
    .snippet-top input.sn-name:focus {
      outline: none;
      border-color: var(--accent);
    }
    .snippet-top select {
      padding: 3px 4px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: var(--bg-1);
      color: var(--text-1);
      font-size: 11px;
      flex-shrink: 0;
    }
    .snippet-top select:focus {
      outline: none;
      border-color: var(--accent);
    }
    .snippet-top input.sc-input {
      width: 90px;
      flex-shrink: 0;
    }
    .snippet-top button.sn-delete {
      padding: 2px 6px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-3);
      font-size: 14px;
      cursor: pointer;
      flex-shrink: 0;
      line-height: 1;
    }
    .snippet-top button.sn-delete:hover {
      color: var(--color-error);
      background: var(--bg-2);
    }
    .snippet-bottom textarea {
      width: 100%;
      padding: 6px 8px;
      border: none;
      border-top: 1px solid var(--border-subtle);
      background: var(--bg-1);
      color: var(--text-1);
      font-size: 12px;
      font-family: var(--font-mono);
      resize: vertical;
      min-height: 36px;
      box-sizing: border-box;
      display: block;
    }
    .snippet-bottom textarea:focus {
      outline: none;
    }
    .snippet-bottom textarea::placeholder {
      color: var(--text-3);
    }
  `;

  constructor() {
    super();
    this.visible = false;
    this.activeTab = 'editor';
    this._exportExpanded = true;
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
    // 导出通用
    this.outputDir = '';
    this.outputNaming = 'title';
    this.outputDirResolved = '';
    // 全局 pandoc
    this.pandocCommandPath = 'pandoc';
    this.pandocStatus = '';
    this.pandocStatusType = '';
    // AsciiDoc 引擎
    this.enableDiagram = false;
    this.extraArgs = '';
    this._defaultExtraArgs = '';
    // PDF（仅独有字段）
    this.commandPath = 'asciidoctor-pdf';
    this.pdfTheme = '';
    this.pageSize = '';
    this.fontsDir = '';
    this.footerCenter = '';
    this.coverImage = '';
    this.titleLogoImage = '';
    this.pageForegroundImage = '';
    this.pdfStatus = '';
    this.pdfStatusType = '';
    // 路径解析提示
    this.fontsDirResolved = '';
    this.coverImageResolved = '';
    this.titleLogoImageResolved = '';
    this.pageForegroundImageResolved = '';
    // Word (docx)
    this.docxReferenceDoc = '';
    this.docxReferenceDocResolved = '';
    this._resolveTimers = {};
    this._pandocResolved = '';
    this._pdfResolved = '';
    this.customSnippets = [];
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
    const [aiRes, edRes, exportRes, asciidocRes, pdfRes, snippetsRes, docxRes] = await Promise.allSettled([
      loadAiConfig(),
      loadEditorConfig(),
      loadExportConfig(),
      loadAsciidocExportConfig(),
      loadPdfConfig(),
      loadCustomSnippets(),
      loadDocxConfig(),
    ]);

    if (aiRes.status === 'fulfilled') {
      const ai = aiRes.value;
      this.endpoint = ai.endpoint;
      this.apiKey = ai.api_key;
      this.model = ai.model;
      this.maxTokens = ai.max_tokens;
      this.temperature = ai.temperature;
    }

    if (edRes.status === 'fulfilled') {
      const ed = edRes.value;
      this.fontSize = ed.font_size || 14;
      this.tabSize = ed.tab_size || 4;
      this.theme = ed.theme || 'light';
      this.wordWrap = ed.word_wrap || false;
      this.autoSaveInterval = ed.auto_save_interval ?? 3;
      this.language = ed.language || 'zh';
    }

    // 导出通用配置 + pandoc
    if (exportRes.status === 'fulfilled') {
      const ec = exportRes.value;
      this.outputDir = ec.output_dir || '';
      this.outputNaming = ec.output_naming || 'title';
      this.pandocCommandPath = (ec.pandoc && ec.pandoc.command_path) || 'pandoc';
      const pandocResolved = (ec.pandoc && ec.pandoc.command_resolved) || '';
      this._pandocResolved = pandocResolved;
      if (pandocResolved) {
        this.pandocStatus = pandocResolved.startsWith('wsl ')
          ? '✓ WSL ' + pandocResolved.substring(4)
          : '✓ ' + pandocResolved;
        this.pandocStatusType = 'ok';
      } else {
        this._detectPandocCommand();
      }
    }

    // AsciiDoc 引擎配置
    if (asciidocRes.status === 'fulfilled') {
      const ae = asciidocRes.value;
      this.enableDiagram = ae.enable_diagram || false;
      this.extraArgs = ae.extra_args || '';
    }

    // PDF 配置
    if (pdfRes.status === 'fulfilled') {
      const pdf = pdfRes.value;
      this.commandPath = pdf.command_path || 'asciidoctor-pdf';
      this.pdfTheme = pdf.theme || '';
      this.pageSize = pdf.page_size || '';
      this.fontsDir = pdf.fonts_dir || '';
      this.footerCenter = pdf.footer_center || '';
      this.coverImage = pdf.cover_image || '';
      this.titleLogoImage = pdf.title_logo_image || '';
      this.pageForegroundImage = pdf.page_foreground_image || '';
      // 恢复已缓存的检测状态
      const resolved = pdf.command_resolved || '';
      this._pdfResolved = resolved;
      if (resolved) {
        this.pdfStatus = resolved.startsWith('wsl ')
          ? '✓ WSL ' + resolved.substring(4)
          : '✓ ' + resolved;
        this.pdfStatusType = 'ok';
      } else {
        this._detectPdfCommand();
      }
    }

    if (snippetsRes.status === 'fulfilled') {
      this.customSnippets = snippetsRes.value || [];
    }

    if (docxRes.status === 'fulfilled') {
      this.docxReferenceDoc = docxRes.value.reference_doc || '';
    }

    // 获取默认参数（独立于任何配置加载结果）
    try {
      this._defaultExtraArgs = await getDefaultExtraArgs(this.language);
      if (!this.extraArgs) this.extraArgs = this._defaultExtraArgs;
    } catch (_) {}

    // 预解析路径（基于所有已加载的配置值）
    this._preResolvePaths();
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
      eventBus.emit('font-size-set', this.fontSize);
      eventBus.emit('set-word-wrap', this.wordWrap);
      if (this.language !== getLanguage()) {
        await setLanguage(this.language);
        eventBus.emit('language-changed', this.language);
      }
    } catch (e) {
      console.error('保存编辑器配置失败:', e);
    }

    // 保存导出通用配置
    try {
      await saveExportConfig(this.outputDir, this.outputNaming);
    } catch (e) {
      console.error('保存导出配置失败:', e);
    }

    // 保存 pandoc 配置
    try {
      await savePandocConfig({
        command_path: this.pandocCommandPath,
        command_resolved: this._pandocResolved || '',
      });
    } catch (e) {
      console.error('保存 pandoc 配置失败:', e);
    }

    // 保存 AsciiDoc 引擎配置
    try {
      await saveAsciidocExportConfig(this.enableDiagram, this.extraArgs);
    } catch (e) {
      console.error('保存 AsciiDoc 引擎配置失败:', e);
    }

    // 保存 PDF 配置（仅独有字段）
    try {
      await savePdfConfig({
        command_path: this.commandPath,
        command_resolved: this._pdfResolved || '',
        theme: this.pdfTheme,
        page_size: this.pageSize,
        fonts_dir: this.fontsDir,
        footer_center: this.footerCenter,
        cover_image: this.coverImage,
        title_logo_image: this.titleLogoImage,
        page_foreground_image: this.pageForegroundImage,
      });
    } catch (e) {
      console.error('保存PDF配置失败:', e);
    }

    // 保存 Word 配置（仅 reference_doc）
    try {
      await saveDocxConfig({
        reference_doc: this.docxReferenceDoc,
      });
    } catch (e) {
      console.error('保存Word配置失败:', e);
    }

    // 保存自定义标记片段
    try {
      await saveCustomSnippets(this.customSnippets);
    } catch (e) {
      console.error('保存自定义标记失败:', e);
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

  async _detectPdfCommand() {
    this.pdfStatus = '...';
    this.pdfStatusType = '';
    this.requestUpdate();
    try {
      const { detectPdfCommand } = await import('../services/export-service.js');
      const info = await detectPdfCommand();
      if (info.available) {
        this.pdfStatus = info.display;
        this.pdfStatusType = 'ok';
      } else {
        this.pdfStatus = info.display;
        this.pdfStatusType = 'fail';
      }
    } catch (e) {
      this.pdfStatus = `${t('settings.export.commandNotFound', { cmd: this.commandPath })}: ${e}`;
      this.pdfStatusType = 'fail';
    }
    this.requestUpdate();
  }

  async _detectPandocCommand() {
    this.pandocStatus = '...';
    this.pandocStatusType = '';
    this.requestUpdate();
    try {
      const { detectPandocCommand } = await import('../services/export-service.js');
      const info = await detectPandocCommand();
      if (info.available) {
        this.pandocStatus = info.display;
        this.pandocStatusType = 'ok';
      } else {
        this.pandocStatus = info.display;
        this.pandocStatusType = 'fail';
      }
    } catch (e) {
      this.pandocStatus = `${t('settings.export.commandNotFound', { cmd: this.pandocCommandPath })}: ${e}`;
      this.pandocStatusType = 'fail';
    }
    this.requestUpdate();
  }

  /** 路径输入变化时，异步解析并显示转换后的实际路径 */
  async _onPathInput(field, value) {
    this[field] = value;
    const resolvedField = field + 'Resolved';
    this[resolvedField] = '';
    if (this._resolveTimers[field]) clearTimeout(this._resolveTimers[field]);
    if (!value) {
      this.requestUpdate();
      return;
    }
    this._resolveTimers[field] = setTimeout(async () => {
      try {
        const { resolveExportPath } = await import('../services/export-service.js');
        const resolved = await resolveExportPath(value);
        if (resolved !== value.replace(/\\/g, '/')) {
          this[resolvedField] = resolved;
        } else {
          this[resolvedField] = '';
        }
      } catch (_) {
        this[resolvedField] = '';
      }
      this.requestUpdate();
    }, 300);
    this.requestUpdate();
  }

  /** 加载配置后，并行预解析已有路径 */
  async _preResolvePaths() {
    const fields = ['outputDir', 'fontsDir', 'coverImage', 'titleLogoImage', 'pageForegroundImage', 'docxReferenceDoc'].filter(f => this[f]);
    if (!fields.length) return;
    const { resolveExportPath } = await import('../services/export-service.js');
    await Promise.allSettled(fields.map(async (field) => {
      const value = this[field];
      const resolved = await resolveExportPath(value);
      if (resolved !== value.replace(/\\/g, '/')) {
        this[field + 'Resolved'] = resolved;
      }
    }));
    this.requestUpdate();
  }

  _changeTheme(e) {
    this.theme = e.target.value;
    eventBus.emit('theme-changed', this.theme);
  }

  async _changeLanguage(e) {
    const oldDefault = this._defaultExtraArgs;
    this.language = e.target.value;
    try { this._defaultExtraArgs = await getDefaultExtraArgs(this.language); } catch (_) {}
    if (this.extraArgs === oldDefault) {
      this.extraArgs = this._defaultExtraArgs;
    }
  }

  _switchTab(tab) {
    this.activeTab = tab;
    if (['exportCommon', 'asciidocEngine', 'asciidocPdf', 'asciidocDocx'].includes(tab)) {
      this._exportExpanded = true;
    }
  }

  _toggleExportSection() {
    this._exportExpanded = !this._exportExpanded;
  }

  _resetExtraArgs() {
    this.extraArgs = this._defaultExtraArgs || '';
  }

  render() {
    const exportChildren = ['exportCommon', 'asciidocEngine', 'asciidocPdf', 'asciidocDocx'];
    const isExportChild = exportChildren.includes(this.activeTab);

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
            <button class="nav-item ${this.activeTab === 'ai' ? 'active' : ''}" @click=${() => this._switchTab('ai')}>
              <span class="nav-icon">🤖</span> ${t('settings.tab.ai')}
            </button>
            <button class="nav-section" @click=${this._toggleExportSection}>
              <span class="toggle-icon ${this._exportExpanded ? '' : 'collapsed'}">▼</span>
              <span class="nav-icon">📦</span> ${t('settings.tab.export')}
            </button>
            <div class="nav-children ${this._exportExpanded ? '' : 'collapsed'}">
              <div class="nav-child">
                <button class="nav-item ${this.activeTab === 'exportCommon' ? 'active' : ''}" @click=${() => this._switchTab('exportCommon')}>
                  ${t('settings.tab.exportCommon')}
                </button>
                <button class="nav-item ${this.activeTab === 'asciidocEngine' ? 'active' : ''}" @click=${() => this._switchTab('asciidocEngine')}>
                  ${t('settings.tab.asciidocEngine')}
                </button>
                <button class="nav-item ${this.activeTab === 'asciidocPdf' ? 'active' : ''}" @click=${() => this._switchTab('asciidocPdf')}>
                  ${t('settings.tab.asciidocPdf')}
                </button>
                <button class="nav-item ${this.activeTab === 'asciidocDocx' ? 'active' : ''}" @click=${() => this._switchTab('asciidocDocx')}>
                  ${t('settings.tab.asciidocDocx')}
                </button>
              </div>
            </div>
            <button class="nav-item ${this.activeTab === 'shortcuts' ? 'active' : ''}" @click=${() => this._switchTab('shortcuts')}>
              <span class="nav-icon">⌨</span> ${t('settings.tab.shortcuts')}
            </button>
            <button class="nav-item ${this.activeTab === 'markup' ? 'active' : ''}" @click=${() => this._switchTab('markup')}>
              <span class="nav-icon">✥</span> ${t('settings.tab.markup')}
            </button>
          </div>
          <div class="content">
            ${this.activeTab === 'editor' ? this._renderEditorTab() : ''}
            ${this.activeTab === 'ai' ? this._renderAiTab() : ''}
            ${this.activeTab === 'exportCommon' ? this._renderExportCommonTab() : ''}
            ${this.activeTab === 'asciidocEngine' ? this._renderAsciidocEngineTab() : ''}
            ${this.activeTab === 'asciidocPdf' ? this._renderPdfTab() : ''}
            ${this.activeTab === 'asciidocDocx' ? this._renderDocxTab() : ''}
            ${this.activeTab === 'shortcuts' ? this._renderShortcutsTab() : ''}
            ${this.activeTab === 'markup' ? this._renderMarkupTab() : ''}
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
      </div>
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

  /** 导出 · 通用 */
  _renderExportCommonTab() {
    return html`
      <div class="field">
        <label>${t('settings.export.outputDir')}</label>
        <input type="text" .value=${this.outputDir} @input=${(e) => this._onPathInput('outputDir', e.target.value)} placeholder="/path/to/output" />
        ${this.outputDirResolved ? html`<div class="test-status ok">→ ${this.outputDirResolved}</div>` : ''}
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
        <label>${t('settings.exportDocx.commandPath')}</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="text" .value=${this.pandocCommandPath} @input=${(e) => { this.pandocCommandPath = e.target.value; this.pandocStatus = ''; this.pandocStatusType = ''; this._pandocResolved = ''; }} style="flex:1" />
          <button class="test-btn" @click=${this._detectPandocCommand}>${t('settings.export.detectCommand')}</button>
        </div>
        <div class="hint">${t('settings.exportDocx.commandPathHint')}</div>
        ${this.pandocStatus ? html`<div class="test-status ${this.pandocStatusType}">${this.pandocStatus}</div>` : ''}
      </div>
    `;
  }

  /** AsciiDoc · 引擎 */
  _renderAsciidocEngineTab() {
    return html`
      <div class="field">
        <label class="checkbox-label aligned-label">
          <input type="checkbox" .checked=${this.enableDiagram} @change=${(e) => this.enableDiagram = e.target.checked} />
          ${t('settings.export.enableDiagram')}
        </label>
        <div class="hint">${t('settings.export.enableDiagramHint')}</div>
      </div>
      <div class="field">
        <label>${t('settings.export.extraArgs')}</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="text" .value=${this.extraArgs} @input=${(e) => this.extraArgs = e.target.value} style="flex:1" />
          ${this.extraArgs !== this._defaultExtraArgs ? html`
            <button class="field-reset-btn" @click=${this._resetExtraArgs}>${t('settings.shortcuts.reset')}</button>
          ` : ''}
        </div>
        <div class="hint">${t('settings.export.extraArgsHint')}</div>
      </div>
    `;
  }

  /** AsciiDoc · PDF */
  _renderPdfTab() {
    return html`
      <div class="field">
        <label>${t('settings.export.commandPath')}</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="text" .value=${this.commandPath} @input=${(e) => { this.commandPath = e.target.value; this.pdfStatus = ''; this.pdfStatusType = ''; this._pdfResolved = ''; }} style="flex:1" />
          <button class="test-btn" @click=${this._detectPdfCommand}>${t('settings.export.detectCommand')}</button>
        </div>
        <div class="hint">${t('settings.export.commandPathHint')}</div>
        ${this.pdfStatus ? html`<div class="test-status ${this.pdfStatusType}">${this.pdfStatus}</div>` : ''}
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
        <input type="text" .value=${this.fontsDir} @input=${(e) => this._onPathInput('fontsDir', e.target.value)} placeholder="/path/to/fonts" />
        ${this.fontsDirResolved ? html`<div class="test-status ok">→ ${this.fontsDirResolved}</div>` : ''}
      </div>
      <div class="field">
        <label>${t('settings.export.footerCenter')}</label>
        <input type="text" .value=${this.footerCenter} @input=${(e) => this.footerCenter = e.target.value} />
      </div>
      <div class="field">
        <label>${t('settings.export.coverImage')}</label>
        <input type="text" .value=${this.coverImage} @input=${(e) => this._onPathInput('coverImage', e.target.value)} />
        ${this.coverImageResolved ? html`<div class="test-status ok">→ ${this.coverImageResolved}</div>` : ''}
      </div>
      <div class="field">
        <label>${t('settings.export.titleLogoImage')}</label>
        <input type="text" .value=${this.titleLogoImage} @input=${(e) => this._onPathInput('titleLogoImage', e.target.value)} placeholder="images/logo.png" />
        ${this.titleLogoImageResolved ? html`<div class="test-status ok">→ ${this.titleLogoImageResolved}</div>` : ''}
      </div>
      <div class="field">
        <label>${t('settings.export.pageForegroundImage')}</label>
        <input type="text" .value=${this.pageForegroundImage} @input=${(e) => this._onPathInput('pageForegroundImage', e.target.value)} placeholder="images/watermark.svg" />
        ${this.pageForegroundImageResolved ? html`<div class="test-status ok">→ ${this.pageForegroundImageResolved}</div>` : ''}
      </div>
      <div class="hint" style="margin-top:8px;">${t('settings.export.adocPriorityHint')}</div>
    `;
  }

  /** AsciiDoc · Word */
  _renderDocxTab() {
    return html`
      <div class="field">
        <label>${t('settings.exportDocx.referenceDoc')}</label>
        <input type="text" .value=${this.docxReferenceDoc} @input=${(e) => this._onPathInput('docxReferenceDoc', e.target.value)} placeholder="template.docx" />
        ${this.docxReferenceDocResolved ? html`<div class="test-status ok">→ ${this.docxReferenceDocResolved}</div>` : ''}
        <div class="hint">${t('settings.exportDocx.referenceDocHint')}</div>
      </div>
      <div class="hint" style="margin-top:8px;">${t('settings.exportDocx.pipelineHint')}</div>
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
      input.value = shortcutRegistry.getShortcut(id);
    }
  }

  _captureKey(e) {
    e.preventDefault();
    e.stopPropagation();
    const input = e.target;
    const id = input.dataset.scId;

    if (e.key === 'Escape') {
      input.value = shortcutRegistry.getShortcut(id);
      input.blur();
      return;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      shortcutRegistry.setShortcut(id, '').catch(() => {});
      input.value = '';
      this.requestUpdate();
      return;
    }

    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    parts.push(keyFromEvent(e));

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

  // ─── 自定义标记标签页 ───

  _renderMarkupTab() {
    return html`
      <div class="shortcut-header">
        <span class="hint">${t('settings.markup.hint')}</span>
        <button class="reset-all-btn" @click=${this._addSnippet}>+ ${t('settings.markup.addSnippet')}</button>
      </div>
      ${this.customSnippets.length === 0 ? html`
        <div style="text-align:center;color:var(--text-3);padding:24px;font-size:12px;">
          ${t('settings.markup.empty')}
        </div>
      ` : ''}
      ${this.customSnippets.map((s, i) => html`
        <div class="snippet-card">
          <div class="snippet-top">
            <input class="sn-name"
                   .value=${s.name} placeholder="${t('settings.markup.name')}"
                   @input=${(e) => this._updateSnippet(i, { ...s, name: e.target.value })} />
            <select .value=${s.is_inline ? 'inline' : 'block'}
                    @change=${(e) => this._updateSnippet(i, { ...s, is_inline: e.target.value === 'inline' })}>
              <option value="inline">${t('settings.markup.typeInline')}</option>
              <option value="block">${t('settings.markup.typeBlock')}</option>
            </select>
            <select .value=${s.format || ''}
                    @change=${(e) => this._updateSnippet(i, { ...s, format: e.target.value })}>
              <option value="">${t('settings.markup.formatAll')}</option>
              <option value="adoc">AsciiDoc</option>
              <option value="md">Markdown</option>
            </select>
            <input class="sc-input"
                   .value=${s.shortcut || ''} placeholder="${t('settings.markup.shortcut')}"
                   data-sc-idx=${i}
                   @focus=${this._startSnippetRecording}
                   @blur=${this._stopSnippetRecording}
                   @keydown=${this._captureSnippetKey} />
            <button class="sn-delete" @click=${() => this._deleteSnippet(i)} title="${t('settings.markup.delete')}">✕</button>
          </div>
          <div class="snippet-bottom">
            <textarea .value=${s.template} placeholder="${t('settings.markup.template')}: {selected} ..."
                      @input=${(e) => this._updateSnippet(i, { ...s, template: e.target.value })}></textarea>
          </div>
        </div>
      `)}
    `;
  }

  _addSnippet() {
    const id = 'snippet_' + Date.now();
    this.customSnippets = [...this.customSnippets, { id, name: '', template: '', shortcut: '', is_inline: true, format: '' }];
  }

  _updateSnippet(index, updated) {
    const copy = [...this.customSnippets];
    copy[index] = updated;
    this.customSnippets = copy;
  }

  _deleteSnippet(index) {
    this.customSnippets = this.customSnippets.filter((_, i) => i !== index);
  }

  _startSnippetRecording(e) {
    e.target.classList.add('recording');
    e.target.value = '';
  }

  _stopSnippetRecording(e) {
    const input = e.target;
    input.classList.remove('recording');
    const idx = parseInt(input.dataset.scIdx);
    if (!input.value.trim() && this.customSnippets[idx]) {
      input.value = this.customSnippets[idx].shortcut || '';
    }
  }

  _captureSnippetKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      const idx = parseInt(e.target.dataset.scIdx);
      e.target.value = this.customSnippets[idx]?.shortcut || '';
      e.target.blur();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const idx = parseInt(e.target.dataset.scIdx);
      this._updateSnippet(idx, { ...this.customSnippets[idx], shortcut: '' });
      e.target.value = '';
      return;
    }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    parts.push(keyFromEvent(e));
    const combo = parts.join('+');
    const idx = parseInt(e.target.dataset.scIdx);
    this._updateSnippet(idx, { ...this.customSnippets[idx], shortcut: combo });
    e.target.value = combo;
  }
}

customElements.define('settings-dialog', SettingsDialog);
