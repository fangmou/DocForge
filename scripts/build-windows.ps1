# scripts/build-windows.ps1
# 在 Windows 原生环境（PowerShell）打 NSIS 安装包（bun + Tauri）。
# 用法：.\scripts\build-windows.ps1
# 封装：bun install + bunx tauri build --bundles nsis
# 前置：VS 2022 Build Tools(含 C++)、bun、Rust(msvc)、NSIS。
#       详见 docs/deployment/setup.adoc「Windows 安装包」一节。
$ErrorActionPreference = 'Stop'

# 切到项目根（脚本位于 scripts/ 下）
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host '==> bun install' -ForegroundColor Cyan
bun install
if ($LASTEXITCODE -ne 0) { throw 'bun install 失败' }

Write-Host '==> tauri build --bundles nsis' -ForegroundColor Cyan
bunx tauri build --bundles nsis
if ($LASTEXITCODE -ne 0) { throw 'tauri build 失败' }

Write-Host '==> 完成。产物：src-tauri\target\release\bundle\nsis\DocForge_*_x64-setup.exe' -ForegroundColor Green
