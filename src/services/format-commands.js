/**
 * format-commands.js — 格式感知的编辑命令服务
 *
 * 提供：
 * - 格式注册表（AsciiDoc / Markdown）
 * - 通用编辑函数（行内包裹、注释、标题、列表、块级、片段）
 * - 格式特定函数（链接、表格对齐等）
 */

// ─── 格式注册表 ──────────────────────────────────────────────

const FORMAT_REGISTRY = new Map();

// ─── 文件类别检测 ──────────────────────────────────────────────

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tiff', 'tif']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv']);
const BINARY_EXTS = new Set([...IMAGE_EXTS, ...AUDIO_EXTS, ...VIDEO_EXTS, 'pdf']);

/**
 * 根据文件扩展名判断是否为二进制文件（不可作为文本编辑）
 * @param {string} filePath
 * @returns {boolean}
 */
export function isBinaryFile(filePath) {
  if (!filePath) return false;
  const ext = filePath.split('.').pop()?.toLowerCase();
  return BINARY_EXTS.has(ext);
}

/**
 * 根据文件路径返回预览类别
 * @param {string} filePath
 * @returns {'markup'|'svg'|'html'|'image'|'audio'|'video'|'pdf'|'text'|'unknown'}
 */
export function getFileCategory(filePath) {
  if (!filePath) return 'unknown';
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'svg') return 'svg';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'adoc' || ext === 'asciidoc' || ext === 'md' || ext === 'markdown') return 'markup';
  return 'text';
}

/**
 * 根据文件路径返回格式定义
 * @param {string} filePath
 * @returns {object|null}
 */
export function getFormat(filePath) {
  if (!filePath) return null;
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'adoc' || ext === 'asciidoc') return FORMAT_REGISTRY.get('adoc');
  if (ext === 'md' || ext === 'markdown') return FORMAT_REGISTRY.get('md');
  return null;
}

// ─── 通用编辑函数 ────────────────────────────────────────────

/**
 * 行内标记包裹/解包
 * 无选区时插入 open+placeholder+close；有选区时包裹，已包裹则解包
 */
export function wrapInline(view, open, close, placeholder = '') {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  if (from === to) {
    // 无选区：插入占位文本
    const text = open + placeholder + close;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + open.length, head: from + open.length + placeholder.length },
    });
  } else {
    const selected = view.state.doc.sliceString(from, to);
    // 检测是否已包裹
    if (selected.startsWith(open) && selected.endsWith(close) && selected.length >= open.length + close.length) {
      // 解包
      const inner = selected.slice(open.length, selected.length - close.length);
      view.dispatch({
        changes: { from, to, insert: inner },
        selection: { anchor: from, head: from + inner.length },
      });
    } else {
      // 包裹
      view.dispatch({
        changes: { from, to, insert: open + selected + close },
        selection: { anchor: from + open.length, head: to + open.length },
      });
    }
  }
  view.focus();
}

/**
 * 行注释切换（参数化）
 * @param {EditorView} view
 * @param {string} lineComment - 行注释前缀如 '// '
 */
