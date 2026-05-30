import { eventBus } from './event-bus.js';
import { editorState } from './editor-state.js';

class LinkIndex {
  constructor() {
    this._forward = new Map();   // filePath → Set<{target, anchor, line}>
    this._backward = new Map();  // filePath → Set<{source, anchor, line}>
    this._titles = new Map();    // filePath → title
    this._keywords = new Map();  // filePath → Set<string>
    this._tagIndex = new Map();  // tag → Set<filePath>
    this._tagIndexForFile = new Map(); // filePath → Set<tag>（反向查找用）
    this._allFiles = [];
  }

  async buildIndex(workspaceRoot) {
    if (!workspaceRoot) return;
    this._forward.clear();
    this._backward.clear();
    this._titles.clear();
    this._keywords.clear();
    this._tagIndex.clear();
    this._tagIndexForFile.clear();

    try {
      // 使用 Rust 端批量扫描，避免串行 IPC
      const invoke = window.__TAURI__.core.invoke;
      const [entries, metas] = await Promise.all([
        invoke('build_link_index', { workspaceRoot }),
        invoke('get_files_meta', { workspaceRoot }),
      ]);

      // 收集所有文件路径
      const allFiles = new Set();
      for (const e of entries) {
        allFiles.add(e.source);
        allFiles.add(e.target);
      }
      for (const m of metas) {
        allFiles.add(m.path);
      }
      this._allFiles = [...allFiles];

      // 构建正向索引
      for (const e of entries) {
        if (!this._forward.has(e.source)) this._forward.set(e.source, new Set());
        this._forward.get(e.source).add({
          target: e.target,
          anchor: e.anchor || null,
          line: e.line,
        });
      }

      // 构建反向索引
      for (const e of entries) {
        if (!this._backward.has(e.target)) this._backward.set(e.target, new Set());
        this._backward.get(e.target).add({
          source: e.source,
          anchor: e.anchor || null,
          line: e.line,
        });
      }

      // 填充元数据
      for (const m of metas) {
        this._titles.set(m.path, m.title);
        if (m.keywords && m.keywords.length > 0) {
          this._keywords.set(m.path, new Set(m.keywords));
          this._tagIndexForFile.set(m.path, new Set(m.keywords));
          for (const tag of m.keywords) {
            if (!this._tagIndex.has(tag)) this._tagIndex.set(tag, new Set());
            this._tagIndex.get(tag).add(m.path);
          }
        }
      }
    } catch (_) {}
  }

  async updateFile(filePath, content) {
    const ws = editorState.workspaceRoot;
    if (!ws) return;

    // 1. 清除该文件旧的反向引用（其他文件 → 此文件）
    this._backward.delete(filePath);

    // 2. 清除其他文件反向索引中来自此文件的条目
    for (const [, links] of this._backward) {
      for (const link of links) {
        if (link.source === filePath) links.delete(link);
      }
    }

    // 3. 移除旧的正向/元数据
    this._forward.delete(filePath);
    this._titles.delete(filePath);
    this._keywords.delete(filePath);

    // 4. 从 tagIndex 中移除该文件的旧标签
    const oldTags = this._tagIndexForFile.get(filePath);
    if (oldTags) {
      for (const tag of oldTags) {
        const files = this._tagIndex.get(tag);
        if (files) {
          files.delete(filePath);
          if (files.size === 0) this._tagIndex.delete(tag);
        }
      }
      this._tagIndexForFile.delete(filePath);
    }

    // 5. 重新解析此文件
    this._parseFile(filePath, content, ws);

    // 6. 根据新的正向链接，重建此文件的反向引用
    const forwardLinks = this._forward.get(filePath);
    if (forwardLinks) {
      for (const link of forwardLinks) {
        if (!this._backward.has(link.target)) this._backward.set(link.target, new Set());
        this._backward.get(link.target).add({ source: filePath, anchor: link.anchor, line: link.line });
      }
    }
  }

