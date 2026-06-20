const invoke = () => window.__TAURI__.core.invoke;

// 预设 AI 动作（内置场景）。
// labelKey 走 i18n（组件渲染用 t(action.labelKey)），label 为非 i18n 兜底；
// behavior 决定无选区时是否取全文作 diff 原文：rewrite=改写类（可对比修改），generate=生成类（无 diff）。
export const AI_ACTIONS = {
  continue: {
    labelKey: 'ai.action.continue',
    label: '续写',
    icon: '▶',
    behavior: 'generate',
    systemPrompt: '你是一个写作助手。请根据上下文自然地续写以下内容，保持风格一致。直接输出续写内容，不要解释。',
  },
  polish: {
    labelKey: 'ai.action.polish',
    label: '润色',
    icon: '✎',
    behavior: 'rewrite',
    systemPrompt: '你是一个写作助手。请润色以下文本，改善语法、提升表达，保持原意。直接输出润色后的内容。',
  },
  translate: {
    labelKey: 'ai.action.translate',
    label: '翻译',
    icon: '⇄',
    behavior: 'rewrite',
    systemPrompt: '你是一个翻译助手。请将以下文本翻译成中文（如果原文是中文则翻译成英文）。直接输出翻译结果。',
  },
  summarize: {
    labelKey: 'ai.action.summarize',
    label: '总结',
    icon: '≡',
    behavior: 'generate',
    systemPrompt: '你是一个写作助手。请用简洁的语言总结以下内容的要点。使用AsciiDoc格式输出。',
  },
  improve: {
    labelKey: 'ai.action.improve',
    label: '完善',
    icon: '✦',
    behavior: 'rewrite',
    systemPrompt: '你是一个写作助手。请完善以下内容：在保持原意和核心观点的基础上，补充必要的细节、理顺逻辑、优化结构与表达，使其更完整、通顺、专业。直接输出完善后的完整内容。',
  },
};

/**
 * 剥掉「整体被单一代码围栏包裹」的外层 fence。
 *
 * 模型在被告知"输出 AsciiDoc/Markdown 格式"时，偶发地把整篇回复用
 * ```adoc … ``` 围栏包起来。本函数在完整输出上做一次性兜底：仅当去首尾空白后
 * 文本严格以 ```lang 开头、以 ``` 结尾时，剥掉这一对外层围栏；内层合法代码块保留。
 * 判据严格（必须首尾成对），正常带代码块的文章首行是文字而非 fence，不会被误伤；
 * 流式中途（末尾尚无 ```）也不匹配，故只应在完整内容上调用。
 *
 * @param {string} text
 * @returns {string}
 */
export function stripFenceWrapper(text) {
  if (!text) return text;
  const trimmed = text.replace(/^\n+|\n+$/g, '');
  // 贪婪 [\s\S]* 让外层闭合取到最后一个 ```，内层 ``` 留在捕获组里不被吃掉
  const m = trimmed.match(/^```[a-zA-Z0-9+#._-]*[ \t]*\n([\s\S]*)\n```[ \t]*$/);
  return m ? m[1] : text;
}

export async function streamChatCompletion(messages, systemPrompt) {
  return invoke()('stream_chat_completion', { messages, systemPrompt });
}

export async function testAiConnection(config) {
  // 传入 config（设置面板当前 UI 值）则基于它测试、不持久化；省略则用已保存配置
  return invoke()('test_ai_connection', { config });
}

export async function saveAiConfig(config) {
  return invoke()('save_ai_config', { config });
}

export async function loadAiConfig() {
  return invoke()('load_ai_config');
}

// API key 存储于系统钥匙串（不落配置文件）
export async function getAiApiKey() {
  return invoke()('secrets_get_ai_key');
}

export async function setAiApiKey(value) {
  return invoke()('secrets_set_ai_key', { value });
}

export async function removeAiApiKey() {
  return invoke()('secrets_remove_ai_key');
}
