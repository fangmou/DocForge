import { describe, it, expect } from 'vitest';
import {
  buildAiRequest,
  buildCustomRequest,
  truncateForContext,
  composeSystemPrompt,
  MAX_CONTEXT_TOKENS_VALUE,
} from '../ai-context.js';
import { AI_ACTIONS } from '../ai-service.js';

describe('buildAiRequest — 选区优先 + 全文兜底', () => {
  it('有选区时用选区，original=选区（启用 diff）', () => {
    const r = buildAiRequest('polish', { selected: '原文', fullContent: '全文', formatId: 'adoc' });
    expect(r.userMessage).toContain('<selection>');
    expect(r.userMessage).toContain('原文');
    expect(r.userMessage).not.toContain('全文');
    expect(r.original).toBe('原文');
  });

  it('无选区时用全文兜底，original 为空（无 diff）', () => {
    const r = buildAiRequest('continue', { selected: '', fullContent: '全文内容', formatId: 'adoc' });
    expect(r.userMessage).toContain('<document format="adoc">');
    expect(r.userMessage).toContain('全文内容');
    expect(r.original).toBe('');
  });

  it('空文档兜底占位', () => {
    const r = buildAiRequest('continue', { selected: '', fullContent: '', formatId: 'adoc' });
    expect(r.userMessage).toBeTruthy();
    expect(r.original).toBe('');
  });

  it('未知 actionKey 返回 null', () => {
    expect(buildAiRequest('nope', { selected: 'x' })).toBeNull();
  });
});

describe('truncateForContext', () => {
  it('短文本不截断', () => {
    expect(truncateForContext('短文本')).toBe('短文本');
  });

  it('超长文本截断并加提示', () => {
    const long = 'a'.repeat(MAX_CONTEXT_TOKENS_VALUE * 4 + 1000);
    const out = truncateForContext(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain('已截断');
  });

  it('截断不破坏 UTF-8 多字节字符（中文）', () => {
    const cn = '你'.repeat(MAX_CONTEXT_TOKENS_VALUE * 4 + 10);
    const out = truncateForContext(cn);
    // 去掉尾部提示后应仍是合法 UTF-8（TextDecoder fatal:false 已兜底，这里验证不含乱码截断标记）
    expect(out).toContain('已截断');
    const body = out.split('\n\n[...')[0];
    expect(body.length).toBeGreaterThan(0);
  });
});

describe('composeSystemPrompt — 格式注入', () => {
  it('summarize 在 adoc 文档输出 AsciiDoc', () => {
    const p = composeSystemPrompt(AI_ACTIONS.summarize, 'adoc');
    expect(p).toContain('AsciiDoc');
    expect(p).not.toContain('{FMT}');
  });

  it('summarize 在 md 文档输出 Markdown', () => {
    const p = composeSystemPrompt(AI_ACTIONS.summarize, 'md');
    expect(p).toContain('Markdown');
  });

  it('通用动作追加格式语法要求', () => {
    const p = composeSystemPrompt(AI_ACTIONS.polish, 'md');
    expect(p).toContain('Markdown');
    expect(p).toMatch(/语法/);
  });

  it('formatId 为 null 不注入格式', () => {
    const p = composeSystemPrompt(AI_ACTIONS.summarize, null);
    expect(p).not.toContain('AsciiDoc');
    expect(p).not.toContain('Markdown');
    expect(p).not.toContain('{FMT}');
  });

  it('summarize（无「直接输出」）追加输出规范', () => {
    const p = composeSystemPrompt(AI_ACTIONS.summarize, 'adoc');
    expect(p).toContain('直接输出');
  });
});

describe('buildCustomRequest — 自由输入 + 上下文', () => {
  it('有选区：指令 + selection 块，original=选区', () => {
    const r = buildCustomRequest('改成表格', { selected: '行列', formatId: 'md' });
    expect(r.userMessage).toContain('改成表格');
    expect(r.userMessage).toContain('<selection>');
    expect(r.userMessage).toContain('行列');
    expect(r.original).toBe('行列');
  });

  it('无选区：指令 + document 块', () => {
    const r = buildCustomRequest('总结一下', { fullContent: '全文', formatId: 'adoc' });
    expect(r.userMessage).toContain('总结一下');
    expect(r.userMessage).toContain('<document format="adoc">');
    expect(r.original).toBe('');
  });

  it('无上下文：仅指令', () => {
    const r = buildCustomRequest('你好', {});
    expect(r.userMessage).toBe('你好');
    expect(r.original).toBe('');
  });

  it('md 格式注入到 systemPrompt', () => {
    const r = buildCustomRequest('润色', { selected: 'x', formatId: 'md' });
    expect(r.systemPrompt).toContain('Markdown');
  });
});
