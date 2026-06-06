import { eventBus } from './event-bus.js';
import { editorState } from './editor-state.js';

const invoke = () => window.__TAURI__.core.invoke;

class LinkIndex {
  constructor() {
    this._titleCache = new Map();
    this._ready = null; // Promise — 索引构建完成后 resolve
  }

  get ready() { return this._ready; }

  async buildIndex(workspaceRoot) {
    if (!workspaceRoot) return;
    this._ready = (async () => {
      await invoke()('build_link_index', { workspaceRoot });
      // 批量加载标题到本地缓存（补全高频调用用）
      const files = await invoke()('query_all_files');
      this._titleCache.clear();
      for (const f of files) {
        this._titleCache.set(f.path, f.title);
      }
    })();
    return this._ready;
  }

  async updateFile(filePath, content) {
    const ws = editorState.workspaceRoot;
    if (!ws) return;
    await invoke()('update_link_file', { filePath, content, workspaceRoot: ws });
    const title = await invoke()('query_title', { filePath });
    if (title) this._titleCache.set(filePath, title);
  }

  // 同步方法：补全代码在 .map() 循环中高频调用，不能 await
  getTitle(filePath) {
    return this._titleCache.get(filePath)
      || filePath.split('/').pop().replace(/\.(adoc|asciidoc|txt)$/, '');
  }

  async getBacklinks(filePath) {
    return invoke()('query_backlinks', { filePath });
  }

  async getForwardLinks(filePath) {
    return invoke()('query_forward_links', { filePath });
  }

  async getAllTags() {
    return invoke()('query_all_tags');
  }

  async getTagsForFile(filePath) {
    return invoke()('query_tags_for_file', { filePath });
  }

  async getFilesByTag(tag) {
    return invoke()('query_files_by_tag', { tag });
  }

  async getAllFiles() {
    const files = await invoke()('query_all_files');
    return files.map(f => f.path);
  }

  async getGraphData() {
    return invoke()('query_graph_data');
  }

  async getHeadings(filePath) {
    return invoke()('query_headings', { filePath });
  }

  async addTagToFile(filePath, content, tag) {
    return invoke()('add_tag_to_file', { filePath, content, tag });
  }
}

export const linkIndex = new LinkIndex();

// 监听文件保存事件，增量更新索引
eventBus.on('file-saved', ({ path, content }) => {
  linkIndex.updateFile(path, content);
});
