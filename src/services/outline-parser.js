// 大纲解析：adoc/asciidoc 走 asciidoctor 权威解析（含 include 章节），其他格式回退 Rust 索引。
// 双 load 设计见 plan：预展开 load 拿全部标题、原始内容 secure load 拿本文件标题准确行号，按 id 合并。
import { getAsciidoctor } from './asciidoctor-instance.js';
import { linkIndex } from './link-index.js';
import { resolveIncludesIfAny } from './export-service.js';
import { getFormat } from './format-commands.js';

/** 解析文档大纲。
 *  返回 [{ id, level, text, line }]：level 归一化为 1-based；
 *  line 为本文件源码行号（用于定位编辑器），include 引入的标题 line=null（只滚预览）。 */
export async function parseOutline(content, filePath) {
  if (!content || !filePath) return [];
  if (getFormat(filePath)?.id === 'adoc') {
    try {
      return await parseAdoc(content, filePath);
    } catch (_) {
      // asciidoctor 解析异常时回退 Rust
    }
  }
  // md 及其他格式 / adoc 回退：用 Rust 索引（无 id，预览侧靠行号映射定位）
  if (linkIndex.ready) await linkIndex.ready;
  return linkIndex.getHeadings(filePath);
}

// 遍历 section AST，提取 {id, level, title, line}。line 来自 sourcemap（需 load 时传 sourcemap:true）。
function collectSections(doc) {
  const sections = (doc.findBy && doc.findBy({ context: 'section' })) || [];
  return sections.map((s) => {
    const cursor = s.getSourceLocation ? s.getSourceLocation() : null;
    let id = null;
    let title = '';
    try { if (s.getId) id = s.getId() || null; } catch (_) {}
    try { if (s.getTitle) title = s.getTitle() || ''; } catch (_) {}
    return {
      id,
      level: s.getLevel ? s.getLevel() : 1,
      title,
      line: cursor && cursor.getLineNumber ? cursor.getLineNumber() : null,
    };
  });
}

async function parseAdoc(content, filePath) {
  const ad = await getAsciidoctor();

  // (1) 预展开 include + load：全部标题（含 include 章节），id/level/title 来自权威解析
  const expanded = await resolveIncludesIfAny(content, filePath);
  const didExpand = expanded !== content;
  const all = collectSections(ad.load(expanded, { sourcemap: true, safe: 'safe' }));
  // 未真正展开 include 时，all 的 sourcemap 行号即本文件准确行号，无需第二次 load（短路，省一半解析开销）
  if (!didExpand) {
    return all.map((s) => ({ id: s.id, level: s.level + 1, text: s.title, line: s.line }));
  }

  // (2) 展开了 include：原始内容 + secure load 拿本文件标题准确行号（secure 模式禁 include，避免前端无 fs 报错）
  const orig = collectSections(ad.load(content, { sourcemap: true, safe: 'secure' }));
  const origLineById = new Map(); // id → 本文件行号
  const origNoId = [];            // 无 id 标题（主要是 document title），按序匹配
  for (const s of orig) {
    if (s.line == null) continue;
    if (s.id != null) { if (!origLineById.has(s.id)) origLineById.set(s.id, s.line); }
    else origNoId.push(s);
  }

  // (3) 合并：id 命中（或无 id 按序匹配）取本文件行号；其余（include 引入）line=null
  let noIdIdx = 0;
  return all.map((s) => {
    let line = null;
    if (s.id != null && origLineById.has(s.id)) {
      line = origLineById.get(s.id);
    } else if (s.id == null && noIdIdx < origNoId.length) {
      line = origNoId[noIdIdx++].line;
    }
    return { id: s.id, level: s.level + 1, text: s.title, line }; // level 0(doc title)→1，section N→N+1，与 md 对齐
  });
}
