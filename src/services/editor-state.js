class EditorState {
  constructor() {
    this.files = new Map();
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
    }
    this.activeFilePath = path;
    this._notify();
  }

  closeFile(path) {
    this.files.delete(path);
    if (this.activeFilePath === path) {
      const remaining = [...this.files.keys()];
      this.activeFilePath = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
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
    return [...this.files.entries()].map(([path, state]) => ({
      path,
      name: path.startsWith('__untitled_') ? 'untitled.adoc' : path.split('/').pop(),
      isDirty: state.isDirty,
    }));
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
