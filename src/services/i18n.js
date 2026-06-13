import zhMessages from '../i18n/zh.json';

let currentLang = 'zh';
let messages = zhMessages;

export function getLanguage() {
  return currentLang;
}

export async function setLanguage(lang) {
  currentLang = lang;
  if (lang === 'zh') {
    messages = zhMessages;
    return;
  }
  try {
    const mod = await import(`../i18n/${lang}.json`);
    messages = mod.default || mod;
  } catch (_) {
    // 加载失败时回退到中文
    messages = zhMessages;
  }
}

export function t(key, params) {
  let text = messages[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}
