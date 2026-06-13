.PHONY: dev check lint test test-rust test-js test-watch \
       linux windows mac \
       pkg pkg-linux pkg-windows pkg-mac \
       clean info

# ========== 配置 ==========
APP_NAME    := docforge
SRC_DIR     := src-tauri
NPM         := npm
TAURI_CLI   := npx tauri

LINUX_TARGET   := x86_64-unknown-linux-gnu
WINDOWS_TARGET := x86_64-pc-windows-gnu

# ========== 日常开发 ==========

dev:
	WEBKIT_DISABLE_DMABUF_RENDERER=1 $(TAURI_CLI) dev

check: lint test

lint:
	cd $(SRC_DIR) && cargo clippy -- -W clippy::all

# ========== 测试 ==========

test: test-rust test-js

test-rust:
	cd $(SRC_DIR) && cargo test

test-js:
	npx vitest run

test-watch:
	npx vitest

# ========== 快速编译（开发测试）==========

linux: | node-modules
	$(TAURI_CLI) build --no-bundle
	@echo "=> $(SRC_DIR)/target/release/$(APP_NAME)"

windows: | node-modules cross-windows
	$(TAURI_CLI) build --no-bundle --target $(WINDOWS_TARGET)
	@echo "=> $(SRC_DIR)/target/$(WINDOWS_TARGET)/release/$(APP_NAME).exe"

mac: | node-modules
	$(TAURI_CLI) build --no-bundle --target x86_64-apple-darwin
	@echo "=> $(SRC_DIR)/target/x86_64-apple-darwin/release/$(APP_NAME)"

# ========== 打安装包（发布用，低频）==========

pkg: | node-modules
	$(TAURI_CLI) build
	@echo "=> $(SRC_DIR)/target/release/bundle/"

pkg-linux: | node-modules
	$(TAURI_CLI) build --target $(LINUX_TARGET)
	@echo "=> $(SRC_DIR)/target/$(LINUX_TARGET)/release/bundle/"

pkg-windows:
	@echo "WSL/Linux 下无法直接打 Windows NSIS 安装包：Tauri 在非 Windows 宿主上"
	@echo "调用 makensis.exe 会失败（见 tauri-apps/tauri#12312）。请在 Windows 原生环境打包："
	@echo "  PowerShell > cd <项目>; 运行 scripts/build-windows.ps1（bun 封装 install+build）"
	@echo "  产物: src-tauri/target/release/bundle/nsis/DocForge_<version>_x64-setup.exe"
	@echo "（WSL 内可用 'make windows' 产出 .exe 供快速测试；安装包需在 Windows 侧打。）"

pkg-mac:
	@uname -s | grep -q Darwin || { echo "需在 macOS 上运行"; exit 1; }
	$(TAURI_CLI) build --target x86_64-apple-darwin

# ========== 内部：环境自动准备 ==========

node-modules:
	@test -d node_modules || $(NPM) install

cross-windows:
	@rustup target list --installed | grep -q $(WINDOWS_TARGET) \
		|| rustup target add $(WINDOWS_TARGET)
	@which x86_64-w64-mingw32-gcc > /dev/null 2>&1 \
		|| sudo apt install -y mingw-w64

# ========== 清理 ==========

clean:
	rm -rf dist/
	cd $(SRC_DIR) && cargo clean

# ========== 信息 ==========

info:
	@echo "方谋文构 (Fangmou DocForge)"
	@echo ""
	@echo "日常:"
	@echo "  make dev          开发模式（热重载）"
	@echo "  make check        lint + 全部测试（交付前必跑）"
	@echo "  make lint         仅 Rust lint 检查"
	@echo "  make test         运行全部测试（Rust + JS）"
	@echo "  make test-rust    仅 Rust 测试"
	@echo "  make test-js      仅前端测试"
	@echo "  make linux        快速编译 Linux 可执行文件"
	@echo "  make windows      快速编译 Windows 可执行文件"
	@echo "  make mac          快速编译 macOS 可执行文件"
	@echo ""
	@echo "发布:"
	@echo "  make pkg          打当前平台安装包"
	@echo "  make pkg-linux    打 Linux 安装包 (.deb/.AppImage)"
	@echo "  make pkg-windows  提示如何在 Windows 原生环境打安装包"
	@echo "  make pkg-mac      打 macOS 安装包 (.dmg)"
	@echo ""
	@rustc --version 2>/dev/null || echo "Rust: 未安装"
	@node --version 2>/dev/null | sed 's/^/Node.js: /' || echo "Node.js: 未安装"
	@echo "平台: $$(uname -s)/$$(uname -m)"
