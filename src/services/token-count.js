/**
 * 轻量 token 估算：UTF-8 字节数 / 4 向上取整。
 *
 * 精确分词需要具体模型的 tokenizer（重量级依赖，且每模型不同）。写作场景只需
 * 「量级感知」——提示上下文/成本趋势，字节估算足够且零依赖。借鉴 terax 的
 * approxBytes/4 经验值；对中文（UTF-8 3 字节/字）会略高估，可接受。
 */

/** 估算单段文本的 token 数 */
export function approxTokens(text) {
  if (!text) return 0;
  const bytes = new TextEncoder().encode(text).length;
  return Math.ceil(bytes / 4);
}

/** 估算一组消息内容的总 token（用于对话历史累计展示） */
export function approxMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, m) => sum + approxTokens(m?.content), 0);
}
