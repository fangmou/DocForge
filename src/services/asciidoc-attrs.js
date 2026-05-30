import { getLanguage } from './i18n.js';

/**
 * 合并 Asciidoctor attributes
 * 优先级（低→高）：程序默认值（语言相关） → extraArgs → 文档属性
 * @param {string} content - adoc 文档内容
 * @param {object} baseAttrs - 基础 attributes (showtitle, toc, 等)
 * @param {string} extraArgs - 额外参数字符串，如 "-a toc -a icons=font"
 * @returns {object} 合并后的 attributes
 */
export function buildAttributes(content, baseAttrs = {}, extraArgs = '') {
  const attrs = { ...baseAttrs };

  // 1. 程序默认值（最低优先级，语言相关）
  const lang = getLanguage();
  if (lang === 'zh') {
    attrs['toc-title'] = '目录';
    attrs['table-caption'] = '表';
    attrs['figure-caption'] = '图';
    attrs['example-caption'] = '例';
    attrs['lang'] = 'zh_CN';
  }

  // 2. extraArgs 覆盖（中等优先级）
  if (extraArgs) {
    const pairs = extraArgs.match(/-a\s+(\S+)/g) || [];
    for (const pair of pairs) {
      const kv = pair.replace('-a ', '');
      const eqPos = kv.indexOf('=');
      if (eqPos > 0) {
        attrs[kv.substring(0, eqPos)] = kv.substring(eqPos + 1);
      } else {
        attrs[kv] = '';
      }
    }
  }

  // 3. 文档属性覆盖（最高优先级）
  if (content) {
    const langKeys = ['toc-title', 'table-caption', 'figure-caption', 'example-caption', 'lang'];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      const m = trimmed.match(/^:([^:!]+):\s*(.*)/);
      if (m) {
        const key = m[1].trim();
        if (langKeys.includes(key)) {
          attrs[key] = m[2].trim();
        }
        continue;
      }
      // 标题行之后不再解析属性头
      if (trimmed.startsWith('= ') && !trimmed.startsWith(':')) break;
      if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith(':')) break;
    }
  }

  return attrs;
}
