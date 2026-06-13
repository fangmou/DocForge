// 方谋文构 (Fangmou DocForge) 入口
import './app.css';
import './components/toolbar-main.js';
import './components/sidebar-filetree.js';
import './components/tab-bar.js';
import './components/editor-pane.js';
import './components/preview-pane.js';
import './components/ai-panel.js';
import './components/search-panel.js';
import './components/outline-panel.js';
import './components/template-panel.js';
import './components/context-menu.js';
import './components/status-bar.js';
import './components/settings-dialog.js';
import './components/backlinks-panel.js';
import './components/tags-panel.js';
import './components/export-history-panel.js';
import './components/graph-view.js';
import './components/plugin-manager-panel.js';
import './components/quick-switcher.js';
import './components/app-shell.js';

// F12 切换 DevTools（需 Rust 端启用 devtools feature）
document.addEventListener('keydown', (e) => {
  if (e.key === 'F12') {
    e.preventDefault();
    window.__TAURI_INTERNALS__?.invoke('toggle_devtools').catch(() => {});
  }
});
