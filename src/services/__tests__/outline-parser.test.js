import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveIncludesIfAny } from '../export-service.js';

// Rust IPC 在 node 测试环境不可用，mock 掉 linkIndex（md 回退）与 resolveIncludesIfAny（include 预展开）
vi.mock('../link-index.js', () => ({
  linkIndex: {
    ready: Promise.resolve(),
    getHeadings: vi.fn(async () => [{ line: 1, level: 1, text: 'MD Title' }]),
  },
}));
vi.mock('../export-service.js', () => ({
  resolveIncludesIfAny: vi.fn(async (content) => content), // 默认不展开，include 测试用例单独覆盖
}));

import { parseOutline } from '../outline-parser.js';

afterEach(() => {
  vi.mocked(resolveIncludesIfAny).mockImplementation(async (c) => c);
});

describe('parseOutline', () => {
  it('adoc：level 归一化 1-based、行号准确、section 有 id、doc title 无 id', async () => {
    const adoc = [
      '= Doc Title',
      ':toc: auto',
      '',
      '== Section A',
      '',
      'para A',
      '',
      '=== Subsection',
      '',
      'para',
      '',
      '== Section B',
    ].join('\n');
    const result = await parseOutline(adoc, '/tmp/test.adoc');
    // Doc Title(level0→1)、Section A(level1→2)、Subsection(level2→3)、Section B(level1→2)
    expect(result.map((h) => h.text)).toEqual(['Doc Title', 'Section A', 'Subsection', 'Section B']);
    expect(result.map((h) => h.level)).toEqual([1, 2, 3, 2]);
    expect(result[0].line).toBe(1); // Doc Title 第 1 行
    expect(result[1].line).toBe(4); // Section A 第 4 行
    expect(result[3].line).toBe(12); // Section B 第 12 行
    expect(result[0].id).toBeNull(); // document title 无 id（回退靠行号映射）
    expect(result[1].id).toBeTruthy(); // section 有 id（asciidoctor 生成）
  });

  it('include 引入的标题 line=null（仅定位预览），本文件标题行号准确', async () => {
    // 模拟 Rust 预展开：include::child.adoc[] 被替换为子文件的 == Child Section
    vi.mocked(resolveIncludesIfAny).mockResolvedValue('= Main\n\n== Child Section\n\npara');
    const main = '= Main\n\ninclude::child.adoc[]';
    const result = await parseOutline(main, '/tmp/test.adoc');
    const mainH = result.find((h) => h.text === 'Main');
    const childH = result.find((h) => h.text === 'Child Section');
    expect(mainH).toBeTruthy();
    expect(mainH.line).toBe(1); // 本文件标题，源码行号准确
    expect(childH).toBeTruthy();
    expect(childH.line).toBe(null); // include 引入，无本文件行号
  });

  it('非 adoc 格式回退 linkIndex.getHeadings', async () => {
    const result = await parseOutline('# Title', '/tmp/test.md');
    expect(result).toEqual([{ line: 1, level: 1, text: 'MD Title' }]);
  });

  it('空内容 / 空路径返回空数组', async () => {
    expect(await parseOutline('', '/tmp/x.adoc')).toEqual([]);
    expect(await parseOutline('= T', '')).toEqual([]);
  });
});
