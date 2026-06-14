import { approxTokens } from './token-count.js';

/**
 * 对话历史 auto-compact（纯函数）。
 *
 * 借鉴 terax compact.ts 的阈值思想，适配写作场景：写作对话没有工具调用，大块
 * 上下文是 user 消息里的 <document>/<selection> 文档内容。超 55% contextLimit 时，
 * 把「当前轮之前」的 user 消息里的这些大块替换为占位（保留指令文本与 assistant 结果），
 * 直到降到阈值以下或无可压缩。当前轮（最后一条 user）始终完整保留——那是用户刚提供的。
 *
 * 仅压缩「发给模型的副本」，ai-panel 的显示历史不受影响。
 */

const DEFAULT_CONTEXT_LIMIT = 32000; // 保守，适配 8k–128k 模型的小端；后续可配置化
const ELISION = '[此前文档上下文已省略]';
// 匹配 <document ...>...</document> 或 <selection>...</selection>（非贪婪、跨行）
const CONTEXT_BLOCK_RE = /<(document|selection)\b[^>]*>[\s\S]*?<\/\1>/g;

function totalTokens(messages) {
  return messages.reduce((s, m) => s + approxTokens(m.content), 0);
}

function hasContextBlock(content) {
  CONTEXT_BLOCK_RE.lastIndex = 0;
  return CONTEXT_BLOCK_RE.test(content || '');
}

function elide(content) {
  return (content || '').replace(CONTEXT_BLOCK_RE, ELISION);
}

/**
 * @param {Array<{role:string,content:string}>} messages
 * @param {number} contextLimit 模型上下文 token 上限
 * @returns {{messages:Array, compacted:boolean, droppedCount:number}}
 */
export function compactMessages(messages, contextLimit = DEFAULT_CONTEXT_LIMIT) {
  // contextLimit <= 0 表示不压缩（用户配置为 0 / 不限）
  if (!contextLimit || contextLimit <= 0) {
    return { messages: messages.map((m) => ({ ...m })), compacted: false, droppedCount: 0 };
  }
  const working = messages.map((m) => ({ ...m }));
  const target = 0.55 * contextLimit;
  let tokens = totalTokens(working);

  if (tokens < target) {
    return { messages: working, compacted: false, droppedCount: 0 };
  }

  // 当前轮 = 最后一条 user 消息，必须完整保留；占位其之前的 user 上下文块
  let lastUserIdx = -1;
  for (let i = working.length - 1; i >= 0; i--) {
    if (working[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  let dropped = 0;
  for (let i = 0; i < lastUserIdx && tokens >= target; i++) {
    const m = working[i];
    if (m.role !== 'user' || !hasContextBlock(m.content)) continue;
    const before = approxTokens(m.content);
    m.content = elide(m.content);
    const after = approxTokens(m.content);
    if (after < before) {
      tokens -= before - after;
      dropped++;
    }
  }

  return { messages: working, compacted: dropped > 0, droppedCount: dropped };
}

export const COMPACT_DEFAULTS = { DEFAULT_CONTEXT_LIMIT, ELISION };