export function toggleLineComment(view, lineComment) {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;

  // 确定受影响的行范围
  const startLine = doc.lineAt(from).number;
  const endLine = doc.lineAt(to).number;

  const changes = [];
  let allCommented = true;

  for (let i = startLine; i <= endLine; i++) {
    const line = doc.line(i);
    const text = line.text;
    // 跳过空行和块注释分隔符
    if (text.trim() === '' || text.trimStart().startsWith('////')) continue;
    if (!text.trimStart().startsWith(lineComment.trimStart())) {
      allCommented = false;
      break;
    }
  }

  for (let i = startLine; i <= endLine; i++) {
    const line = doc.line(i);
    const text = line.text;
    if (text.trim() === '' || text.trimStart().startsWith('////')) continue;

    const indent = text.length - text.trimStart().length;
    const content = text.trimStart();

    if (allCommented) {
      // 移除注释
      if (content.startsWith(lineComment.trimStart())) {
        const commentLen = lineComment.trimStart().length;
        const afterComment = content.slice(commentLen);
        changes.push({ from: line.from + indent, to: line.to, insert: afterComment });
      }
    } else {
      // 添加注释
      changes.push({ from: line.from + indent, to: line.from + indent, insert: lineComment });
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  view.focus();
}

/**
 * 块注释切换（参数化）
 * @param {EditorView} view
 * @param {string} openTag - 如 '////'
 * @param {string} closeTag - 如 '////'
 */
export function toggleBlockComment(view, openTag, closeTag) {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;

  if (from === to) {
    // 无选区：在当前行前后插入块注释包裹
    const line = doc.lineAt(from);
    const before = (line.number > 1 ? '\n' : '') + openTag + '\n';
    const after = '\n' + closeTag + '\n';
    view.dispatch({
      changes: [
        { from: line.from, to: line.from, insert: before },
        { from: line.to, to: line.to, insert: after },
      ],
      selection: { anchor: line.from + before.length },
    });
  } else {
    // 有选区：检测是否已被包裹
    const beforeLine = doc.lineAt(from);
    const afterLine = doc.lineAt(to);
    // 检查选区前一行是否是 openTag，后一行是否是 closeTag
    const prevLine = beforeLine.number > 1 ? doc.line(beforeLine.number - 1) : null;
    const nextLine = afterLine.number < doc.lines ? doc.line(afterLine.number + 1) : null;

    const isWrapped = prevLine && nextLine
      && prevLine.text.trim() === openTag
      && nextLine.text.trim() === closeTag;

    if (isWrapped) {
      // 移除包裹
      view.dispatch({
        changes: [
          { from: prevLine.from, to: prevLine.to + 1, insert: '' },
          { from: nextLine.from - 1, to: nextLine.to, insert: '' },
        ],
      });
    } else {
      // 添加包裹
      view.dispatch({
        changes: [
          { from, to: from, insert: openTag + '\n' },
          { from: to + openTag.length + 1, to: to + openTag.length + 1, insert: '\n' + closeTag },
        ],
      });
    }
  }
  view.focus();
}

/**
 * 标题级别设置/切换
 * @param {EditorView} view
 * @param {function} prefixFn - (level) => string
 * @param {number} level - 1-6
 */
export function insertHeading(view, prefixFn, level) {
  if (!view) return;
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const text = line.text;

  // 检测当前行是否已有标题前缀
  const adocHeadingMatch = text.match(/^(={1,6})\s+/);
  const mdHeadingMatch = text.match(/^(#{1,6})\s+/);
  const headingMatch = adocHeadingMatch || mdHeadingMatch;

  let newPrefix = prefixFn(level);
  let contentStart;

  if (headingMatch) {
    // 替换现有标题前缀
    contentStart = headingMatch[0].length;
    const content = text.slice(contentStart);
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newPrefix + content },
      selection: { anchor: line.from + newPrefix.length },
    });
  } else {
    // 在行首添加标题前缀
    const leadingSpaces = text.length - text.trimStart().length;
    const content = text.trimStart();
    newPrefix = ' '.repeat(leadingSpaces) + newPrefix;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newPrefix + content },
      selection: { anchor: line.from + newPrefix.length },
    });
  }
  view.focus();
}

/**
 * 列表标记切换
 * @param {EditorView} view
 * @param {string} marker - 如 '* '、'. '、'- '、'1. '
 */
export function toggleList(view, marker) {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const startLine = doc.lineAt(from).number;
  const endLine = doc.lineAt(to).number;

  const changes = [];

  // 检查是否所有行都已标记
  let allMarked = true;
  for (let i = startLine; i <= endLine; i++) {
    const text = doc.line(i).text;
    if (text.trim() !== '' && !text.trimStart().startsWith(marker)) {
      allMarked = false;
      break;
    }
  }

  for (let i = startLine; i <= endLine; i++) {
    const line = doc.line(i);
    const text = line.text;
    if (text.trim() === '') continue;

    const indent = text.length - text.trimStart().length;
    const content = text.trimStart();

    if (allMarked) {
      // 移除标记
      if (content.startsWith(marker)) {
        changes.push({
          from: line.from + indent,
          to: line.from + indent + marker.length,
          insert: '',
        });
      }
    } else {
      // 添加标记
      changes.push({
        from: line.from + indent,
        to: line.from + indent,
        insert: marker,
      });
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  view.focus();
}

/**
 * 块级结构插入
 * @param {EditorView} view
 * @param {string} before - 块前定界符
 * @param {string} after - 块后定界符
 * @param {string} placeholder - 占位文本
 */
export function insertBlock(view, before, after, placeholder = '') {
  if (!view) return;
  const { from, to } = view.state.selection.main;

  if (from === to) {
    // 无选区：插入空块模板
    const insert = before + placeholder + after;
    // 在当前行下方插入
    const line = view.state.doc.lineAt(from);
    const prefix = line.number < view.state.doc.lines ? '\n' : '';
    const newPos = line.to + prefix.length + before.length;
    view.dispatch({
      changes: { from: line.to, to: line.to, insert: prefix + insert + '\n' },
      selection: { anchor: newPos, head: newPos + placeholder.length },
    });
  } else {
    // 有选区：用块定界符包裹选中文本
    const selected = view.state.doc.sliceString(from, to);
    view.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: { anchor: from + before.length, head: from + before.length + selected.length },
    });
  }
  view.focus();
}

