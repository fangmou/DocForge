import { approxTokens } from './token-count.js';
import { AI_ACTIONS } from './ai-service.js';

/**
 * AI 请求上下文构造（纯函数）。
 *
 * 策略：选区优先 + 全文兜底；上下文用 XML 标记包装（借鉴 terax composer），
 * 让模型清晰区分「用户指令」与「附加上下文」；system prompt 按当前文档格式
 * 注入并精炼输出规范。返回 userMessage（作为多轮对话的新一轮 user 消息）。
 */

const MAX_CONTEXT_TOKENS = 6000;
const OUTPUT_RULE = '直接输出结果，不要解释、复述原文或寒暄。';
// 方案 B：从源头降低模型用 ```adoc / ```md 围栏包裹整篇输出的概率（方案 A 的后处理兜底仍保留）
const FENCE_RULE = '不要用代码围栏（```…```）包裹整篇输出。';
const EMPTY_DOC_HINT = '（当前文档为空，请直接开始写作。）';

function formatName(formatId) {
  if (formatId === 'md') return 'Markdown';
  if (formatId === 'adoc') return 'AsciiDoc';
  return null;
}

/** 截断到 maxTokens，保留头部；按 UTF-8 字节切片不破多字节字符 */
export function truncateForContext(text, maxTokens = MAX_CONTEXT_TOKENS) {
  if (!text) return '';
  const maxBytes = maxTokens * 4;
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, maxBytes));
  return `${head}\n\n[...内容过长，已截断保留前 ${maxTokens} tokens...]`;
}

/** 包装上下文为 XML 标记块 */
function wrapContext(contextText, formatId, fromSelection) {
  if (!contextText) return '';
  if (fromSelection) return `<selection>\n${contextText}\n</selection>`;
  const fmtAttr = formatName(formatId) ? ` format="${formatId}"` : '';
  return `<document${fmtAttr}>\n${contextText}\n</document>`;
}

/** system prompt 精炼 + 格式注入（summarize 原硬编码 AsciiDoc 动态化） */
export function composeSystemPrompt(action, formatId) {
  let base = action.systemPrompt.replace(
    /使用\s*[Aa]scii[Dd]oc\s*格式输出/,
    '使用{FMT}格式输出',
  );
  if (!/直接输出/.test(base)) base += ` ${OUTPUT_RULE}`;
  const fmt = formatName(formatId);
  if (fmt) {
    base = base.replace(/\{FMT\}/g, fmt);
    // 已含该格式名则不重复追加（summarize 经 {FMT} 替换后已含）
    if (!base.includes(fmt)) base += ` 输出需遵循${fmt}语法。`;
  } else {
    // formatId 为 null（纯文本）：去掉 summarize 的 {FMT} 占位
    base = base.replace(/使用\{FMT\}格式输出。?\s*/g, '');
  }
  base += ` ${FENCE_RULE}`;
  return base.trim();
}

/** 选区优先 + 全文兜底（截断） */
function pickContext({ selected, fullContent }) {
  const sel = selected && selected.trim();
  if (sel) return { context: sel, original: sel, fromSelection: true };
  return {
    context: truncateForContext(fullContent || ''),
    original: '',
    fromSelection: false,
  };
}

/** 通用场景请求构造（内置与自定义场景同构）。
 * scene 需含 { systemPrompt, behavior }；behavior='rewrite' 时无选区也取截断全文作 diff 原文，
 * 使整篇润色/翻译/完善都能对比修改；generate 类无 diff。
 */
export function buildSceneRequest(scene, ctx) {
  const { context, original, fromSelection } = pickContext(ctx);
  const block = wrapContext(context, ctx.formatId, fromSelection);
  let diffOriginal = original;
  if (!diffOriginal && scene.behavior === 'rewrite') {
    diffOriginal = context;
  }
  return {
    userMessage: block || EMPTY_DOC_HINT,
    systemPrompt: composeSystemPrompt(scene, ctx.formatId),
    original: diffOriginal,
  };
}

/** 内置场景：按 actionKey 查 AI_ACTIONS 后委托 buildSceneRequest（未知 key 返回 null） */
export function buildAiRequest(actionKey, ctx) {
  const action = AI_ACTIONS[actionKey];
  if (!action) return null;
  return buildSceneRequest(action, ctx);
}

/** 自由输入：instruction + 上下文块 */
export function buildCustomRequest(instruction, ctx) {
  const instructionText = (instruction || '').trim();
  const { context, original, fromSelection } = pickContext(ctx);
  const block = wrapContext(context, ctx.formatId, fromSelection);
  const userMessage = block ? `${instructionText}\n\n${block}` : instructionText;
  const fmt = formatName(ctx.formatId);
  const fmtClause = fmt ? ` 输出需遵循${fmt}语法。` : '';
  return {
    userMessage,
    systemPrompt: `你是一个写作助手。请根据用户指令处理提供的内容。${OUTPUT_RULE} ${FENCE_RULE}${fmtClause}`,
    original,
  };
}

export const MAX_CONTEXT_TOKENS_VALUE = MAX_CONTEXT_TOKENS;
