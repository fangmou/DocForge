import { describe, it, expect } from 'vitest';
import { stripFenceWrapper } from '../ai-service.js';

describe('stripFenceWrapper', () => {
  it('剥掉 adoc 整体围栏', () => {
    expect(stripFenceWrapper('```adoc\n== 标题\n\n正文\n```')).toBe('== 标题\n\n正文');
  });

  it('剥掉 markdown / asciidoc / 空语言围栏', () => {
    expect(stripFenceWrapper('```markdown\n# T\n```')).toBe('# T');
    expect(stripFenceWrapper('```asciidoc\n== A\n```')).toBe('== A');
    expect(stripFenceWrapper('```\ncode\n```')).toBe('code');
  });

  it('保留内层合法代码块', () => {
    const src = '```adoc\n文字\n\n```python\ncode\n```\n```';
    expect(stripFenceWrapper(src)).toBe('文字\n\n```python\ncode\n```');
  });

  it('首行非 fence 的正常内容不误伤', () => {
    const src = '== 标题\n\n```python\ncode\n```';
    expect(stripFenceWrapper(src)).toBe(src);
  });

  it('只有开头围栏（流式中途、末尾无配对）不剥', () => {
    expect(stripFenceWrapper('```adoc\n内容')).toBe('```adoc\n内容');
  });

  it('去首尾空行后再判定', () => {
    expect(stripFenceWrapper('\n\n```adoc\nx\n```\n\n')).toBe('x');
  });

  it('围栏尾随空格也能剥', () => {
    expect(stripFenceWrapper('```adoc   \nx\n```   ')).toBe('x');
  });

  it('空串与空值安全', () => {
    expect(stripFenceWrapper('')).toBe('');
    expect(stripFenceWrapper(null)).toBe(null);
  });
});
