# CLAUDE.md — 方谋文构 (Fangmou DocForge)

## 项目简介

一款为"思想工程师"打造的 AI 原生、可扩展的本地文本编辑器。将软件工程的纪律赋予写作，让您像构建代码一样构建知识。基于 AsciiDoc / Markdown 纯文本根基。

## 技术栈

- **桌面**: Tauri v2 (Rust 后端 + WebKit 前端)
- **前端**: Lit 3 (Web Components) + CodeMirror 6 + @asciidoctor/core + marked（Markdown 渲染）
- **AI**: OpenAI 兼容 API（Rust 端代理，避免 CORS 和密钥泄露）
- **构建**: Vite 6

## 关键目录

- `src/components/` — Lit Web Components（app-shell, editor-pane, preview-pane, ai-panel, backlinks-panel, tags-panel, graph-view, plugin-manager-panel 等）
- `src/services/` — 前端服务层（file-service, ai-service, event-bus, editor-state, i18n, asciidoc-attrs, link-index, graph-layout, plugin-loader, plugin-registry, format-commands）
- `src/i18n/` — 语言包文件（zh.json, en.json），新增语言只需加 JSON
- `src-tauri/src/commands/` — Tauri IPC 命令（file.rs, ai.rs, config.rs, export.rs, search.rs, link.rs, plugin.rs）
- `src-tauri/src/services/` — Rust 业务逻辑（ai_client.rs）

## 开发命令

- `make dev` — 启动开发模式（热重载）
- `make linux` / `windows` / `mac` — 快速编译可执行文件（开发测试）
- `make pkg` / `pkg-linux` / `pkg-windows` / `pkg-mac` — 打安装包（发布）
- `make check` — 检查 Rust 编译

## 编码约定

- 前端组件使用 Lit Web Components，通过 EventBus (CustomEvent) 松耦合通信
- Rust 命令使用 `#[tauri::command]` 宏，async 函数需要 `Send` bound
- 递归 async 函数使用 `Box::pin` + `Send` trait object
- reqwest 使用 rustls-tls（避免系统 OpenSSL 依赖）
- **路径分隔符统一 `/`**: Rust 后端所有返回给前端的路径必须经过 `utils::normalize_path()` 转换（`\` → `/`），前端代码统一用 `/` 做路径操作；`link_db.rs` 已有自己的 `normalize_path` 处理 `.`/`..`，需用 `use crate::utils::normalize_path as to_forward_slash` 避免冲突
- **WSL 路径转换**: 配置中的文件路径（如 `output_dir`、`fonts_dir`）在传给外部命令前必须通过 `resolve_config_path()` 解析，该函数在 Linux/WSL 上自动将 Windows 盘符路径转为 `/mnt/...`，Windows 原生上仅做分隔符标准化
- **禁止原生弹框**: 禁止使用 `prompt()` / `confirm()`（WebKit 下显示调试标题，体验差）。确认类用 `import { showConfirm } from '../services/dialog.js'`（返回 `Promise<boolean>`）；输入类用组件内 `_showInputDialog()` 模式

## 文档维护规则

- **IPC 命令唯一来源**: `docs/_partials/ipc-reference/`，README.adoc 是概览表格，子文件是详情
- **插件扩展点**: `docs/_partials/plugin-reference/`
- **需求文档**: `docs/requirements/`，需求变更只改需求文件
- **架构文档**: `docs/architecture.adoc`（通过 include 引用各概览）
- **部署运维**: `docs/deployment/`，环境配置变更同步更新
- **过程记录归档**: 实现过程、踩坑细节、废弃方案归档到 `docs/decisions/`
- **CLAUDE.md 目标 < 100 行**: 超过时使用 `/doc-sync clean` 瘦身
- **文档检查配置**: `.claude/doc-sync.yaml`
- **使用 `/doc-sync`**: 检查文档一致性、同步、瘦身
