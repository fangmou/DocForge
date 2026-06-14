#!/usr/bin/env node
/**
 * eager-graph：分析 dist 产物中的「启动同步加载」JS chunk 图，确保应懒加载的
 * 重型包（@asciidoctor、marked）绝不泄漏进 eager 启动图。
 *
 * 思路（借鉴 terax eager-graph，适配 Rollup 产物结构）：从 entry chunk（index-*.js）
 * 出发，沿「静态 import」做 BFS 传递闭包 = eager 图；动态 import() 不计入。
 * 若 MUST_LAZY 中的包出现在 eager 图，说明有人误把动态 import 改成了静态 import，
 * 会显著增加启动体积——脚本以非零码退出。
 *
 * 用法：先 `vite build`，再 `node scripts/eager-graph.mjs`。
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist/assets';
// 必须懒加载、绝不进入 eager 启动图的重型包（按 chunk 文件名前缀匹配）
const MUST_LAZY = ['asciidoctor', 'marked'];
// eager 入口 chunk：index-* 由 main.js 引导产生
const ENTRY = /^index-.*\.js$/;

// 匹配 Rollup 产物的静态 import：import"./x.js" / import{a as $1}from"./x.js" / import a from"./x.js"
// 动态 import("./x.js") 因 import 后紧跟 ( 而被 (?!\() 排除。
// [^();] 兼容压缩后的变量名（含 $、空格、花括号、逗号），只排除会越界的括号与分号。
const RE_STATIC = /import(?!\()\s*(?:[^();]*?\sfrom\s*)?["']\.\/([^"']+\.js)["']/g;

function chunkPrefix(name) {
  return name.replace(/^([a-z][a-z0-9-]*).*\.js$/i, '$1');
}

async function main() {
  let files;
  try {
    files = await readdir(DIST);
  } catch {
    console.error(`未找到 ${DIST}/，请先运行 vite build。`);
    process.exit(2);
  }

  const jsChunks = files.filter((f) => f.endsWith('.js'));
  const staticDeps = new Map(); // chunk -> Set<被静态 import 的 chunk>

  for (const f of jsChunks) {
    const code = await readFile(join(DIST, f), 'utf8');
    const set = new Set();
    let m;
    RE_STATIC.lastIndex = 0;
    while ((m = RE_STATIC.exec(code))) set.add(m[1]);
    staticDeps.set(f, set);
  }

  const entry = jsChunks.find((f) => ENTRY.test(f));
  if (!entry) {
    console.error('未找到 entry chunk（index-*.js）。');
    process.exit(2);
  }

  // BFS 起点：entry chunk + index.html 中 modulepreload 预加载的 chunk。
  // Vite 默认把 entry 的静态依赖通过 <link rel="modulepreload"> 注入 HTML，
  // 这些 chunk 在启动时同步加载（即使 entry 的 JS 里没有 import 语句），故必须纳入 eager 图。
  const eager = new Set();
  const queue = [entry];
  let html = '';
  try {
    html = await readFile('dist/index.html', 'utf8');
  } catch {
    /* 无 HTML 时仅按 JS 静态 import 分析 */
  }
  const preloadRe = /<link[^>]*rel=["']modulepreload["'][^>]*href=["']\/assets\/([^"']+\.js)["']/g;
  let pm;
  while ((pm = preloadRe.exec(html))) queue.push(pm[1]);

  while (queue.length) {
    const cur = queue.shift();
    if (eager.has(cur)) continue;
    eager.add(cur);
    for (const dep of staticDeps.get(cur) || []) {
      if (!eager.has(dep)) queue.push(dep);
    }
  }

  console.log(`eager 启动图（${eager.size} 个 chunk，入口 ${entry}）：`);
  for (const f of [...eager].sort()) console.log(`  - ${f}`);

  // 聚合到包前缀，检查 MUST_LAZY 泄漏
  const eagerPrefixes = new Set([...eager].map(chunkPrefix));
  const leaked = MUST_LAZY.filter((p) => eagerPrefixes.has(p));

  if (leaked.length) {
    console.error(`\n✗ 应懒加载的重型包泄漏进 eager 启动图：${leaked.join(', ')}`);
    console.error('  请确认其引入方式为动态 import()，而非顶层静态 import。');
    process.exit(1);
  }
  console.log(`\n✓ 无重型包泄漏（${MUST_LAZY.join(', ')} 均为懒加载）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
