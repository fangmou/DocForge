import { describe, it, expect } from 'vitest';
import { diffChunks, buildResult, diffStats } from '../line-diff.js';

describe('diffChunks', () => {
  it('完全相同 → 单个 equal', () => {
    const c = diffChunks('a\nb\nc', 'a\nb\nc');
    expect(c).toEqual([{ type: 'equal', lines: ['a', 'b', 'c'] }]);
  });

  it('纯新增 → changed（aLines 空）', () => {
    const c = diffChunks('', 'x\ny');
    expect(c).toEqual([{ type: 'changed', aLines: [], bLines: ['x', 'y'] }]);
  });

  it('纯删除 → changed（bLines 空）', () => {
    const c = diffChunks('x\ny', '');
    expect(c).toEqual([{ type: 'changed', aLines: ['x', 'y'], bLines: [] }]);
  });

  it('中间修改 → equal + changed + equal', () => {
    const c = diffChunks('a\nold\nc', 'a\nnew\nc');
    expect(c.length).toBe(3);
    expect(c[0]).toEqual({ type: 'equal', lines: ['a'] });
    expect(c[1]).toEqual({ type: 'changed', aLines: ['old'], bLines: ['new'] });
    expect(c[2]).toEqual({ type: 'equal', lines: ['c'] });
  });

  it('混合增删改', () => {
    const c = diffChunks('a\nb\nc', 'a\nB\nc\nd');
    // a 相等；b→B 改；c 相等；d 新增
    expect(c[0]).toEqual({ type: 'equal', lines: ['a'] });
    expect(c[1].type).toBe('changed');
    expect(c[1].aLines).toEqual(['b']);
    expect(c[1].bLines).toEqual(['B']);
    expect(c[2]).toEqual({ type: 'equal', lines: ['c'] });
    expect(c[3].type).toBe('changed');
    expect(c[3].bLines).toEqual(['d']);
  });

  it('空字符串处理', () => {
    expect(diffChunks('', '')).toEqual([]);
  });
});

describe('buildResult', () => {
  it('全部 applied → 等于 b', () => {
    const chunks = diffChunks('a\nold\nc', 'a\nnew\nc');
    const applied = { 1: true }; // chunk 1（changed）用修改
    expect(buildResult(chunks, applied)).toBe('a\nnew\nc');
  });

  it('changed 块不 applied → 等于 a（保留原文）', () => {
    const chunks = diffChunks('a\nold\nc', 'a\nnew\nc');
    const applied = { 1: false };
    expect(buildResult(chunks, applied)).toBe('a\nold\nc');
  });

  it('逐块混合选择', () => {
    // a: a / x / c / y ; b: a / X / c / Z
    const chunks = diffChunks('a\nx\nc\ny', 'a\nX\nc\nZ');
    // chunk 序列：equal[a], changed[x→X], equal[c], changed[y→Z]
    const applied = { 1: false, 3: true }; // 第一处用原文，第二处用修改
    expect(buildResult(chunks, applied)).toBe('a\nx\nc\nZ');
  });
});

describe('diffStats', () => {
  it('统计新增/删除/块数', () => {
    const chunks = diffChunks('a\nb\nc', 'a\nB\nc\nd');
    const s = diffStats(chunks);
    expect(s.changedBlocks).toBe(2); // b→B, +d
    expect(s.added).toBe(2); // B, d
    expect(s.removed).toBe(1); // b
  });
});
