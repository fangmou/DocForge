import { describe, it, expect } from 'vitest';
import { compactMessages, COMPACT_DEFAULTS } from '../ai-compact.js';

const { ELISION } = COMPACT_DEFAULTS;

function userDoc(text) {
  return { role: 'user', content: `<document format="adoc">\n${text}\n</document>` };
}
function userSel(text) {
  return { role: 'user', content: `<selection>\n${text}\n</selection>` };
}
function assistant(text) {
  return { role: 'assistant', content: text };
}

describe('compactMessages', () => {
  it('未超阈值时不动', () => {
    const msgs = [userDoc('短内容'), assistant('回复'), userSel('当前')];
    const r = compactMessages(msgs, 100000);
    expect(r.compacted).toBe(false);
    expect(r.droppedCount).toBe(0);
  });

  it('超 55% 时占位当前轮之前的 user 上下文块', () => {
    const big = 'x'.repeat(2000);
    const msgs = [userDoc(big), assistant('r1'), userDoc(big), assistant('r2'), userSel('当前')];
    const r = compactMessages(msgs, 1000);
    expect(r.compacted).toBe(true);
    expect(r.droppedCount).toBeGreaterThan(0);
    expect(r.messages.some((m) => m.content.includes(ELISION))).toBe(true);
  });

  it('当前轮（最后一条 user）始终完整保留', () => {
    const msgs = [userDoc('旧块'.repeat(500)), assistant('r1'), userSel('当前轮选区')];
    const r = compactMessages(msgs, 1);
    const last = r.messages[r.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toContain('当前轮选区');
    // 更早的 user 被占位
    expect(r.messages[0].content).toContain(ELISION);
  });

  it('assistant 消息不被占位', () => {
    const msgs = [
      userDoc(big()),
      assistant('<document>不该被占位</document>'),
      userSel('当前'),
    ];
    function big() { return 'z'.repeat(2000); }
    const r = compactMessages(msgs, 1);
    const asst = r.messages.find((m) => m.role === 'assistant');
    expect(asst.content).toContain('不该被占位');
  });

  it('更早 user 的多个上下文块全占位', () => {
    const big = 'y'.repeat(2000);
    const msgs = [
      { role: 'user', content: `<document>${big}</document>\n指令\n<selection>${big}</selection>` },
      assistant('r1'),
      userSel('当前'),
    ];
    const r = compactMessages(msgs, 1);
    const oldUser = r.messages[0];
    const elisionCount = oldUser.content.split(ELISION).length - 1;
    expect(elisionCount).toBe(2);
  });

  it('空消息数组返回空', () => {
    const r = compactMessages([], 1000);
    expect(r.messages).toEqual([]);
    expect(r.compacted).toBe(false);
  });

  it('不修改原始数组（纯函数）', () => {
    const msgs = [userDoc('原文块'), assistant('r'), userSel('当前')];
    const original = msgs[0].content;
    compactMessages(msgs, 1);
    expect(msgs[0].content).toBe(original);
  });

  it('无可压缩上下文块时不报错', () => {
    const msgs = [
      { role: 'user', content: '纯指令无上下文块'.repeat(500) },
      assistant('r'),
      userSel('当前'),
    ];
    const r = compactMessages(msgs, 100);
    expect(r.droppedCount).toBe(0);
  });

  it('contextLimit <= 0 不压缩（用户配置为不限）', () => {
    const big = 'x'.repeat(2000);
    const msgs = [userDoc(big), assistant('r1'), userSel('当前')];
    expect(compactMessages(msgs, 0).compacted).toBe(false);
    expect(compactMessages(msgs, -1).compacted).toBe(false);
  });
});
