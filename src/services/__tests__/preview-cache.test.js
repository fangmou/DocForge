import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRendered,
  setRendered,
  invalidateAll,
  _size,
  _maxEntries,
} from '../preview-cache.js';

describe('preview-cache', () => {
  beforeEach(() => invalidateAll());

  it('命中：写入后可读出', () => {
    const attrs = { toc: 'auto' };
    setRendered('adoc', attrs, '= 标题', '<h1>标题</h1>');
    expect(getRendered('adoc', attrs, '= 标题')).toBe('<h1>标题</h1>');
  });

  it('未命中返回 null', () => {
    expect(getRendered('adoc', {}, '不存在')).toBeNull();
  });

  it('内容变化则 key 变化（指纹不脏）', () => {
    const attrs = { toc: 'auto' };
    setRendered('adoc', attrs, '原文', '<p>A</p>');
    expect(getRendered('adoc', attrs, '原文')).toBe('<p>A</p>');
    expect(getRendered('adoc', attrs, '改写后')).toBeNull();
  });

  it('格式不同互不干扰', () => {
    setRendered('adoc', null, 'x', '<adoc>');
    setRendered('md', null, 'x', '<md>');
    expect(getRendered('adoc', null, 'x')).toBe('<adoc>');
    expect(getRendered('md', null, 'x')).toBe('<md>');
  });

  it('属性变化则 key 变化', () => {
    const a1 = { toc: 'auto' };
    const a2 = { toc: 'manual' };
    setRendered('adoc', a1, '同文', '<p>1</p>');
    expect(getRendered('adoc', a2, '同文')).toBeNull();
  });

  it('LRU：超出容量淘汰最旧条目', () => {
    for (let i = 0; i < _maxEntries; i++) {
      setRendered('adoc', null, `content-${i}`, `<${i}>`);
    }
    expect(_size()).toBe(_maxEntries);
    // 插入第 max+1 条，最早的 content-0 应被淘汰
    setRendered('adoc', null, 'content-overflow', '<x>');
    expect(getRendered('adoc', null, 'content-0')).toBeNull();
    expect(getRendered('adoc', null, 'content-overflow')).toBe('<x>');
  });

  it('LRU：读取会刷新使用顺序，避免被过早淘汰', () => {
    setRendered('adoc', null, 'hot', '<hot>');
    // 填满至容量，期间反复读 hot 使其保持为最近使用
    for (let i = 0; i < _maxEntries; i++) {
      setRendered('adoc', null, `fill-${i}`, `<${i}>`);
      getRendered('adoc', null, 'hot');
    }
    expect(getRendered('adoc', null, 'hot')).toBe('<hot>');
  });

  it('invalidateAll 清空全部', () => {
    setRendered('adoc', null, 'a', '<a>');
    setRendered('md', null, 'b', '<b>');
    invalidateAll();
    expect(_size()).toBe(0);
    expect(getRendered('adoc', null, 'a')).toBeNull();
  });
});
