const invoke = () => window.__TAURI__.core.invoke;

// 预设AI动作
export const AI_ACTIONS = {
  continue: {
    label: '续写',
    icon: '▶',
    systemPrompt: '你是一个写作助手。请根据上下文自然地续写以下内容，保持风格一致。直接输出续写内容，不要解释。',
  },
  polish: {
    label: '润色',
    icon: '✎',
    systemPrompt: '你是一个写作助手。请润色以下文本，改善语法、提升表达，保持原意。直接输出润色后的内容。',
  },
  translate: {
    label: '翻译',
    icon: '⇄',
    systemPrompt: '你是一个翻译助手。请将以下文本翻译成中文（如果原文是中文则翻译成英文）。直接输出翻译结果。',
  },
  summarize: {
    label: '总结',
    icon: '≡',
    systemPrompt: '你是一个写作助手。请用简洁的语言总结以下内容的要点。使用AsciiDoc格式输出。',
  },
};

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