/**
 * 自定义片段插入
 * @param {EditorView} view
 * @param {string} template - 片段模板，支持 {selected} 占位符
 * @param {boolean} isInline - 是否行内（包裹选中文本）
 */
export function insertSnippet(view, template, isInline) {
  if (!view) return;
  const { from, to } = view.state.selection.main;

  if (template.includes('{selected}')) {
    if (from !== to) {
      // 有选区：替换 {selected} 为选中文本
      const selected = view.state.doc.sliceString(from, to);
      const result = template.replace('{selected}', selected);
      view.dispatch({
        changes: { from, to, insert: result },
        selection: { anchor: from + result.length },
      });
    } else {
      // 无选区：替换 {selected} 为空，光标定位到该位置
      const idx = template.indexOf('{selected}');
      const before = template.slice(0, idx);
      const after = template.slice(idx + '{selected}'.length);
      view.dispatch({
        changes: { from, to, insert: before + after },
        selection: { anchor: from + before.length },
      });
    }
  } else {
    // 无占位符：直接在光标处插入
    view.dispatch({
      changes: { from, to, insert: template },
      selection: { anchor: from + template.length },
    });
  }
  view.focus();
}

// ─── AsciiDoc 专用函数 ──────────────────────────────────────

/**
 * 插入 AsciiDoc 链接 link:url[text]
 */
export function insertAdocLink(view) {
  if (!view) return;
  const { from, to } = view.state.selection.main;

  if (from !== to) {
    // 有选区：将选中文本作为链接文本
    const selected = view.state.doc.sliceString(from, to);
    view.dispatch({
      changes: { from, to, insert: `link:url[${selected}]` },
      selection: { anchor: from + 5, head: from + 8 },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: 'link:url[text]' },
      selection: { anchor: from + 5, head: from + 8 },
    });
  }
  view.focus();
}

/**
 * AsciiDoc 表格列对齐
 */
