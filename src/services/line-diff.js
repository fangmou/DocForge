/**
 * 行级 diff（LCS）与逐块拼接（纯函数）。
 *
 * 用于 AI 改写的 side-by-side 对比与 per-hunk 应用：把原文与 AI 结果按行求最长公共
 * 子序列，输出 chunk 序列——equal（两栏相同的行）或 changed（aLines 被删除、bLines
 * 被新增的连续块）。用户可逐 changed 块选择「用原文」或「用修改」，buildResult 按选择拼接。
 */

/**
 * @returns {Array<{type:'equal',lines:string[]} | {type:'changed',aLines:string[],bLines:string[]}>}
 */
export function diffChunks(a, b) {
  const aLines = a ? a.split('\n') : [];
  const bLines = b ? b.split('\n') : [];
  const m = aLines.length;
  const n = bLines.length;

  // LCS 长度 DP（自底向上）
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const chunks = [];
  const pushEqual = (line) => {
    const last = chunks[chunks.length - 1];
    if (last && last.type === 'equal') last.lines.push(line);
    else chunks.push({ type: 'equal', lines: [line] });
  };
  const pushChanged = (aLine, bLine) => {
    const last = chunks[chunks.length - 1];
    if (last && last.type === 'changed') {
      if (aLine !== undefined) last.aLines.push(aLine);
      if (bLine !== undefined) last.bLines.push(bLine);
    } else {
      chunks.push({
        type: 'changed',
        aLines: aLine !== undefined ? [aLine] : [],
        bLines: bLine !== undefined ? [bLine] : [],
      });
    }
  };

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      pushEqual(aLines[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushChanged(aLines[i], undefined);
      i++;
    } else {
      pushChanged(undefined, bLines[j]);
      j++;
    }
  }
  while (i < m) pushChanged(aLines[i++], undefined);
  while (j < n) pushChanged(undefined, bLines[j++]);

  return chunks;
}

/**
 * 按每块的 applied 状态拼接最终文本。
 * changed 块：applied=true → 用 bLines（AI 修改），false → 用 aLines（原文）；equal → lines。
 * @param {Array} chunks diffChunks 结果
 * @param {Object<boolean>} applied 以 chunk 索引为键、布尔为值
 */
export function buildResult(chunks, applied) {
  const out = [];
  chunks.forEach((c, idx) => {
    const lines = c.type === 'equal' ? c.lines : applied[idx] ? c.bLines : c.aLines;
    for (const l of lines) out.push(l);
  });
  return out.join('\n');
}

/** 统计 diff 概况：新增/删除行数、changed 块数 */
export function diffStats(chunks) {
  let added = 0;
  let removed = 0;
  let changedBlocks = 0;
  for (const c of chunks) {
    if (c.type === 'changed') {
      added += c.bLines.length;
      removed += c.aLines.length;
      changedBlocks++;
    }
  }
  return { added, removed, changedBlocks };
}
