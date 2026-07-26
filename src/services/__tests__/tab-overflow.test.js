import { describe, it, expect } from 'vitest';
import { partitionOverflow } from '../tab-overflow.js';

describe('partitionOverflow', () => {
  // 默认可视区 [0, 100)
  const vp = (items) => partitionOverflow(items, 0, 100);

  it('所有 tab 完全落在可视区内时无溢出', () => {
    expect(vp([
      { path: 'a', left: 0, right: 40 },
      { path: 'b', left: 40, right: 80 },
    ])).toEqual({ left: [], right: [] });
  });

  it('仅左侧溢出（完全在左）', () => {
    expect(vp([
      { path: 'a', left: -60, right: -20 },
      { path: 'b', left: 10, right: 50 },
    ])).toEqual({ left: ['a'], right: [] });
  });

  it('仅右侧溢出（完全在右）', () => {
    expect(vp([
      { path: 'a', left: 10, right: 50 },
      { path: 'b', left: 130, right: 170 },
    ])).toEqual({ left: [], right: ['b'] });
  });

  it('两端都溢出', () => {
    expect(vp([
      { path: 'a', left: -50, right: -10 },
      { path: 'b', left: 20, right: 60 },
      { path: 'c', left: 150, right: 190 },
    ])).toEqual({ left: ['a'], right: ['c'] });
  });

  it('横跨左边界的 tab 算左溢出（部分被遮挡）', () => {
    expect(vp([{ path: 'a', left: -30, right: 30 }]))
      .toEqual({ left: ['a'], right: [] });
  });

  it('横跨右边界的 tab 算右溢出（部分被遮挡）', () => {
    expect(vp([{ path: 'a', left: 70, right: 130 }]))
      .toEqual({ left: [], right: ['a'] });
  });

  it('横跨整个可视区的超大 tab 不算溢出', () => {
    expect(vp([{ path: 'a', left: -50, right: 150 }]))
      .toEqual({ left: [], right: [] });
  });

  it('滚动后可视区 [50, 150) 的分区', () => {
    const r = partitionOverflow([
      { path: 'a', left: 0, right: 40 }, // 完全在左
      { path: 'b', left: 60, right: 100 }, // 可见
      { path: 'c', left: 160, right: 200 }, // 完全在右
    ], 50, 100);
    expect(r).toEqual({ left: ['a'], right: ['c'] });
  });

  it('保持 tab 顺序：左溢出按出现顺序返回', () => {
    expect(vp([
      { path: 'first', left: -120, right: -80 },
      { path: 'second', left: -60, right: -20 },
      { path: 'vis', left: 10, right: 50 },
    ])).toEqual({ left: ['first', 'second'], right: [] });
  });

  it('边界精确匹配：right === scrollLeft 视为左溢出（恰好贴左边界外侧）', () => {
    expect(partitionOverflow([{ path: 'a', left: 0, right: 40 }], 40, 100))
      .toEqual({ left: ['a'], right: [] });
  });

  it('边界精确匹配：left === rightEdge 视为右溢出（恰好贴右边界外侧）', () => {
    expect(partitionOverflow([{ path: 'a', left: 140, right: 180 }], 40, 100))
      .toEqual({ left: [], right: ['a'] });
  });

  it('紧贴左边界内侧（left === scrollLeft）不算左溢出', () => {
    expect(partitionOverflow([{ path: 'a', left: 40, right: 80 }], 40, 100))
      .toEqual({ left: [], right: [] });
  });

  it('空列表返回空', () => {
    expect(vp([])).toEqual({ left: [], right: [] });
  });
});
