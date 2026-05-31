import { LitElement, css } from 'lit';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, ViewPlugin, Decoration } from '@codemirror/view';
import { EditorState, Compartment, RangeSetBuilder } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { StreamLanguage } from '@codemirror/language';
import { editorState } from '../services/editor-state.js';
import { eventBus } from '../services/event-bus.js';
import { writeFile, pickSaveFile, readFile, getFileMtime } from '../services/file-service.js';
import { t } from '../services/i18n.js';
import { setEditorSync, syncPreview } from '../services/scroll-sync.js';

function asciidocSyntax() {
  return {
    name: 'asciidoc',
    startState() {
      return { inCodeBlock: false, inTable: false };
    },
    token(stream, state) {
      if (stream.sol() && stream.eol()) {
        stream.next();
        return null;
      }

      if (stream.sol() && stream.match(/^-{4,}\s*$/)) {
        state.inCodeBlock = !state.inCodeBlock;
        return 'meta';
      }
      if (stream.sol() && stream.match(/^====\s*$/)) {
        state.inCodeBlock = !state.inCodeBlock;
        return 'meta';
      }
      if (stream.sol() && stream.match(/^\[source/)) {
        stream.skipToEnd();
        return 'meta';
      }
      if (stream.sol() && stream.match(/^----$/)) {
        state.inCodeBlock = !state.inCodeBlock;
        return 'meta';
      }

      if (state.inCodeBlock) {
        stream.skipToEnd();
        return 'comment';
      }

      if (stream.sol()) {
        if (stream.match(/^=+\s+/)) return 'heading';
        if (stream.match(/^\.{1,5}\s+/)) return 'heading';
      }

      if (stream.sol() && stream.match(/^:[\w-]+:/)) return 'keyword';
      if (stream.sol() && stream.match(/^\/\/\//)) { stream.skipToEnd(); return 'comment'; }
      if (stream.sol() && stream.match(/^\/\//)) { stream.skipToEnd(); return 'comment'; }
      if (stream.sol() && stream.match(/^ifdef::|^endif::|^ifeval::|^include::/)) { stream.skipToEnd(); return 'keyword'; }

      if (stream.sol() && stream.match(/^\s*[*.-]+\s/)) return 'variable-2';
      if (stream.sol() && stream.match(/^\s*\d+\.\s/)) return 'variable-2';

      if (stream.sol() && stream.match(/^\|===/)) { state.inTable = !state.inTable; return 'meta'; }
      if (state.inTable && stream.sol() && stream.match(/^\|/)) return 'string';

      if (stream.match(/\*[^\s*][^*]*\*/)) return 'strong';
      if (stream.match(/_[^\s_][^_]*_/)) return 'emphasis';
      if (stream.match(/`[^`]+`/)) return 'monospace';
      if (stream.match(/https?:\/\/\S+/)) return 'link';
      if (stream.match(/<<[^>]+>>/)) return 'link';
      if (stream.match(/xref:\S+/)) return 'link';
      if (stream.match(/\{[\w-]+\}/)) return 'variable-3';
      if (stream.match(/image::?\S+/)) return 'tag';
      if (stream.match(/footnote:\[/)) { stream.skipToEnd(); return 'comment'; }

      if (stream.match(/\[\[[\w-]+\]\]/)) return 'variable-2';

      if (stream.sol() && stream.match(/^\[/)) { stream.skipToEnd(); return 'variable-2'; }

      stream.next();
      return null;
    },
  };
}

// 路径规范化（处理 .. 和 .）
function _normalizePath(p) {
  const parts = p.split('/');
  const result = [];
  for (const part of parts) {
    if (part === '..') result.pop();
    else if (part !== '.' && part !== '') result.push(part);
  }
  return '/' + result.join('/');
}

// include:: 文件补全缓存
let _adocFileCache = null;
let _adocCacheWs = null;

async function _getCachedAdocFiles(workspaceRoot) {
  if (_adocFileCache && _adocCacheWs === workspaceRoot) return _adocFileCache;
  const { listAllAdocFiles } = await import('../services/file-service.js');
  _adocFileCache = await listAllAdocFiles(workspaceRoot);
  _adocCacheWs = workspaceRoot;
  return _adocFileCache;
}

function _toRelativePath(fromDir, absPath) {
  if (absPath.startsWith(fromDir + '/')) return absPath.slice(fromDir.length + 1);
  const from = fromDir.split('/');
  const to = absPath.split('/');
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  return '../'.repeat(from.length - i) + to.slice(i).join('/');
}

// include:: 和 xref: Ctrl+Click 装饰
const includeDeco = Decoration.mark({ class: 'cm-include-link' });
const xrefDeco = Decoration.mark({ class: 'cm-include-link' });

function buildLinkDecorations(state) {
  const builder = new RangeSetBuilder();
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    // include:: 装饰
    let searchFrom = 0;
    while (searchFrom < line.text.length) {
      const idx = line.text.indexOf('include::', searchFrom);
      if (idx === -1) break;
      const pathStart = idx + 'include::'.length;
      const bracketIdx = line.text.indexOf('[', pathStart);
      if (bracketIdx > pathStart) {
        builder.add(line.from + pathStart, line.from + bracketIdx, includeDeco);
      }
      searchFrom = pathStart;
    }
    // xref: 装饰
    searchFrom = 0;
    while (searchFrom < line.text.length) {
      const idx = line.text.indexOf('xref:', searchFrom);
      if (idx === -1) break;
      const pathStart = idx + 'xref:'.length;
      const endIdx = line.text.indexOf('[', pathStart);
      if (endIdx > pathStart) {
        builder.add(line.from + pathStart, line.from + endIdx, xrefDeco);
      }
      searchFrom = pathStart;
    }
    // <<...>> 装饰
    searchFrom = 0;
    while (searchFrom < line.text.length) {
      const idx = line.text.indexOf('<<', searchFrom);
      if (idx === -1) break;
      const endIdx = line.text.indexOf('>>', idx);
      const commaIdx = line.text.indexOf(',', idx + 2);
      if (endIdx > idx + 2) {
        const refEnd = commaIdx > idx && commaIdx < endIdx ? commaIdx : endIdx;
        builder.add(line.from + idx + 2, line.from + refEnd, xrefDeco);
      }
      searchFrom = endIdx > idx ? endIdx : idx + 2;
    }
  }
  return builder.finish();
}

const includeLinkPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildLinkDecorations(view.state); }
  update(update) {
    if (update.docChanged) this.decorations = buildLinkDecorations(update.state);
  }
}, {
  decorations: v => v.decorations,
  eventHandlers: {
    mousedown(e, view) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const pos = view.posAtCoords(e);
      if (pos == null) return;
      let clicked = false;
      this.decorations.between(pos, pos, () => { clicked = true; });
      if (!clicked) return;

      const line = view.state.doc.lineAt(pos);
      const col = pos - line.from;
      const currentPath = editorState.activeFilePath;
      const wsRoot = editorState.workspaceRoot;
      const baseDir = currentPath
        ? currentPath.substring(0, currentPath.lastIndexOf('/'))
        : wsRoot || '';

      // include:: 跳转
      let searchFrom = 0;
      while (searchFrom < line.text.length) {
        const idx = line.text.indexOf('include::', searchFrom);
        if (idx === -1) break;
        const pathStart = idx + 'include::'.length;
        const bracketIdx = line.text.indexOf('[', pathStart);
        if (bracketIdx > pathStart && col >= pathStart && col <= bracketIdx) {
          const linkPath = line.text.slice(pathStart, bracketIdx);
          e.preventDefault();
          const resolved = _normalizePath(linkPath.startsWith('/') ? linkPath : (baseDir + '/' + linkPath));
          eventBus.emit('open-external-file', resolved);
          return;
        }
        searchFrom = pathStart;
      }

      // xref: 跳转
      searchFrom = 0;
      while (searchFrom < line.text.length) {
        const idx = line.text.indexOf('xref:', searchFrom);
        if (idx === -1) break;
        const pathStart = idx + 'xref:'.length;
        const endIdx = line.text.indexOf('[', pathStart);
        if (endIdx > pathStart && col >= pathStart && col <= endIdx) {
          const linkPath = line.text.slice(pathStart, endIdx).split('#')[0];
          if (linkPath && !linkPath.startsWith('http')) {
            e.preventDefault();
            const resolved = _normalizePath(linkPath.startsWith('/') ? linkPath : (baseDir + '/' + linkPath));
            eventBus.emit('open-external-file', resolved);
          }
          return;
        }
        searchFrom = pathStart;
      }

      // <<...>> 跳转
      searchFrom = 0;
      while (searchFrom < line.text.length) {
        const idx = line.text.indexOf('<<', searchFrom);
        if (idx === -1) break;
        const endIdx = line.text.indexOf('>>', idx);
        const commaIdx = line.text.indexOf(',', idx + 2);
        if (endIdx > idx + 2 && col >= idx + 2 && col <= (commaIdx > idx && commaIdx < endIdx ? commaIdx : endIdx)) {
          const refEnd = commaIdx > idx && commaIdx < endIdx ? commaIdx : endIdx;
          const linkPath = line.text.slice(idx + 2, refEnd).split('#')[0].trim();
          if (linkPath && !linkPath.startsWith('http')) {
            e.preventDefault();
            const resolved = _normalizePath(linkPath.startsWith('/') ? linkPath : (baseDir + '/' + linkPath));
            eventBus.emit('open-external-file', resolved);
          }
          return;
        }
        searchFrom = endIdx > idx ? endIdx : idx + 2;
      }
    }
  },
});

// AsciiDoc 自动补全 — cursor 为光标偏移量（从 apply 文本开头算）
const ADOC_COMPLETIONS = [
  // 块级语法（cursor 定位到两个定界符之间的空行）
  { label: '====', apply: '====\n\n====', type: 'keyword', detail: 'example block', cursor: 5 },
  { label: '----', apply: '----\n\n----', type: 'keyword', detail: 'listing block', cursor: 5 },
  { label: '____', apply: '____\n\n____', type: 'keyword', detail: 'quote block', cursor: 5 },
  { label: '****', apply: '****\n\n****', type: 'keyword', detail: 'sidebar block', cursor: 5 },
  { label: '....', apply: '....\n\n....', type: 'keyword', detail: 'literal block', cursor: 5 },
  { label: '[source', apply: '[source,python]\n----\n\n----', type: 'function', detail: 'source block', cursor: 21 },
  { label: '[NOTE]', apply: '[NOTE]\n====\n\n====', type: 'keyword', detail: 'NOTE admonition', cursor: 12 },
  { label: '[TIP]', apply: '[TIP]\n====\n\n====', type: 'keyword', detail: 'TIP admonition', cursor: 11 },
  { label: '[WARNING]', apply: '[WARNING]\n====\n\n====', type: 'keyword', detail: 'WARNING admonition', cursor: 15 },
  { label: '[IMPORTANT]', apply: '[IMPORTANT]\n====\n\n====', type: 'keyword', detail: 'IMPORTANT admonition', cursor: 17 },
  { label: '[CAUTION]', apply: '[CAUTION]\n====\n\n====', type: 'keyword', detail: 'CAUTION admonition', cursor: 15 },
  // 行内语法（cursor 定位到占位参数）
  { label: 'image::', apply: 'image::filename[alt]', type: 'function', detail: 'block image', cursor: 7 },
  { label: 'image:', apply: 'image:filename[alt]', type: 'function', detail: 'inline image', cursor: 6 },
  { label: 'link:', apply: 'link:url[link text]', type: 'function', detail: 'link', cursor: 5 },
  { label: 'xref:', apply: 'xref:section[link text]', type: 'function', detail: 'cross reference', cursor: 5 },
  { label: 'include::', apply: 'include::filename[]', type: 'function', detail: 'include directive', cursor: 9 },
  { label: 'footnote:', apply: 'footnote:[text]', type: 'function', detail: 'footnote', cursor: 10 },
  { label: 'ifdef::', apply: 'ifdef::attr[]\n\nendif::[]', type: 'function', detail: 'conditional include', cursor: 7 },
  // 属性（cursor 定位到属性值位置）
  { label: ':toc:', apply: ':toc: auto', type: 'variable', detail: 'table of contents', cursor: 6 },
  { label: ':lang:', apply: ':lang: zh', type: 'variable', detail: 'language', cursor: 7 },
  { label: ':author:', apply: ':author: ', type: 'variable', detail: 'author', cursor: 9 },
  { label: ':revdate:', apply: ':revdate: ', type: 'variable', detail: 'revision date', cursor: 10 },
  { label: ':keywords:', apply: ':keywords: ', type: 'variable', detail: 'keywords', cursor: 11 },
  { label: ':description:', apply: ':description: ', type: 'variable', detail: 'description', cursor: 14 },
  { label: ':icons:', apply: ':icons: font', type: 'variable', detail: 'icons', cursor: 8 },
  { label: ':source-highlighter:', apply: ':source-highlighter: highlight.js', type: 'variable', detail: 'source highlighter', cursor: 22 },
  // 表格（cursor 定位到表头行）
  { label: '|===', apply: '|===\n| Header 1 | Header 2\n\n| Cell 1 | Cell 2\n|===', type: 'keyword', detail: 'table block', cursor: 5 },
];

async function asciidocCompletions(context) {
  // xref: 文件路径补全
  const xrefMatch = context.matchBefore(/xref:[\w.\/\-#]*/);
  if (xrefMatch) {
    const pathPrefix = xrefMatch.text.slice('xref:'.length).split('#')[0];
    const wsRoot = editorState.workspaceRoot;
    if (wsRoot) {
      const allFiles = await _getCachedAdocFiles(wsRoot);
      const currentPath = editorState.activeFilePath;
      const currentDir = currentPath
        ? currentPath.substring(0, currentPath.lastIndexOf('/'))
        : wsRoot;
      const { linkIndex } = await import('../services/link-index.js');

      const options = allFiles
        .filter(abs => abs !== currentPath)
        .map(abs => ({ abs, rel: _toRelativePath(currentDir, abs), title: linkIndex.getTitle(abs) }))
        .filter(({ rel }) => rel.startsWith(pathPrefix))
        .map(({ abs, rel, title }) => ({
          label: rel,
          type: 'file',
          detail: title,
          apply: (view, _cmp, from, to) => {
            let end = to;
            const line = view.state.doc.lineAt(to);
            const after = line.text.slice(to - line.from);
            const leftover = after.match(/^[\w.\/\-#]*\[/);
            if (leftover) end = to + leftover[0].length;
            view.dispatch({
              changes: { from, to: end, insert: rel + '[' },
              selection: { anchor: from + rel.length + 1 },
            });
          },
        }));
      if (options.length > 0) {
        return { from: xrefMatch.from + 'xref:'.length, options, validFor: /^[\w.\/\-#]*$/ };
      }
    }
  }

  // << 文件路径补全
  const angleMatch = context.matchBefore(/<<[\w.\/\-#]*/);
  if (angleMatch) {
    const pathPrefix = angleMatch.text.slice('<<'.length).split('#')[0];
    const wsRoot = editorState.workspaceRoot;
    if (wsRoot && pathPrefix.length > 0) {
      const allFiles = await _getCachedAdocFiles(wsRoot);
      const currentPath = editorState.activeFilePath;
      const currentDir = currentPath
        ? currentPath.substring(0, currentPath.lastIndexOf('/'))
        : wsRoot;
      const { linkIndex } = await import('../services/link-index.js');

      const options = allFiles
        .filter(abs => abs !== currentPath)
        .map(abs => ({ abs, rel: _toRelativePath(currentDir, abs), title: linkIndex.getTitle(abs) }))
        .filter(({ rel }) => rel.startsWith(pathPrefix))
        .map(({ rel, title }) => ({
          label: rel,
          type: 'file',
          detail: title,
          apply: (view, _cmp, from, to) => {
            view.dispatch({
              changes: { from, to, insert: rel + '>>' },
              selection: { anchor: from + rel.length + 2 },
            });
          },
        }));
      if (options.length > 0) {
        return { from: angleMatch.from + '<<'.length, options, validFor: /^[\w.\/\-#]*$/ };
      }
    }
  }

  // include:: 文件路径补全
  const includeMatch = context.matchBefore(/include::[\w.\/\-]*/);
  if (includeMatch) {
    const pathPrefix = includeMatch.text.slice('include::'.length);
    const wsRoot = editorState.workspaceRoot;
    if (wsRoot) {
      const allFiles = await _getCachedAdocFiles(wsRoot);
      const currentPath = editorState.activeFilePath;
      const currentDir = currentPath
        ? currentPath.substring(0, currentPath.lastIndexOf('/'))
        : wsRoot;

      const options = allFiles
        .filter(abs => abs !== currentPath)
        .map(abs => ({ abs, rel: _toRelativePath(currentDir, abs) }))
        .filter(({ rel }) => rel.startsWith(pathPrefix))
        .map(({ abs, rel }) => ({
          label: rel,
          type: 'file',
          detail: abs,
          apply: (view, _cmp, from, to) => {
            // 吃掉光标后残留的占位文本（如静态补全的 filename[]）
            let end = to;
            const line = view.state.doc.lineAt(to);
            const after = line.text.slice(to - line.from);
            const leftover = after.match(/^[\w.\/\-]*\[\]/);
            if (leftover) end = to + leftover[0].length;
            view.dispatch({
              changes: { from, to: end, insert: rel + '[]' },
              selection: { anchor: from + rel.length },
            });
          },
        }));

      if (options.length > 0) {
        return {
          from: includeMatch.from + 'include::'.length,
          options,
          validFor: /^[\w.\/\-]*$/,
        };
      }
    }
    // 无匹配文件时 fallthrough 到静态补全
  }

  // 静态补全
  const word = context.matchBefore(/[\w:=[\]|!-]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const text = word.text;

  const filtered = ADOC_COMPLETIONS.filter(i => i.label.startsWith(text));
  if (filtered.length === 0) return null;

  // 检查光标后是否有 closeBrackets 插入的 ]
  const pos = word.to;
  const trailing = pos < context.state.doc.length && context.state.doc.sliceString(pos, pos + 1) === ']';

  return {
    from: word.from,
    options: filtered.map(item => {
      const insertText = item.apply;
      return {
        ...item,
        apply: (view, _cmp, from, to) => {
          const end = trailing ? to + 1 : to;
          view.dispatch({
            changes: { from, to: end, insert: insertText },
            selection: { anchor: from + (item.cursor ?? insertText.length) },
          });
        },
      };
    }),
    validFor: /^[\w:=[\]|!-]*$/,
  };
}

const themeCompartment = new Compartment();
const wrapCompartment = new Compartment();

class EditorPane extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    .cm-editor {
      height: 100%;
      font-size: var(--editor-font-size, 14px);
    }
    .cm-editor .cm-scroller {
      font-family: var(--font-mono);
      line-height: 1.6;
    }
    .cm-editor ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    .cm-editor ::-webkit-scrollbar-thumb {
      background: var(--border-subtle);
      border-radius: 9999px;
    }
    .cm-editor ::-webkit-scrollbar-thumb:hover {
      background: var(--border-medium);
    }
  `;

  constructor() {
    super();
    this._view = null;
    this._currentPath = null;
    this._updatingFromExternal = false;
    this._handlers = {};
    this._autoSaveTimer = null;
    this._fontSize = 14;
    this._autoSaveDelay = 3000;
    this._fileMtime = null;
    this._ignoreScroll = false;
    this._previewVisible = true;
    this._lastScrollTop = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this._handlers = {
      'file-opened': ({ path, content }) => this._openFile(path, content),
      'save-file': () => this._saveFile(),
      'theme-changed': (theme) => this._setTheme(theme),
      'ai-insert-text': (text) => this._insertText(text),
      'new-file': () => this._newFile(),
      'create-from-template': ({ content }) => this._newFileFromTemplate(content),
      'open-find-replace': () => this._openFindReplace(),
      'toggle-word-wrap': () => this._toggleWrap(),
      'set-word-wrap': (val) => this._setWrap(val),
      'font-size-set': (size) => this._setFontSize(size),
      'jump-to-line': (line) => this._jumpToLine(line),
      'file-renamed': ({ oldPath, newPath }) => this._onFileRenamed(oldPath, newPath),
      'replace-editor-content': (content) => this._replaceContent(content),
      'file-closed': (path) => this._onFileClosed(path),
      'open-external-file': (path) => this._openExternalFile(path),
      'preview-visibility-changed': (v) => { this._previewVisible = v; },
      'workspace-opened': () => { _adocFileCache = null; },
      'file-saved': () => { _adocFileCache = null; },
    };
    for (const [name, handler] of Object.entries(this._handlers)) {
      eventBus.on(name, handler);
    }
    setEditorSync((ratio) => this._onPreviewScrolled(ratio));
    // 未保存时关闭窗口提醒
    this._beforeUnload = (e) => {
      if (editorState.getDirtyFiles().length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', this._beforeUnload);
  }

  firstUpdated() {
    this._initEditor();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const [name, handler] of Object.entries(this._handlers)) {
      eventBus.off(name, handler);
    }
    setEditorSync(null);
    if (this._beforeUnload) window.removeEventListener('beforeunload', this._beforeUnload);
    clearTimeout(this._autoSaveTimer);
    this._view?.destroy();
  }

  _initEditor() {
    const container = document.createElement('div');
    container.style.cssText = 'height:100%;overflow:hidden;';
    this.shadowRoot.appendChild(container);

    const adocLang = StreamLanguage.define(asciidocSyntax());

    this._view = new EditorView({
      state: EditorState.create({
        doc: t('editor.placeholder'),
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          foldGutter(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          rectangularSelection(),
          autocompletion({ override: [asciidocCompletions] }),
          search(),
          includeLinkPlugin,
          wrapCompartment.of([]),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap.filter(b => b.key !== 'Mod-g'),
            ...closeBracketsKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          // 自定义快捷键（独立 keymap 优先级高于上面的 searchKeymap）
          keymap.of([
            { key: 'Mod-s', run: () => { this._saveFile(); return true; } },
            { key: 'Mod-Shift-f', run: () => { eventBus.emit('toggle-search'); return true; } },
            { key: 'Mod-g', run: () => { this._showGotoLine(); return true; } },
            { key: 'Mod-=', run: () => { this._adjustFontSize(1); return true; } },
            { key: 'Mod--', run: () => { this._adjustFontSize(-1); return true; } },
            { key: 'Mod-0', run: () => { this._setFontSize(14); return true; } },
          ]),
          adocLang,
          syntaxHighlighting(defaultHighlightStyle),
          themeCompartment.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this._updatingFromExternal) {
              const content = update.state.doc.toString();
              const statePath = this._currentPath || editorState.activeFilePath;
              if (statePath) {
                editorState.updateContent(statePath, content);
              }
              eventBus.emit('content-changed', content);
              // 自动保存（仅对已保存到磁盘的文件）
              if (this._currentPath && !this._currentPath.startsWith('__untitled_')) {
                clearTimeout(this._autoSaveTimer);
                this._autoSaveTimer = setTimeout(() => this._saveFile(), this._autoSaveDelay);
              }
            }
            if (update.selectionSet) {
              const pos = update.state.selection.main.head;
              const line = update.state.doc.lineAt(pos);
              eventBus.emit('cursor-changed', { line: line.number, col: pos - line.from });
            }
          }),
          EditorView.theme({
            '&': { height: '100%' },
            '.cm-scroller': { overflow: 'auto' },
            '.cm-include-link': { textDecoration: 'underline', cursor: 'pointer' },
            '.cm-include-link:hover': { backgroundColor: 'rgba(91, 155, 213, 0.1)' },
          }),
        ],
      }),
      parent: container,
    });

    // Ctrl+滚轮字体缩放
    container.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this._adjustFontSize(e.deltaY > 0 ? -1 : 1);
      }
    }, { passive: false });

    // 滚动同步：passive 监听 + 直接函数调用
    requestAnimationFrame(() => {
      const scroller = this._view?.scrollDOM;
      if (scroller) {
        this._lastScrollTop = scroller.scrollTop;
        scroller.addEventListener('scroll', () => {
          if (this._ignoreScroll || !this._previewVisible) return;
          const top = scroller.scrollTop;
          if (top === this._lastScrollTop) return;
          this._lastScrollTop = top;
          const max = scroller.scrollHeight - scroller.clientHeight;
          if (max > 0) syncPreview(top / max);
        }, { passive: true });
      }
    });

    // 外部文件修改检测
    container.addEventListener('focusin', () => this._checkExternalChange());

    this._loadConfig();
  }

  async _loadConfig() {
    try {
      const { loadEditorConfig } = await import('../services/config-service.js');
      const config = await loadEditorConfig();
      this._fontSize = config.font_size;
      this._setFontSize(config.font_size);
      if (config.word_wrap) this._toggleWrap();
      if (config.auto_save_interval > 0) this._autoSaveDelay = config.auto_save_interval;
    } catch (e) { /* 使用默认值 */ }
  }

  _adjustFontSize(delta) {
    this._setFontSize(Math.min(32, Math.max(10, this._fontSize + delta)));
  }

  _setFontSize(size) {
    this._fontSize = size;
    this.style.setProperty('--editor-font-size', `${size}px`);
    eventBus.emit('font-size-changed', size);
  }

  _toggleWrap() {
    if (!this._view) return;
    const currentWrap = this._view.state.facet(EditorView.lineWrapping);
    this._applyWrap(!currentWrap);
  }

  _setWrap(val) {
    if (!this._view) return;
    this._applyWrap(!!val);
  }

  _applyWrap(enabled) {
    this._view.dispatch({
      effects: wrapCompartment.reconfigure(enabled ? EditorView.lineWrapping : []),
    });
    eventBus.emit('word-wrap-changed', enabled);
  }

  _jumpToLine(line) {
    if (!this._view) return;
    const pos = this._view.state.doc.line(Math.min(line, this._view.state.doc.lines)).from;
    this._view.dispatch({
      selection: { anchor: pos },
      scrollIntoView: true,
    });
    this._view.focus();
  }

  // Ctrl+G 跳转到行
  _showGotoLine() {
    const input = prompt(t('editor.gotoLinePrompt'));
    if (!input) return;
    const line = parseInt(input);
    if (isNaN(line) || line < 1) return;
    this._jumpToLine(line);
  }

  _openFindReplace() {
    if (this._view) openSearchPanel(this._view);
  }

  _setEditorContent(content) {
    if (!this._view) return;
    this._updatingFromExternal = true;
    this._view.dispatch({
      changes: { from: 0, to: this._view.state.doc.length, insert: content },
      selection: { anchor: 0 },
    });
    this._updatingFromExternal = false;
  }

  async _openFile(path, content) {
    this._currentPath = path;
    this._setEditorContent(content);
    eventBus.emit('content-changed', content);
    // 记录文件 mtime 用于外部修改检测
    this._fileMtime = null;
    if (!path.startsWith('__untitled_')) {
      try {
        this._fileMtime = await getFileMtime(path);
      } catch (_) {}
    }
  }

  // 拖拽或外部打开文件
  async _openExternalFile(path) {
    try {
      const content = await readFile(path);
      editorState.openFile(path, content);
      eventBus.emit('file-opened', { path, content });
      // 链接跳转时自动显示反向链接面板（等索引就绪）
      const { linkIndex } = await import('../services/link-index.js');
      if (linkIndex.ready) await linkIndex.ready;
      const bls = await linkIndex.getBacklinks(path);
      if (bls.length > 0) {
        eventBus.emit('show-backlinks');
      }
      // 记录最近文件
      const { addRecentFile } = await import('../services/config-service.js');
      addRecentFile(path).catch(() => {});
    } catch (e) {
      console.error('打开文件失败:', e);
    }
  }

  _replaceContent(content) {
    if (!this._view) return;
    const doc = this._view.state.doc;
    this._view.dispatch({
      changes: { from: 0, to: doc.length, insert: content },
    });
  }

  _setTheme(theme) {
    if (!this._view) return;
    this._view.dispatch({
      effects: themeCompartment.reconfigure(theme === 'dark' ? oneDark : []),
    });
  }

  _insertText(text) {
    if (!this._view) return;
    const { from, to } = this._view.state.selection.main;
    this._view.dispatch({
      changes: { from, to, insert: text },
    });
    this._view.focus();
  }

  async _saveFile() {
    if (!this._view) return;
    const content = this._view.state.doc.toString();

    // 新文件或未保存的临时文件，弹出另存为
    if (!this._currentPath || this._currentPath.startsWith('__untitled_')) {
      try {
        const dir = editorState.workspaceRoot || '';
        const defaultName = dir ? `${dir}/untitled.adoc` : 'untitled.adoc';
        const savePath = await pickSaveFile(defaultName);
        if (!savePath) return;
        await writeFile(savePath, content);
        // 关闭旧的 untitled 条目
        if (this._currentPath && this._currentPath.startsWith('__untitled_')) {
          editorState.closeFile(this._currentPath);
        }
        this._currentPath = savePath;
        editorState.openFile(savePath, content);
        editorState.markSaved(savePath);
        eventBus.emit('file-saved', { path: savePath, content });
        if (editorState.workspaceRoot) eventBus.emit('workspace-opened', editorState.workspaceRoot);
        this._fileMtime = await getFileMtime(savePath).catch(() => null);
      } catch (e) {
        console.error('保存失败:', e);
      }
      return;
    }

    try {
      await writeFile(this._currentPath, content);
      editorState.markSaved(this._currentPath);
      eventBus.emit('file-saved', { path: this._currentPath, content });
      this._fileMtime = await getFileMtime(this._currentPath).catch(() => null);
    } catch (e) {
      console.error('保存失败:', e);
    }
  }

  // 一键新建空白文档
  _newFile() {
    this._createUntitled('');
  }

  // 从模板创建
  _newFileFromTemplate(content) {
    this._createUntitled(content);
  }

  _createUntitled(content) {
    const path = `__untitled_${Date.now()}`;
    this._currentPath = path;
    editorState.openFile(path, content);
    this._setEditorContent(content);
    eventBus.emit('content-changed', content);
    this._view?.focus();
  }

  _onFileRenamed(oldPath, newPath) {
    if (this._currentPath === oldPath) {
      this._currentPath = newPath;
    }
  }

  _onFileClosed(path) {
    if (this._currentPath === path) {
      const active = editorState.getActiveFile();
      if (active) {
        this._openFile(active.path, active.content);
      } else {
        this._currentPath = null;
        this._setEditorContent('');
      }
    }
  }

  // 外部文件修改检测
  async _checkExternalChange() {
    if (!this._currentPath || this._currentPath.startsWith('__untitled_')) return;
    if (!this._fileMtime) return;
    try {
      const mtime = await getFileMtime(this._currentPath);
      if (mtime !== this._fileMtime) {
        const reload = confirm(t('editor.fileChanged'));
        if (reload) {
          const content = await readFile(this._currentPath);
          this._setEditorContent(content);
          editorState.updateContent(this._currentPath, content);
          eventBus.emit('content-changed', content);
        }
        this._fileMtime = mtime;
      }
    } catch (_) {}
  }

  // 滚动同步：预览滚动时跟随（scrollTop 赋值同步触发 scroll 事件）
  _onPreviewScrolled(ratio) {
    if (!this._view) return;
    const scroller = this._view.scrollDOM;
    const max = scroller.scrollHeight - scroller.clientHeight;
    if (max <= 0) return;
    this._ignoreScroll = true;
    scroller.scrollTop = ratio * max;
    this._lastScrollTop = scroller.scrollTop;
    this._ignoreScroll = false;
  }

  getSelectedText() {
    if (!this._view) return '';
    const { from, to } = this._view.state.selection.main;
    return this._view.state.doc.sliceString(from, to);
  }

  render() {
    return '';
  }
}

customElements.define('editor-pane', EditorPane);
