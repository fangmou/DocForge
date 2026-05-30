class EditorState {
  constructor() {
    this.files = new Map();
    this.tabOrder = [];
    this.activeFilePath = null;
    this.workspaceRoot = null;
    this._listeners = new Set();
  }

  openFile(path, content) {
    if (!this.files.has(path)) {
      this.files.set(path, {
        content,
        scrollTop: 0,
        cursorPos: 0,
        isDirty: false,
      });
      this.tabOrder.push(path);
    }
    this.activeFilePath = path;
    this._notify();
  }

  closeFile(path) {
    this.files.delete(path);
    this.tabOrder = this.tabOrder.filter(p => p !== path);
    if (this.activeFilePath === path) {
      const idx = this.tabOrder.indexOf(path);
      // 切换到相邻标签
      const nextIdx = Math.min(idx, this.tabOrder.length - 1);
      this.activeFilePath = this.tabOrder.length > 0 ? this.tabOrder[Math.max(0, nextIdx)] : null;
    }
    this._notify();
  }

  reorderTab(fromPath, toPath) {
    const fromIdx = this.tabOrder.indexOf(fromPath);
    const toIdx = this.tabOrder.indexOf(toPath);
    if (fromIdx === -1 || toIdx === -1) return;
    this.tabOrder.splice(fromIdx, 1);
    this.tabOrder.splice(toIdx, 0, fromPath);
    this._notify();
  }

  setActiveFile(path) {
    if (this.activeFilePath === path) return;
    this.activeFilePath = path;
    this._notify();
  }

  updateContent(path, content) {
    const file = this.files.get(path);
    if (file && file.content !== content) {
      file.content = content;
      file.isDirty = true;
      this._notify();
    }
  }

  markSaved(path) {
    const file = this.files.get(path);
    if (file && file.isDirty) {
      file.isDirty = false;
      this._notify();
    }
  }

  getActiveFile() {
    if (!this.activeFilePath) return null;
    const data = this.files.get(this.activeFilePath);
    return data ? { path: this.activeFilePath, ...data } : null;
  }

  getFile(path) {
    return this.files.get(path) || null;
  }

  getOpenFiles() {
    return this.tabOrder
      .filter(path => this.files.has(path))
      .map(path => {
        const state = this.files.get(path);
        return {
          path,
          name: path.startsWith('__untitled_') ? 'untitled.adoc' : path.split('/').pop(),
          isDirty: state.isDirty,
        };
      });
  }

  getDirtyFiles() {
    return [...this.files.entries()]
      .filter(([, f]) => f.isDirty)
      .map(([path]) => path);
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify() {
    for (const fn of this._listeners) fn(this);
  }
}

export const editorState = new EditorState();