  _parseFile(filePath, content, workspaceRoot) {
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 解析文档标题
      if (i === 0 || (i < 5 && line.trim().startsWith('= '))) {
        const m = line.match(/^=\s+(.+)/);
        if (m) this._titles.set(filePath, m[1].trim());
      }

      // 解析 :keywords: 属性
      const kwMatch = line.match(/^:keywords:\s+(.+)/i);
      if (kwMatch) {
        const tags = kwMatch[1].split(',').map(t => t.trim()).filter(Boolean);
        this._keywords.set(filePath, new Set(tags));
        this._tagIndexForFile.set(filePath, new Set(tags));
        for (const tag of tags) {
          if (!this._tagIndex.has(tag)) this._tagIndex.set(tag, new Set());
          this._tagIndex.get(tag).add(filePath);
        }
      }

      // 解析 xref:target.adoc[...] 或 xref:target.adoc#anchor[...]
      const xrefMatches = line.matchAll(/xref:([^\[\s\]]+)(?:#([^\[\s\]]+))?\[/g);
      for (const m of xrefMatches) {
        this._addLink(filePath, m[1], m[2], i + 1, workspaceRoot);
      }

      // 解析 <<target.adoc#anchor,text>> 或 <<target,text>>
      const angleMatches = line.matchAll(/<<([^,>]+?)(?:#([^,>]+))?(?:,[^>]*)?>>/g);
      for (const m of angleMatches) {
        this._addLink(filePath, m[1], m[2], i + 1, workspaceRoot);
      }

      // 解析 include::target.adoc[]
      const includeMatches = line.matchAll(/include::([^\[]+)\[/g);
      for (const m of includeMatches) {
        this._addLink(filePath, m[1], null, i + 1, workspaceRoot);
      }
    }
  }

  _addLink(sourcePath, targetRef, anchor, line, workspaceRoot) {
    if (!targetRef || targetRef.startsWith('http') || targetRef.startsWith('#')) return;

    let targetPath;
    if (targetRef.startsWith('/')) {
      targetPath = workspaceRoot + targetRef;
    } else {
      // 相对于源文件所在目录
      const dir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
      targetPath = dir + '/' + targetRef;
    }

    // 标准化路径（去除 ./ 等）
    targetPath = this._normalizePath(targetPath);

    if (!this._forward.has(sourcePath)) this._forward.set(sourcePath, new Set());
    this._forward.get(sourcePath).add({ target: targetPath, anchor: anchor || null, line });
  }

  _normalizePath(p) {
    const parts = p.split('/');
    const result = [];
    for (const part of parts) {
      if (part === '..') result.pop();
      else if (part !== '.') result.push(part);
    }
    return result.join('/');
  }

  getBacklinks(filePath) {
    const links = this._backward.get(filePath);
    return links ? [...links] : [];
  }

  getForwardLinks(filePath) {
    const links = this._forward.get(filePath);
    return links ? [...links] : [];
  }

  getTitle(filePath) {
    return this._titles.get(filePath) || filePath.split('/').pop().replace(/\.(adoc|asciidoc|txt)$/, '');
  }

  getKeywords(filePath) {
    return this._keywords.get(filePath) || new Set();
  }

  getAllTags() {
    const tags = [];
    for (const [tag, files] of this._tagIndex) {
      tags.push({ tag, count: files.size });
    }
    return tags.sort((a, b) => b.count - a.count);
  }

  getFilesByTag(tag) {
    return [...(this._tagIndex.get(tag) || [])];
  }

  getAllFiles() {
    return this._allFiles;
  }

  // 获取用于知识图谱的节点和边
  getGraphData() {
    const nodes = new Map();
    for (const f of this._allFiles) {
      nodes.set(f, { id: f, label: this.getTitle(f), links: 0 });
    }
    const edges = [];
    for (const [src, links] of this._forward) {
      for (const link of links) {
        if (nodes.has(link.target)) {
          edges.push({ source: src, target: link.target });
          const s = nodes.get(src);
          if (s) s.links++;
          const t = nodes.get(link.target);
          if (t) t.links++;
        }
      }
    }
    return { nodes: [...nodes.values()], edges };
  }
}

export const linkIndex = new LinkIndex();

// 监听文件保存事件，增量更新索引
eventBus.on('file-saved', ({ path, content }) => {
  linkIndex.updateFile(path, content);
});
