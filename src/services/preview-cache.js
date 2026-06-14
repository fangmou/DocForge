import { hashString } from './hash.js';

/**
 * 预览渲染结果的内容寻址缓存。
 *
 * key = hash(format + 属性指纹 + 渲染原文)。以「渲染原文」做指纹意味着
 * 内容一变、指纹即变、必然 miss 重编译——天然不脏，无需为正确性牺牲性能。
 *
 * 主要收益场景：切换 tab 回到已渲染文件、edit↔split/preview 视图切换时
 * 命中即跳过 include 解析与 asciidoctor.convert 全量编译，从百毫秒级降到 <5ms。
 *
 * 残留风险：include:: 引用的外部文件被本软件之外的工具修改时（无 file-saved
 * 事件），原文不变仍命中旧结果。这是单机写作可接受的已知限制；LRU 上限
 * 保证内存占用有界。
 */
const MAX_ENTRIES = 32;
const cache = new Map(); // 插入顺序即 LRU 顺序，末尾为最近使用

function lruGet(key) {
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key); // 命中：提到末尾
  cache.set(key, value);
  return value;
}

function lruSet(key, value) {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_ENTRIES) {
    cache.delete(cache.keys().next().value); // 淘汰最旧（头部）
  }
  cache.set(key, value);
}

function makeKey(format, attrs, input) {
  return hashString(`${format}|${JSON.stringify(attrs)}|${input}`);
}

/** 查询已渲染 HTML；未命中返回 null */
export function getRendered(format, attrs, input) {
  return lruGet(makeKey(format, attrs, input));
}

/** 写入渲染结果 */
export function setRendered(format, attrs, input, html) {
  lruSet(makeKey(format, attrs, input), html);
}

/** 清空全部缓存（内容指纹已自失效，此方法主要用于测试与强制回收） */
export function invalidateAll() {
  cache.clear();
}

/** 仅供测试：返回当前条目数 */
export function _size() {
  return cache.size;
}

/** 仅供测试：返回容量上限 */
export const _maxEntries = MAX_ENTRIES;
