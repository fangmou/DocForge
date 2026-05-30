// 滚动同步 — 直接函数调用替代 CustomEvent，零 GC 开销
let _syncPreview = null; // 编辑器滚动 → 预览跟随
let _syncEditor = null;  // 预览滚动 → 编辑器跟随

export function setPreviewSync(fn) { _syncPreview = fn; }
export function setEditorSync(fn) { _syncEditor = fn; }
export function syncPreview(ratio) { _syncPreview?.(ratio); }
export function syncEditor(ratio) { _syncEditor?.(ratio); }
