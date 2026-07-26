import { LitElement, css } from 'lit';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, ViewPlugin, Decoration } from '@codemirror/view';
import { EditorState, Compartment, RangeSetBuilder } from '@codemirror/state';
import { history, indentWithTab, undo, redo, standardKeymap, selectAll, moveLineUp, moveLineDown, copyLineUp, copyLineDown, deleteLine, indentMore, indentLess, indentSelection, cursorMatchingBracket, insertBlankLine, addCursorAbove, addCursorBelow, selectLine, selectParentSyntax, cursorPageUp, cursorPageDown } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { StreamLanguage } from '@codemirror/language';
import { vim, Vim, getCM } from '@replit/codemirror-vim';
import { editorState } from '../services/editor-state.js';
import { eventBus } from '../services/event-bus.js';
import { writeFile, pickSaveFile, readFile, getFileMtime, deleteFile } from '../services/file-service.js';
import { t } from '../services/i18n.js';
import { showConfirm } from '../services/dialog.js';
import { setEditorSync, syncPreview } from '../services/scroll-sync.js';
import { getFormat, isBinaryFile, wrapInline, toggleLineComment, toggleBlockComment, insertHeading, toggleList, insertBlock, insertAdocLink, insertMdLink, alignAdocTable, insertSnippet } from '../services/format-commands.js';
import { linkIndex } from '../services/link-index.js';
import { shortcutRegistry } from '../services/shortcut-registry.js';
import { loadEditorConfig, saveEditorConfig, addRecentFile, loadWorkspaceState, saveWorkspaceState } from '../services/config-service.js';
import { listAllAdocFiles } from '../services/file-service.js';

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

// 懒构造语法状态机：避免模块 import 时就构建、被拉进 eager 启动图。
// define 幂等，首次调用构建并缓存，后续切换复用——兼顾「不重复构建」与「不进启动图」。
let _asciidocLanguage = null;
function asciidocLanguage() {
  if (!_asciidocLanguage) _asciidocLanguage = StreamLanguage.define(asciidocSyntax());
  return _asciidocLanguage;
}

// 路径规范化（处理 .. 和 .）
function _normalizePath(p) {
  const isUnc = p.startsWith('//');
  const parts = p.split('/');
  const result = [];
  for (const part of parts) {
    if (part === '..') result.pop();
    else if (part !== '.' && part !== '') result.push(part);
  }
  // Windows 驱动器路径（如 D:）不额外加前缀
  if (result.length > 0 && /^[A-Za-z]:$/.test(result[0])) {
    return result.join('/');
  }
  // Windows UNC 路径（如 //wsl.localhost/...）保留 // 前缀
  if (isUnc) {
    return '//' + result.join('/');
  }
  return '/' + result.join('/');
}

// include:: 文件补全缓存
let _adocFileCache = null;
let _adocCacheWs = null;

