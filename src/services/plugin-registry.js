// 插件注册表 — 单例，维护扩展点到插件实现的映射

class PluginRegistry {
  constructor() {
    this._plugins = new Map();     // pluginId → {meta, instances}
    this._extensions = new Map();  // extensionPoint → [{pluginId, implementation}]
  }

  register(pluginId, meta, extensionPoints) {
    this._plugins.set(pluginId, { meta, extensionPoints });
    for (const [point, impl] of Object.entries(extensionPoints)) {
      if (!this._extensions.has(point)) this._extensions.set(point, []);
      this._extensions.get(point).push({ pluginId, implementation: impl });
    }
  }

  unregister(pluginId) {
    const plugin = this._plugins.get(pluginId);
    if (!plugin) return;
    for (const point of Object.keys(plugin.extensionPoints)) {
      const list = this._extensions.get(point);
      if (list) {
        const idx = list.findIndex(e => e.pluginId === pluginId);
        if (idx >= 0) list.splice(idx, 1);
      }
    }
    this._plugins.delete(pluginId);
  }

  getAll(extensionPoint) {
    return this._extensions.get(extensionPoint) || [];
  }

  getRegistered() {
    return [...this._plugins.entries()].map(([id, { meta }]) => ({ id, ...meta }));
  }

  clear() {
    this._plugins.clear();
    this._extensions.clear();
  }
}

export const pluginRegistry = new PluginRegistry();