export function alignAdocTable(view) {
  if (!view) return;
  const pos = view.state.selection.main.head;
  const doc = view.state.doc;
  const curLine = doc.lineAt(pos).number;

  // 找到光标所在的表格：从光标位置向上找 |===，再向下找配对的 |===
  let tableStart = -1;
  for (let i = curLine; i >= 1; i--) {
    if (doc.line(i).text.trim() === '|===') {
      tableStart = i;
      break;
    }
  }
  if (tableStart === -1) return;

  let tableEnd = -1;
  for (let i = tableStart + 1; i <= doc.lines; i++) {
    if (doc.line(i).text.trim() === '|===') {
      tableEnd = i;
      break;
    }
  }
  if (tableEnd === -1) return;

  // 确认光标在表格范围内
  if (pos < doc.line(tableStart).from || pos > doc.line(tableEnd).to) return;

  if (tableEnd <= tableStart + 1) return;

  // 解析表格数据行
  const dataLines = [];
  for (let i = tableStart + 1; i < tableEnd; i++) {
    const text = doc.line(i).text;
    if (text.trim() === '' || text.trim() === '|===') continue;
    dataLines.push({ lineNum: i, text });
  }

  if (dataLines.length === 0) return;

  // 按管道符分割单元格
  // AsciiDoc 表格：行首可选的 |，然后 | 分隔各列
  const rows = dataLines.map(dl => {
    const text = dl.text;
    const indent = text.length - text.trimStart().length;
    const trimmed = text.trimStart();
    // 跳过行首的 |
    const content = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
    // 按 | 分割
    const cells = content.split('|').map(c => c.trim());
    return { indent, cells, lineNum: dl.lineNum };
  });

  if (rows.length === 0) return;

  // 计算每列最大宽度
  const maxCols = Math.max(...rows.map(r => r.cells.length));
  const colWidths = [];
  for (let c = 0; c < maxCols; c++) {
    let maxW = 0;
    for (const row of rows) {
      if (c < row.cells.length) maxW = Math.max(maxW, row.cells[c].length);
    }
    colWidths.push(Math.max(maxW, 1));
  }

  // 重新生成对齐后的行
  const changes = [];
  for (const row of rows) {
    const alignedCells = [];
    for (let c = 0; c < maxCols; c++) {
      const cell = (row.cells[c] || '').trim();
      const padLen = colWidths[c] - cell.length;
      alignedCells.push(cell + ' '.repeat(Math.max(0, padLen)));
    }
    const newText = ' '.repeat(row.indent) + '| ' + alignedCells.join(' | ');
    const line = doc.line(row.lineNum);
    if (newText !== line.text) {
      changes.push({ from: line.from, to: line.to, insert: newText });
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  view.focus();
}

// ─── Markdown 专用函数 ──────────────────────────────────────

/**
 * 插入 Markdown 链接 [text](url)
 */
export function insertMdLink(view) {
  if (!view) return;
  const { from, to } = view.state.selection.main;

  if (from !== to) {
    const selected = view.state.doc.sliceString(from, to);
    view.dispatch({
      changes: { from, to, insert: `[${selected}](url)` },
      selection: { anchor: from + selected.length + 3, head: from + selected.length + 6 },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: '[text](url)' },
      selection: { anchor: from + 1, head: from + 5 },
    });
  }
  view.focus();
}

// ─── 格式定义注册 ────────────────────────────────────────────

FORMAT_REGISTRY.set('adoc', {
  id: 'adoc',
  inlineMarkup: [
    { id: 'bold', labelKey: 'markup.bold', open: '*', close: '*', shortcutId: 'markupBold' },
    { id: 'italic', labelKey: 'markup.italic', open: '_', close: '_', shortcutId: 'markupItalic' },
    { id: 'mono', labelKey: 'markup.mono', open: '`', close: '`', shortcutId: 'markupMono' },
    { id: 'highlight', labelKey: 'markup.highlight', open: '#', close: '#' },
    { id: 'superscript', labelKey: 'markup.superscript', open: '^', close: '^' },
    { id: 'subscript', labelKey: 'markup.subscript', open: '~', close: '~' },
  ],
  heading: { prefix: (level) => '='.repeat(level) + ' ', levels: 5 },
  listMarkers: [
    { id: 'unordered', labelKey: 'markup.unorderedList', marker: '* ' },
    { id: 'ordered', labelKey: 'markup.orderedList', marker: '. ' },
  ],
  comment: { line: '// ', blockOpen: '////', blockClose: '////' },
  linkInsert: insertAdocLink,
  tableAlign: alignAdocTable,
  blocks: [
    { id: 'source', labelKey: 'markup.sourceBlock', before: '[source]\n----\n', after: '\n----' },
    { id: 'quote', labelKey: 'markup.quoteBlock', before: '[quote]\n____\n', after: '\n____' },
    { id: 'example', labelKey: 'markup.exampleBlock', before: '====\n', after: '\n====' },
    { id: 'sidebar', labelKey: 'markup.sidebarBlock', before: '****\n', after: '\n****' },
    { id: 'literal', labelKey: 'markup.literalBlock', before: '....\n', after: '\n....' },
    { id: 'note', labelKey: 'markup.admonition.note', before: '[NOTE]\n====\n', after: '\n====' },
    { id: 'tip', labelKey: 'markup.admonition.tip', before: '[TIP]\n====\n', after: '\n====' },
    { id: 'warning', labelKey: 'markup.admonition.warning', before: '[WARNING]\n====\n', after: '\n====' },
    { id: 'important', labelKey: 'markup.admonition.important', before: '[IMPORTANT]\n====\n', after: '\n====' },
    { id: 'caution', labelKey: 'markup.admonition.caution', before: '[CAUTION]\n====\n', after: '\n====' },
  ],
});

FORMAT_REGISTRY.set('md', {
  id: 'md',
  inlineMarkup: [
    { id: 'bold', labelKey: 'markup.bold', open: '**', close: '**', shortcutId: 'markupBold' },
    { id: 'italic', labelKey: 'markup.italic', open: '*', close: '*', shortcutId: 'markupItalic' },
    { id: 'mono', labelKey: 'markup.mono', open: '`', close: '`', shortcutId: 'markupMono' },
    { id: 'strikethrough', labelKey: 'markup.strikethrough', open: '~~', close: '~~' },
  ],
  heading: { prefix: (level) => '#'.repeat(level) + ' ', levels: 6 },
  listMarkers: [
    { id: 'unordered', labelKey: 'markup.unorderedList', marker: '- ' },
    { id: 'ordered', labelKey: 'markup.orderedList', marker: '1. ' },
  ],
  comment: { line: null, blockOpen: '<!--', blockClose: '-->' },
  linkInsert: insertMdLink,
  tableAlign: null,
  blocks: [
    { id: 'source', labelKey: 'markup.sourceBlock', before: '```\n', after: '\n```' },
    { id: 'quote', labelKey: 'markup.quoteBlock', before: '> ', after: '' },
  ],
});