async function _getCachedAdocFiles(workspaceRoot) {
  if (_adocFileCache && _adocCacheWs === workspaceRoot) return _adocFileCache;
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
  // Markdown 文件不需要 include/xref 装饰
  if (_currentFormatId === 'md') return Decoration.none;
  // 快速早退：文档不含任何链接标记时跳过逐行扫描（多数文档命中）。
  // 逐行 line.text.includes 检查，避免 state.doc.toString() 全量分配整串——
  // 此函数每次事务（每次按键）都跑，大文档上整串分配是纯浪费。
  let hasLinkMarker = false;
  for (let i = 1; i <= state.doc.lines && !hasLinkMarker; i++) {
    const lt = state.doc.line(i).text;
    hasLinkMarker = lt.includes('include::') || lt.includes('xref:') || lt.includes('<<');
  }
  if (!hasLinkMarker) return Decoration.none;
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

/** 处理 Ctrl/Cmd+Click 跳转（include::, xref:, <<>>） */
function _processLinkClick(e, view, decorations) {
  if (!(e.ctrlKey || e.metaKey)) return;
  const pos = view.posAtCoords(e);
  if (pos == null) return;
  let clicked = false;
  decorations.between(pos, pos, () => { clicked = true; });
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

const includeLinkPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildLinkDecorations(view.state); }
  update(update) {
    if (update.docChanged) this.decorations = buildLinkDecorations(update.state);
  }
}, {
  decorations: v => v.decorations,
  eventHandlers: {
    mousedown(e, view) {
      _processLinkClick(e, view, this.decorations);
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
const keymapCompartment = new Compartment();
const vimCompartment = new Compartment();
const languageCompartment = new Compartment();
const completionCompartment = new Compartment();
const baseKeymapCompartment = new Compartment();
const phrasesCompartment = new Compartment();

/** 构建 CodeMirror 翻译短语（搜索面板等内置 UI 标签） */
function buildCmPhrases() {
  return {
    "Find": t('search.find'),
    "Replace": t('search.replace'),
    "next": t('search.next'),
    "previous": t('search.prev'),
    "all": t('search.all'),
    "match case": t('search.caseSensitive'),
    "regexp": t('search.regex'),
    "by word": t('search.byWord'),
    "replace": t('search.replace'),
    "replace all": t('search.replaceAll'),
    "close": t('search.close'),
  };
}

// 当前格式 ID（供模块级函数访问）

function _buildBaseKeymap(vimEnabled) {
  const base = vimEnabled
    ? standardKeymap.filter(b => !['Enter', 'Backspace', 'Delete'].includes(b.key))
    : standardKeymap;
  return [
    ...base,
    ...searchKeymap.filter(b => b.key !== 'Mod-g' && (!vimEnabled || !['Mod-f', 'Mod-b'].includes(b.key))),
    ...closeBracketsKeymap,
    ...completionKeymap,
    indentWithTab,
  ];
}
let _currentFormatId = null;

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
    /* 跳转行号浮动输入框 */
    .goto-line-overlay {
      position: absolute;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100;
      background: var(--bg-3);
      border: 1px solid var(--border-medium);
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      padding: 4px;
    }
    .goto-line-overlay input {
      width: 220px;
      padding: 6px 10px;
      border: none;
      border-radius: 4px;
      background: var(--bg-1);
      color: var(--text-1);
      font-family: var(--font-mono);
      font-size: 13px;
      outline: none;
    }
    .goto-line-overlay input::placeholder {
      color: var(--text-3);
    }
    /* Vim Ex 命令面板 */
    .cm-editor .cm-vim-panel {
      background: var(--bg-3);
      border-top: 2px solid var(--accent);
      padding: 4px 12px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-1);
    }
    .cm-editor .cm-vim-panel input {
      color: var(--text-1);
      caret-color: var(--text-1);
      font-family: var(--font-mono);
      font-size: 13px;
    }
    /* CodeMirror 搜索/替换面板 */
    .cm-editor .cm-panel.cm-search {
      background: var(--bg-3);
      border-top: 2px solid var(--accent);
      padding: 6px 8px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-1);
    }
    .cm-editor .cm-panel.cm-search .cm-textfield {
      padding: 4px 6px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: var(--bg-1);
      color: var(--text-1);
      font-family: var(--font-mono);
      font-size: 13px;
      outline: none;
    }
    .cm-editor .cm-panel.cm-search .cm-textfield:focus {
      border-color: var(--accent);
    }
    .cm-editor .cm-panel.cm-search .cm-button {
      padding: 3px 8px;
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      background: var(--bg-1);
      color: var(--text-1);
      font-family: var(--font-mono);
      font-size: 12px;
      cursor: pointer;
    }
    .cm-editor .cm-panel.cm-search .cm-button:hover {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .cm-editor .cm-panel.cm-search label {
      color: var(--text-3);
      font-size: 12px;
    }
    .cm-editor .cm-panel.cm-search [name=close] {
      color: var(--text-3);
      font-size: 18px;
      line-height: 1;
    }
    .cm-editor .cm-panel.cm-search [name=close]:hover {
      color: var(--text-1);
    }
  `;

  constructor() {
    super();
    this._view = null;
    this._currentPath = null;
    this._currentFormat = null;
    this._updatingFromExternal = false;
    this._handlers = {};
    this._autoSaveTimer = null;
    this._fontSize = 14;
    this._autoSaveDelay = 0;
    this._fileMtime = null;
    this._untitledCounter = 0;
    this._ignoreScroll = false;
    this._previewVisible = true;
    this._lastScrollTop = 0;
    this._lastSwitchedFormat = null;
    this._vimEnabled = false;
    this._lastVimMode = '';
    this._vimModeChangeHandler = null;
    // 多文档独立 EditorState 缓存：path → EditorState（每个文档独立的 history/撤销栈）
    this._docStates = new Map();
    // 各文档的滚动位置：EditorState 不存 scrollTop，setState 会重建 docView 把 scrollTop 钳为 0，需旁路保存/恢复
    this._docScroll = new Map();
    this._theme = null;      // 'light' | 'dark'，切换文档后需把缓存的旧 state 重应用主题
    this._wordWrap = false;  // 软换行开关，切换文档后需重应用
  }

  connectedCallback() {
    super.connectedCallback();
    this._handlers = {
      'file-opened': ({ path, content, binary }) => this._openFile(path, content, binary),
      'save-file': () => this._saveFile(),
      'theme-changed': (theme) => this._setTheme(theme),
      'ai-insert-text': (payload) => {
        // 兼容字符串（普通插入）与 {text, range}（AI 改写「接受」：精确替换原始选区范围）
        if (typeof payload === 'string') this._insertText(payload);
        else if (payload && typeof payload === 'object') this._insertText(payload.text, payload.range);
      },
      'new-file': () => this._newFile(),
      'create-from-template': ({ content }) => this._newFileFromTemplate(content),
      'open-find-replace': () => this._openFindReplace(),
      'toggle-word-wrap': () => this._toggleWrap(),
      'set-word-wrap': (val) => this._setWrap(val),
      'font-size-set': (size) => this._setFontSize(size),
      'jump-to-line': (line) => this._jumpToLine(line),
      'jump-to-heading': ({ line }) => { if (line != null) this._jumpToLine(line); },
      'file-renamed': ({ oldPath, newPath }) => this._onFileRenamed(oldPath, newPath),
      'replace-editor-content': (content) => this._replaceContent(content),
      'file-closed': (path) => this._onFileClosed(path),
      'editor-undo': () => { if (this._view) undo(this._view); },
      'editor-redo': () => { if (this._view) redo(this._view); },
      'editor-select-all': () => { if (this._view) selectAll(this._view); },
      'editor-toggle-comment': () => { this._toggleComment(); },
      'editor-toggle-block-comment': () => { this._toggleBlockComment(); },
      'editor-move-line-up': () => { if (this._view) moveLineUp(this._view); },
      'editor-move-line-down': () => { if (this._view) moveLineDown(this._view); },
      'editor-copy-line-up': () => { if (this._view) copyLineUp(this._view); },
      'editor-copy-line-down': () => { if (this._view) copyLineDown(this._view); },
      'editor-delete-line': () => { if (this._view) deleteLine(this._view); },
      'editor-indent-more': () => { if (this._view) indentMore(this._view); },
      'editor-indent-less': () => { if (this._view) indentLess(this._view); },
      'editor-indent-selection': () => { if (this._view) indentSelection(this._view); },
      'editor-matching-bracket': () => { if (this._view) cursorMatchingBracket(this._view); },
      'editor-insert-blank-line': () => { if (this._view) insertBlankLine(this._view); },
      'editor-add-cursor-above': () => { if (this._view) addCursorAbove(this._view); },
      'editor-add-cursor-below': () => { if (this._view) addCursorBelow(this._view); },
      'editor-select-line': () => { if (this._view) selectLine(this._view); },
      'editor-select-parent-syntax': () => { if (this._view) selectParentSyntax(this._view); },
      // 格式感知的标记操作
      'editor-markup-inline': ({ id }) => { this._wrapInlineMarkup(id); },
      'editor-markup-link': () => { this._insertLink(); },
      'editor-heading': (level) => { this._insertHeading(level); },
      'editor-list': (marker) => { if (this._view) toggleList(this._view, marker); },
      'editor-insert-block': ({ id }) => { this._insertBlockById(id); },
      'editor-align-table': () => { this._alignTable(); },
      'editor-insert-snippet': ({ template, isInline }) => { if (this._view) insertSnippet(this._view, template, isInline); },
      'goto-line': () => this._showGotoLine(),
      'open-external-file': (path) => this._openExternalFile(path),
      'reload-from-disk': (path) => this._reloadFromDiskPath(path),
      'preview-visibility-changed': (v) => { this._previewVisible = v; },
      'view-mode-changed': (mode) => {
        this._viewMode = mode;
        this._previewVisible = mode === 'split';
        // 编辑器从隐藏恢复显示时刷新 CodeMirror
        if (mode !== 'preview' && this._view) {
          requestAnimationFrame(() => this._view.requestMeasure());
        }
      },
      'set-auto-save': (interval) => {
        this._autoSaveDelay = (interval || 0) * 1000;
        if (this._autoSaveDelay <= 0) { clearTimeout(this._autoSaveTimer); this._autoSaveTimer = null; }
      },
      'workspace-opened': () => { _adocFileCache = null; },
      'set-vim-mode': ({ enabled, escapeSeq }) => this._applyVimMode(enabled, escapeSeq),
      'language-changed': () => {
        if (this._view) {
          this._view.dispatch({
            effects: phrasesCompartment.reconfigure(EditorState.phrases.of(buildCmPhrases())),
          });
        }
      },
      'toggle-vim-mode': () => this._toggleVimMode(),
      'set-vim-submode': (mode) => this._setVimSubmode(mode),
      'file-saved': () => { _adocFileCache = null; },
      'restore-editor-state': ({ scrollTop, cursorPos }) => {
        if (!this._view) return;
        requestAnimationFrame(() => {
          const pos = Math.min(cursorPos || 0, this._view.state.doc.length);
          this._view.dispatch({
            selection: { anchor: pos },
            scrollIntoView: true,
          });
          if (scrollTop) {
            requestAnimationFrame(() => {
              const scroller = this._view.scrollDOM;
              if (scroller) scroller.scrollTop = scrollTop;
            });
          }
        });
      },
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
    if (this._vimModeChangeHandler && this._view) {
      const cm = getCM(this._view);
      if (cm) cm.off('vim-mode-change', this._vimModeChangeHandler);
    }
    this._view?.destroy();
  }

  _initEditor() {
    const container = document.createElement('div');
    container.style.cssText = 'height:100%;overflow:hidden;';
    this.shadowRoot.appendChild(container);

    this._view = new EditorView({
      state: EditorState.create({
        doc: t('editor.placeholder'),
        extensions: this._editorExtensions(),
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

  /** 构建编辑器 extensions：所有文档 state 共享同一套（仅 doc/history 各自隔离）。
   *  updateListener 闭包捕获 this，故任意文档上屏时都能按 this._currentPath 正确同步内容。 */
  _editorExtensions() {
    return [
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
      completionCompartment.of(autocompletion({ override: [asciidocCompletions] })),
      search(),
      phrasesCompartment.of(EditorState.phrases.of(buildCmPhrases())),
      includeLinkPlugin,
      wrapCompartment.of([]),
      // 标准 + 补全键位映射（vim/自定义快捷键优先拦截）
      baseKeymapCompartment.of(keymap.of(_buildBaseKeymap(false))),
      vimCompartment.of([]),
      // 自定义快捷键（放在标准 keymap 之前，可覆盖标准绑定）
      keymapCompartment.of(keymap.of([])),
      languageCompartment.of(asciidocLanguage()),
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
          // 自动保存（仅对已保存到磁盘的文件，且未禁用）
          if (this._currentPath && !this._currentPath.startsWith('__untitled_') && this._autoSaveDelay > 0) {
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
    ];
  }

  async _loadConfig() {
    try {
      const config = await loadEditorConfig();
      this._fontSize = config.font_size;
      this._setFontSize(config.font_size);
      if (config.word_wrap) this._toggleWrap();
      this._autoSaveDelay = (config.auto_save_interval || 0) * 1000;
      if (config.vim_mode) this._applyVimMode(true, config.vim_escape_seq || 'jk');
    } catch (e) { /* 使用默认值 */ }
    // 从快捷键注册中心加载自定义快捷键
    try {
      this._applyShortcutKeymap(shortcutRegistry);
    } catch (_) {}
  }

  _applyShortcutKeymap(sr) {
    if (!this._view) return;
    const boldKey = sr.getCmKey('markupBold') || 'Mod-b';
    const bindings = [
      { key: sr.getCmKey('undo') || 'Mod-z',         run: () => { if (this._view) undo(this._view); return true; } },
      { key: sr.getCmKey('redo') || 'Mod-Shift-z',   run: () => { if (this._view) redo(this._view); return true; } },
      { key: sr.getCmKey('save') || 'Mod-s',          run: () => { this._saveFile(); return true; } },
      { key: sr.getCmKey('search') || 'Mod-Shift-f', run: () => { eventBus.emit('toggle-search'); return true; } },
      { key: sr.getCmKey('gotoLine') || 'Mod-g',     run: () => { this._showGotoLine(); return true; } },
      { key: sr.getCmKey('zoomIn') || 'Mod-=',       run: () => { this._adjustFontSize(1); return true; } },
      { key: sr.getCmKey('zoomOut') || 'Mod--',      run: () => { this._adjustFontSize(-1); return true; } },
      { key: sr.getCmKey('zoomReset') || 'Mod-0',    run: () => { this._setFontSize(14); return true; } },
      // 注释快捷键
      { key: sr.getCmKey('toggleLineComment') || 'Mod-/', run: () => { this._toggleComment(); return true; } },
      { key: sr.getCmKey('toggleBlockComment') || 'Mod-Shift-/', run: () => { this._toggleBlockComment(); return true; } },
      // 标记快捷键（vim 模式下 Ctrl-B 改为翻页，不绑定粗体）
      ...(this._vimEnabled ? [] : [{ key: boldKey, run: () => { this._wrapInlineMarkup('bold'); return true; } }]),
      { key: sr.getCmKey('markupItalic') || 'Mod-i', run: () => { this._wrapInlineMarkup('italic'); return true; } },
      { key: sr.getCmKey('markupMono') || 'Mod-Shift-`', run: () => { this._wrapInlineMarkup('mono'); return true; } },
      { key: sr.getCmKey('markupLink') || 'Mod-k',   run: () => { this._insertLink(); return true; } },
      { key: sr.getCmKey('alignTable') || 'Alt-Shift-t', run: () => { this._alignTable(); return true; } },
      // vim 模式下 Ctrl-F/Ctrl-B 在插入模式做翻页（普通模式由 vim 自身处理）
      ...(this._vimEnabled ? [
        { key: 'Mod-f', run: () => { if (this._view) cursorPageDown(this._view); return true; } },
        { key: 'Mod-b', run: () => { if (this._view) cursorPageUp(this._view); return true; } },
      ] : []),
    ].filter(b => b.key);
    this._view.dispatch({
      effects: keymapCompartment.reconfigure(keymap.of(bindings)),
    });
  }

  // ─── Vim 模式 ───

  async _toggleVimMode() {
    const newState = !this._vimEnabled;
    this._applyVimMode(newState, this._vimEscapeSeq || 'jk');
    // 持久化到配置
    try {
      const ed = await loadEditorConfig();
      ed.vim_mode = newState;
      ed.vim_escape_seq = this._vimEscapeSeq || 'jk';
      await saveEditorConfig(ed);
    } catch { /* ignore */ }
  }

  _applyVimMode(enabled, escapeSeq = 'jk') {
    if (!this._view) return;
    this._vimEnabled = enabled;
    if (enabled) {
      // 清除旧的插入模式映射，注册新的
      if (this._vimEscapeSeq && this._vimEscapeSeq.length >= 2) {
        Vim.unmap(this._vimEscapeSeq, 'insert');
      }
      this._vimEscapeSeq = escapeSeq;
      if (escapeSeq && escapeSeq.length >= 2) {
        Vim.map(escapeSeq, '<Esc>', 'insert');
      }
      // 注册 Ex 命令（全局注册，幂等）
      Vim.defineEx('w', 'w', (cm) => this._saveFile());
      Vim.defineEx('q', 'q', () => eventBus.emit('close-active-tab'));
      // 激活 vim 扩展
      // 不使用 status: true — 因为 CM6 panel 系统在 compartment reconfigure 时
      // 先于 vimPlugin constructor 执行，此时 view.cm 不存在，statusPanel 会失败。
      // 改用默认模式：dialog 需要时通过 showVimPanel effect 动态创建 panel。
      this._view.dispatch({
        effects: vimCompartment.reconfigure(vim()),
      });
      // 绑定模式变化 handler 并通知初始模式（切文档后 cm 重建，需重新绑定，见 _reattachVimHandler）
      this._reattachVimHandler();
    } else {
      // 清除插入模式映射
      if (this._vimEscapeSeq && this._vimEscapeSeq.length >= 2) {
        Vim.unmap(this._vimEscapeSeq, 'insert');
      }
      this._vimEscapeSeq = null;
      // 移除模式监听
      if (this._vimModeChangeHandler) {
        const cm = getCM(this._view);
        if (cm) cm.off('vim-mode-change', this._vimModeChangeHandler);
        this._vimModeChangeHandler = null;
      }
      this._view.dispatch({
        effects: vimCompartment.reconfigure([]),
      });
      this._lastVimMode = '';
      eventBus.emit('vim-mode-changed', '');
    }
    // vim 模式下过滤 Enter/Backspace/Delete，避免标准键位在 normal 模式直接修改内容
    this._view.dispatch({
      effects: baseKeymapCompartment.reconfigure(keymap.of(_buildBaseKeymap(enabled))),
    });
    // vim 状态变更后刷新自定义快捷键（Ctrl-B/Ctrl-F 绑定取决于 vim 开关）
    this._applyShortcutKeymap(shortcutRegistry);
  }

  /** 把 vim 模式变化 handler 绑到当前 view 的 cm，并立即同步一次模式。
   *  每次 setState（切文档）会销毁旧 vim 插件实例、创建新的 CodeMirror facade，
   *  旧 handler 随旧 cm 失效，必须重新绑定——否则状态栏 vim 模式指示器永久停在旧值。 */
  _reattachVimHandler() {
    if (!this._vimEnabled || !this._view) return;
    const cm = getCM(this._view);
    if (!cm) return;
    if (!this._vimModeChangeHandler) {
      this._vimModeChangeHandler = (e) => {
        if (!this._vimEnabled) return;
        const mode = e.mode || '';
        if (mode !== this._lastVimMode) {
          this._lastVimMode = mode;
          eventBus.emit('vim-mode-changed', mode);
        }
      };
    }
    // 先 off 再 on：cm 复用时去重，避免重复注册使回调多次触发；新 cm 上 off 为 no-op
    cm.off('vim-mode-change', this._vimModeChangeHandler);
    cm.on('vim-mode-change', this._vimModeChangeHandler);
    // 立即同步当前模式（setState 后 vim 重置为 normal）
    const mode = cm.state?.vim?.mode || 'normal';
    if (mode !== this._lastVimMode) {
      this._lastVimMode = mode;
      eventBus.emit('vim-mode-changed', mode);
    }
  }

  /** 通过 Vim.handleKey 切换 Vim 子模式 */
  _setVimSubmode(mode) {
    if (!this._view || !this._vimEnabled) return;
    const cm = getCM(this._view);
    if (!cm) return;
    if (!cm.state?.vim) return;
    if (mode === 'normal') {
      Vim.handleKey(cm, '<Esc>');
    } else if (mode === 'insert') {
      Vim.handleKey(cm, '<Esc>');
      Vim.handleKey(cm, 'i');
    } else if (mode === 'visual') {
      Vim.handleKey(cm, '<Esc>');
      Vim.handleKey(cm, 'v');
    }
  }

  // ─── 格式感知的标记操作辅助方法 ───

  _updateFormat(path, { switchLanguage = true } = {}) {
    this._currentFormat = getFormat(path);
    // untitled 文件默认为 AsciiDoc 格式
    if (!this._currentFormat && path?.startsWith('__untitled_')) {
      this._currentFormat = getFormat('placeholder.adoc');
    }
    _currentFormatId = this._currentFormat?.id || null;
    eventBus.emit('file-format-changed', this._currentFormat);
    // 切换文档时语言由 _applyDynamicConfig（setState 之后）统一应用；若在此处先切，
    // _switchLanguage 会作用于尚未切换的旧文档 state，污染其缓存的 language compartment。
    if (switchLanguage) this._switchLanguage();
  }

  async _switchLanguage() {
    if (!this._view) return;
    const targetFormat = this._currentFormat?.id;
    if (this._lastSwitchedFormat === targetFormat) return;
    if (targetFormat === 'md') {
      const { markdown } = await import('@codemirror/lang-markdown');
      // await 后格式可能已再次切换，检查是否仍然需要 md
      if (this._currentFormat?.id !== 'md') return;
      this._lastSwitchedFormat = 'md';
      this._view.dispatch({
        effects: [
          languageCompartment.reconfigure(markdown()),
          completionCompartment.reconfigure(autocompletion({ override: [] })),
        ],
      });
    } else {
      this._lastSwitchedFormat = targetFormat || 'adoc';
      this._view.dispatch({
        effects: [
          languageCompartment.reconfigure(asciidocLanguage()),
          completionCompartment.reconfigure(autocompletion({ override: [asciidocCompletions] })),
        ],
      });
    }
  }

  _toggleComment() {
    if (!this._view || !this._currentFormat?.comment?.line) return;
    toggleLineComment(this._view, this._currentFormat.comment.line);
  }

  _toggleBlockComment() {
    if (!this._view || !this._currentFormat?.comment) return;
    toggleBlockComment(this._view, this._currentFormat.comment.blockOpen, this._currentFormat.comment.blockClose);
  }

  _wrapInlineMarkup(id) {
    if (!this._view || !this._currentFormat) return;
    const def = this._currentFormat.inlineMarkup.find(m => m.id === id);
    if (def) wrapInline(this._view, def.open, def.close, t('markup.placeholder'));
  }

  _insertLink() {
    if (!this._view || !this._currentFormat?.linkInsert) return;
    this._currentFormat.linkInsert(this._view);
  }

  _insertHeading(level) {
    if (!this._view || !this._currentFormat?.heading) return;
    insertHeading(this._view, this._currentFormat.heading.prefix, level);
  }

  _insertBlockById(id) {
    if (!this._view || !this._currentFormat?.blocks) return;
    const def = this._currentFormat.blocks.find(b => b.id === id);
    if (def) insertBlock(this._view, def.before, def.after, '');
  }

  _alignTable() {
    if (!this._view || !this._currentFormat?.tableAlign) return;
    this._currentFormat.tableAlign(this._view);
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
    this._wordWrap = enabled;
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

  // Ctrl+G 跳转到行 — 内联浮动输入框
  _showGotoLine() {
    if (!this._view) return;
    // 已有则聚焦
    if (this._gotoLineEl) {
      this._gotoLineEl.querySelector('input')?.focus();
      return;
    }
    const curLine = this._view.state.doc.lineAt(this._view.state.selection.main.head).number;
    const total = this._view.state.doc.lines;

    const overlay = document.createElement('div');
    overlay.className = 'goto-line-overlay';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `${t('editor.gotoLinePrompt')} (${curLine}/${total})`;
    overlay.appendChild(input);

    const close = () => {
      this._gotoLineEl = null;
      overlay.remove();
      this._view?.focus();
    };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 阻止 CM6 捕获按键
      if (e.key === 'Enter') {
        const line = parseInt(input.value.trim());
        if (!isNaN(line) && line >= 1) this._jumpToLine(line);
        close();
      } else if (e.key === 'Escape') {
        close();
      }
    });
    input.addEventListener('blur', () => close());

    const container = this.shadowRoot.querySelector('div');
    if (container) {
      container.style.position = 'relative';
      container.appendChild(overlay);
    }
    this._gotoLineEl = overlay;
    requestAnimationFrame(() => input.focus());
  }

  _openFindReplace() {
    if (this._view) openSearchPanel(this._view);
  }

  /** 切换到指定文档：恢复其独立的 EditorState（含独立 history/撤销栈与光标位置）。
   *  首次打开则用 content 创建新 state 并缓存。setState 后重应用动态配置，因为缓存的旧
   *  state 持有的是创建时刻的 compartment 值（主题/换行/vim/语言等可能此后已变化）。 */
  _switchToDoc(path, content) {
    if (!this._view) return;
    // 先保存当前文档的 state（用尚未切换的 _currentPath 作 key），再切换路径标识，
    // 否则 capture 会把旧文档的 state 写到新路径的 key 上，导致切换错乱。
    this._captureCurrentState();
    this._currentPath = path;
    // 惰性回收已关闭文档的缓存（关闭 tab 走 file-opened 分支时不触发 file-closed）
    this._reapDocStates();
    let state = this._docStates.get(path);
    if (!state) {
      state = EditorState.create({
        doc: content ?? '',
        extensions: this._editorExtensions(),
      });
      this._docStates.set(path, state);
    }
    this._updatingFromExternal = true;
    this._view.setState(state);
    this._updatingFromExternal = false;
    this._applyDynamicConfig();
    // 恢复滚动位置：setState 重建 docView 会把 scrollTop 钳为 0，需在重排后还原
    const savedScroll = this._docScroll.get(path);
    if (savedScroll) {
      requestAnimationFrame(() => {
        if (this._view) this._view.scrollDOM.scrollTop = savedScroll;
      });
    }
  }

  /** 把当前 view 上的 state（含其 history/光标/滚动）写回缓存，供下次切回复原。
   *  仅当该文档仍处于打开状态时才保存（关闭/另存为后旧路径不应再残留缓存）。 */
  _captureCurrentState() {
    if (this._currentPath && this._view && editorState.getFile(this._currentPath)) {
      this._docStates.set(this._currentPath, this._view.state);
      // 一并保存滚动位置（EditorState 不含 scrollTop，切回复原需旁路记录）
      this._docScroll.set(this._currentPath, this._view.scrollDOM.scrollTop);
    }
  }

  /** 回收不再打开的文档缓存，避免关闭 tab 后残留 state（内存泄漏） */
  _reapDocStates() {
    for (const p of this._docStates.keys()) {
      if (!editorState.getFile(p)) {
        this._docStates.delete(p);
        this._docScroll.delete(p);
      }
    }
  }

  /** setState 之后重应用所有可变 compartment：reconfigure 只作用于当前 view，缓存的旧 state
   *  不会自动跟随全局配置变化，故每次切文档后需手动同步一次，避免「换 tab 后主题/快捷键回退」。 */
  _applyDynamicConfig() {
    if (!this._view) return;
    this._view.dispatch({
      effects: [
        themeCompartment.reconfigure(this._theme === 'dark' ? oneDark : []),
        wrapCompartment.reconfigure(this._wordWrap ? EditorView.lineWrapping : []),
        phrasesCompartment.reconfigure(EditorState.phrases.of(buildCmPhrases())),
        vimCompartment.reconfigure(this._vimEnabled ? vim() : []),
        baseKeymapCompartment.reconfigure(keymap.of(_buildBaseKeymap(this._vimEnabled))),
      ],
    });
    // 自定义快捷键（含 vim 相关的 Ctrl-B/Ctrl-F 绑定）
    this._applyShortcutKeymap(shortcutRegistry);
    // 语言/补全：绕过 _lastSwitchedFormat 缓存，强制按当前格式重设
    this._lastSwitchedFormat = null;
    this._switchLanguage();
    // vim：setState 重建了 vim 插件与新 CodeMirror facade，需重新绑定模式监听
    this._reattachVimHandler();
  }

  /** 无打开文件时的占位：显示空文档（不进入 _docStates 缓存） */
  _showEmptyState() {
    if (!this._view) return;
    this._updatingFromExternal = true;
    this._view.setState(EditorState.create({
      doc: '',
      extensions: this._editorExtensions(),
    }));
    this._updatingFromExternal = false;
    this._applyDynamicConfig();
  }

  async _openFile(path, content, binary) {
    clearTimeout(this._autoSaveTimer);
    // _currentPath 不在此处设置：交由 _switchToDoc 在保存旧文档 state 后切换
    // 同时支持显式 binary 标志和扩展名检测（tab 切换不带 binary 标志）
    this._isBinary = !!(binary || isBinaryFile(path));
    // 二进制文件：自动切预览模式（通过 set-view-mode 触发 app-shell 布局更新）
    if (this._isBinary) {
      if (this._viewModeBeforeBinary == null) {
        this._viewModeBeforeBinary = this._viewMode || 'split';
      }
      eventBus.emit('set-view-mode', 'preview');
    } else if (this._viewModeBeforeBinary != null) {
      eventBus.emit('set-view-mode', this._viewModeBeforeBinary);
      this._viewModeBeforeBinary = null;
    }
    this._updateFormat(path, { switchLanguage: false });
    this._switchToDoc(path, content);
    eventBus.emit('content-changed', content);
    // 记录文件 mtime 用于外部修改检测
    this._fileMtime = null;
    if (path && !path.startsWith('__untitled_')) {
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
      if (linkIndex.ready) await linkIndex.ready;
      const bls = await linkIndex.getBacklinks(path);
      if (bls.length > 0) {
        eventBus.emit('show-backlinks');
      }
      // 记录最近文件
      addRecentFile(path, editorState.workspaceRoot || undefined).catch(() => {});
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
    this._theme = theme;
    this._view.dispatch({
      effects: themeCompartment.reconfigure(theme === 'dark' ? oneDark : []),
    });
  }

  _insertText(text, range) {
    if (!this._view) return;
    // 有 range 时替换指定范围（AI 改写「接受」还原原选区），否则替换当前选区（普通插入）
    const { from, to } = range || this._view.state.selection.main;
    this._view.dispatch({
      changes: { from, to, insert: text },
    });
    this._view.focus();
  }

  async _saveFile() {
    if (this._isBinary) return;
    if (!this._view) return;
    const content = this._view.state.doc.toString();

    // 新文件或未保存的临时文件，弹出另存为
    if (!this._currentPath || this._currentPath.startsWith('__untitled_')) {
      try {
        const dir = this._getDefaultSaveDir();
        const ext = this._currentFormat?.id === 'md' ? 'md' : 'adoc';
        const name = this._extractTitle(content) || 'untitled';
        const defaultName = `${name}.${ext}`;
        const savePath = await pickSaveFile(dir, defaultName);
        if (!savePath) return;
        this._saving = true;
        await writeFile(savePath, content);
        // 记住旧路径用于清理 draft
        const oldPath = this._currentPath;
        this._currentPath = savePath;
        // 迁移独立 state 与滚动位置到新路径（保留编辑 history）
        for (const map of [this._docStates, this._docScroll]) {
          if (oldPath && map.has(oldPath)) {
            map.set(savePath, map.get(oldPath));
            map.delete(oldPath);
          }
        }
        // 先注册新路径（activeFilePath → savePath），再关闭旧 untitled 条目，
        // 避免 closeFile 提前把焦点切到相邻 tab，缩小 _currentPath 与 activeFilePath 不一致窗口
        editorState.openFile(savePath, content);
        if (oldPath && oldPath.startsWith('__untitled_')) {
          editorState.closeFile(oldPath);
        }
        editorState.markSaved(savePath);
        eventBus.emit('file-saved', { path: savePath, content });
        if (editorState.workspaceRoot) eventBus.emit('workspace-opened', editorState.workspaceRoot);
        this._cleanupDraft(oldPath);
        this._fileMtime = await getFileMtime(savePath).catch(() => null);
      } catch (e) {
        console.error('保存失败:', e);
      } finally {
        this._saving = false;
      }
      return;
    }

    try {
      this._saving = true;
      await writeFile(this._currentPath, content);
      editorState.markSaved(this._currentPath);
      eventBus.emit('file-saved', { path: this._currentPath, content });
      this._fileMtime = await getFileMtime(this._currentPath).catch(() => null);
      this._cleanupDraft();
    } catch (e) {
      console.error('保存失败:', e);
    } finally {
      this._saving = false;
    }
  }

  /** 文件保存后清理对应的 draft 文件 */
  async _cleanupDraft(extraPath) {
    const paths = new Set([this._currentPath]);
    if (extraPath) paths.add(extraPath);
    if (!paths.size) return;
    try {
      const ws = editorState.workspaceRoot;
      if (!ws) return;
      const wsState = await loadWorkspaceState(ws);
      if (!wsState || !wsState.tabs) return;
      let changed = false;
      for (const tab of wsState.tabs) {
        if (paths.has(tab.path) && tab.draft_path) {
          try { await deleteFile(tab.draft_path); } catch (_) {}
          tab.draft_path = '';
          tab.is_dirty = false;
          changed = true;
        }
      }
      if (changed) await saveWorkspaceState(ws, wsState);
    } catch (_) {}
  }

  /** 从内容提取第一个标题作为文件名（去掉不合法字符） */
  _extractTitle(content) {
    if (!content) return null;
    for (const line of content.split('\n')) {
      const t = line.trim();
      // AsciiDoc: = Title 或 == Title（取第一个 =）
      const adoc = t.match(/^={1,2}\s+(.+)$/);
      if (adoc) return adoc[1].replace(/[/\\:*?"<>|]/g, '_').trim();
      // Markdown: # Title
      const md = t.match(/^#\s+(.+)$/);
      if (md) return md[1].replace(/[/\\:*?"<>|]/g, '_').trim();
    }
    return null;
  }

  /** 获取默认保存目录：
   *  1. 当前活动文件所在目录（非 untitled）
   *  2. 其他已打开的非 untitled tab 所在目录
   *  3. 文件树最近展开的目录
   *  4. 工作区根目录 */
  _getDefaultSaveDir() {
    // 从所有已打开 tab 中找第一个非 untitled 的路径
    const candidates = [editorState.activeFilePath, ...editorState.tabOrder];
    for (const p of candidates) {
      if (p && !p.startsWith('__untitled_')) {
        const idx = p.lastIndexOf('/');
        if (idx > 0) return p.substring(0, idx);
      }
    }
    const fileTree = document.querySelector('sidebar-filetree');
    if (fileTree?.expanded?.size) {
      // expanded 是 Set，顺序为插入序，取最后一个即最近展开的
      const arr = Array.from(fileTree.expanded);
      // 过滤掉根目录本身，优先用子目录
      const sub = arr.filter(d => d !== editorState.workspaceRoot);
      if (sub.length) return sub[sub.length - 1];
      return arr[arr.length - 1];
    }
    return editorState.workspaceRoot || '';
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
    clearTimeout(this._autoSaveTimer);
    this._untitledCounter++;
    const path = `__untitled_${this._untitledCounter}_${Date.now()}`;
    editorState.openFile(path, content);
    // 先更新格式再设置内容：includeLinkPlugin 在 docChanged 时按 _currentFormatId 重建装饰
    this._updateFormat(path, { switchLanguage: false });
    this._switchToDoc(path, content);
    eventBus.emit('content-changed', content);
    this._view?.focus();
  }

  _onFileRenamed(oldPath, newPath) {
    // 迁移独立 state 与滚动位置缓存到新路径（保留其 history）
    for (const map of [this._docStates, this._docScroll]) {
      if (map.has(oldPath)) {
        map.set(newPath, map.get(oldPath));
        map.delete(oldPath);
      }
    }
    if (this._currentPath === oldPath) {
      this._currentPath = newPath;
      this._updateFormat(newPath);
    }
  }

  _onFileClosed(path) {
    // 丢弃被关闭文档的独立 state（含其 history）
    this._docStates.delete(path);
    if (this._currentPath === path) {
      this._isBinary = false;
      const active = editorState.getActiveFile();
      if (active) {
        this._openFile(active.path, active.content);
      } else {
        this._currentPath = null;
        this._showEmptyState();
      }
    }
  }

  // 外部文件修改检测
  async _checkExternalChange() {
    if (!this._currentPath || this._currentPath.startsWith('__untitled_')) return;
    if (!this._fileMtime) return;
    if (this._saving) return;
    try {
      const mtime = await getFileMtime(this._currentPath);
      if (mtime !== this._fileMtime) {
        const reload = await showConfirm(t('editor.fileChanged'));
        if (reload) {
          await this._reloadFromDisk();
        } else {
          // 用户拒绝重载：标记冲突（保存会覆盖外部改动），并更新 mtime 避免同一版本反复弹框。
          // 文件若再次被外部修改（mtime 再次变化）会重新提示；
          // 用户可随时通过 tab 红点 / 状态栏手动「从磁盘重新加载」反悔。
          editorState.markExternalConflict(this._currentPath, true);
          this._fileMtime = mtime;
        }
      }
    } catch (_) {}
  }

  /** 从磁盘重新加载当前文件（接受外部修改）：内容覆盖内存并视为干净，清除冲突标记。
   *  外部覆盖后旧 history（撤销栈指向被覆盖的旧内容）已无意义，故重建 state 丢弃之。 */
  async _reloadFromDisk() {
    const path = this._currentPath;
    if (!path || path.startsWith('__untitled_')) return;
    if (this._isBinary) return;
    try {
      const content = await readFile(path);
      // await 期间可能已切换文档：仅当目标仍是当前文档时才上屏，避免把内容写到别的文档
      const isCurrent = this._currentPath === path;
      const state = EditorState.create({
        doc: content,
        extensions: this._editorExtensions(),
      });
      this._docStates.set(path, state);
      if (isCurrent) {
        this._updatingFromExternal = true;
        this._view.setState(state);
        this._updatingFromExternal = false;
        this._applyDynamicConfig();
      }
      // reloadContent 同步内存内容、清 isDirty 与 hasExternalConflict（内容已与磁盘一致）
      editorState.reloadContent(path, content);
      if (isCurrent) {
        eventBus.emit('content-changed', content);
        this._fileMtime = await getFileMtime(path).catch(() => null);
      }
    } catch (_) {}
  }

  /** 手动触发某文件从磁盘重新加载（tab 右键 / 状态栏点击）：先切到目标 tab 再重载 */
  async _reloadFromDiskPath(path) {
    if (!path) return;
    if (path !== this._currentPath) {
      const file = editorState.getFile(path);
      if (!file) return;
      editorState.setActiveFile(path);
      // emit 后 _openFile 同步设置 _currentPath；_reloadFromDisk 内部自读 mtime，无时序依赖
      eventBus.emit('file-opened', { path, content: file.content });
    }
    await this._reloadFromDisk();
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

  /** 返回当前选区 {from, to, text}；无视图返回 null。供 AI 改写「接受」精确还原原选区 */
  getSelectionRange() {
    if (!this._view) return null;
    const { from, to } = this._view.state.selection.main;
    return { from, to, text: this._view.state.doc.sliceString(from, to) };
  }

  /** 返回当前文档全文（CodeMirror 真相源，实时）；无视图返回空串。供 AI 续写/总结读上下文 */
  getDocumentContent() {
    return this._view ? this._view.state.doc.toString() : '';
  }

  render() {
    return '';
  }
}

customElements.define('editor-pane', EditorPane);
