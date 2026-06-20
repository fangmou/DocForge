#!/usr/bin/env node
// 发版脚本：以 Cargo.toml 的 version 为唯一来源（SSOT），同步 package.json，并生成 version.json。
// tauri.conf.json 不再写 version 字段——Tauri v2 会自动回退读取 Cargo.toml。
// version.json 的 url 取自 Cargo.toml homepage（与 app.rs env!("CARGO_PKG_HOMEPAGE") 一致），
// 上传端点取自 app.rs UPDATE_CHECK_URL——均从源读取，不在此硬编码，避免漂移。
//
// 用法：
//   node scripts/release.mjs v=0.2.0 [m="更新说明"]
//   make release v=0.2.0 m="更新说明"
//
// 不触碰 git（提交 / tag 由你手动控制）。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** 解析 `v=...` / `m=...` 形式的参数。 */
function parseArgs(argv) {
  const args = { v: null, m: '' };
  for (const a of argv.slice(2)) {
    const eq = a.indexOf('=');
    if (eq === -1) continue;
    const key = a.slice(0, eq);
    const val = a.slice(eq + 1);
    if (key === 'v') args.v = val;
    else if (key === 'm') args.m = val;
  }
  return args;
}

const { v, m } = parseArgs(process.argv);

if (!v) {
  console.error('用法: make release v=<版本号> [m="更新说明"]');
  console.error('示例: make release v=0.2.0 m="新增关于页与检查更新"');
  process.exit(1);
}

// 校验版本号格式：x.y.z（纯数字三段），与 app.rs::is_simple_version 一致
if (!/^\d+\.\d+\.\d+$/.test(v)) {
  console.error(`✗ 版本号格式错误：${v}（应为 x.y.z，如 0.2.0）`);
  process.exit(1);
}

// === 读取 Cargo.toml：当前 version（SSOT）+ homepage（version.json 的 url） ===
const cargoPath = resolve(ROOT, 'src-tauri/Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf8');
const curMatch = cargo.match(/^version = "(.*)"/m);
const current = curMatch ? curMatch[1] : null;
if (!current) {
  console.error('✗ 无法从 src-tauri/Cargo.toml 读取当前 version（行首 `version = "..."`）');
  process.exit(1);
}
const homepageMatch = cargo.match(/^homepage\s*=\s*"([^"]+)"/m);
const homepage = homepageMatch ? homepageMatch[1] : '';
if (!homepage) {
  console.error('✗ 无法从 src-tauri/Cargo.toml 读取 homepage（version.json 的 url 字段需要它）');
  process.exit(1);
}

// === 读取 app.rs 的 UPDATE_CHECK_URL（端点 SSOT，用于上传提示） ===
const appRsPath = resolve(ROOT, 'src-tauri/src/commands/app.rs');
const appRs = readFileSync(appRsPath, 'utf8');
const endpointMatch = appRs.match(/UPDATE_CHECK_URL:\s*&str\s*=\s*"([^"]+)"/);
const updateEndpoint = endpointMatch ? endpointMatch[1] : '';
if (!updateEndpoint) {
  console.error('✗ 无法从 src-tauri/src/commands/app.rs 读取 UPDATE_CHECK_URL');
  process.exit(1);
}

// 1. 改 Cargo.toml version（SSOT）
//    正则锚定行首顶格，仅匹配 [package] 的 version，不误伤依赖表内的 `version = "x"`
writeFileSync(cargoPath, cargo.replace(/^version = ".*"/m, `version = "${v}"`));

// 2. 同步 package.json version（顶层第一个 "version" 键）
const pkgPath = resolve(ROOT, 'package.json');
const pkg = readFileSync(pkgPath, 'utf8');
writeFileSync(pkgPath, pkg.replace(/("version":\s*)"[^"]*"/, `$1"${v}"`));

// 3. 生成 version.json（url 取自 Cargo.toml homepage）
const versionInfo = { version: v, url: homepage, notes: m || '' };
const versionPath = resolve(ROOT, 'version.json');
writeFileSync(versionPath, JSON.stringify(versionInfo, null, 2) + '\n');

console.log('✓ 发版准备完成（未触碰 git）');
console.log(`  Cargo.toml:    ${current} → ${v}`);
console.log(`  package.json:  ${v}`);
console.log(`  version.json:  ${versionPath}`);
console.log(`    ${JSON.stringify(versionInfo)}`);
if (!m) console.log('  提示：未传入 m，version.json 的 notes 为空');
console.log(`  发布时请将 version.json 上传到 ${updateEndpoint}`);
