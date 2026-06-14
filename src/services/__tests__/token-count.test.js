import { describe, it, expect } from 'vitest';
import { approxTokens, approxMessagesTokens } from '../token-count.js';

describe('approxTokens', () => {
  it('空/无输入返回 0', () => {
    expect(approxTokens('')).toBe(0);
    expect(approxTokens(null)).toBe(0);
    expect(approxTokens(undefined)).toBe(0);
  });

  it('ASCII 按字节/4 估算并向上取整', () => {
    // "hello" = 5 字节 → ceil(5/4) = 2
    expect(approxTokens('hello')).toBe(2);
    // "abcd" = 4 字节 → ceil(4/4) = 1
    expect(approxTokens('abcd')).toBe(1);
  });

  it('中文按 UTF-8 字节估算（每字 3 字节）', () => {
    // "你好" = 6 字节 → ceil(6/4) = 2
    expect(approxTokens('你好')).toBe(2);
    // "写作助手" = 12 字节 → ceil(12/4) = 3
    expect(approxTokens('写作助手')).toBe(3);
  });

  it('中英混合按总字节估算', () => {
    // "a你" = 1 + 3 = 4 字节 → 1
    expect(approxTokens('a你')).toBe(1);
  });
});

describe('approxMessagesTokens', () => {
  it('非数组返回 0', () => {
    expect(approxMessagesTokens(null)).toBe(0);
    expect(approxMessagesTokens(undefined)).toBe(0);
  });

  it('累加各消息内容 token', () => {
    const msgs = [
      { role: 'user', content: 'abcd' },       // 1
      { role: 'assistant', content: '你好' },  // 2
    ];
    expect(approxMessagesTokens(msgs)).toBe(3);
  });

  it('跳过缺失 content 的消息', () => {
    const msgs = [
      { role: 'user', content: 'abcd' }, // 1
      { role: 'assistant' },             // 0（无 content）
    ];
    expect(approxMessagesTokens(msgs)).toBe(1);
  });
});
