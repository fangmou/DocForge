// 插件加载器 — 扫描工作区 .docforge/plugins/ 目录，加载插件

import { pluginRegistry } from './plugin-registry.js';
import { eventBus } from './event-bus.js';
import { listDirectory, readFile, writeFile } from './file-service.js';

class PluginLoader {
  constructor() {
    this._loaded = new Set();
  }

  async loadAll(workspaceRoot) {
    // 先卸载旧插件
    this.unloadAll();

    if (!workspaceRoot) return;

    try {
      const pluginDir = workspaceRoot + '/.docforge/plugins';
      const entries = await listDirectory(pluginDir);
      const dirs = (entries || []).filter(e => e.is_dir);

      // 一次性读取启用状态
      const state = await this._loadState(workspaceRoot);

      for (const dir of dirs) {
        try {
          const manifestPath = dir.path + '/plugin.json';
          const manifestJson = await readFile(manifestPath);
          const manifest = JSON.parse(manifestJson);

          if (!manifest.id || !manifest.main || !manifest.extensionPoints) continue;

          // 检查启用状态（从已加载的 state 中查找）
          if (state[manifest.id] === false) continue;

          // 加载插件主文件
          const mainPath = dir.path + '/' + manifest.main;
          const mainCode = await readFile(mainPath);

          // 创建沙箱并执行
          const pluginExports = this._executeInSandbox(mainCode, manifest.id);

          // 注册扩展点
          pluginRegistry.register(manifest.id, {
            name: manifest.name || manifest.id,
            version: manifest.version || '0.1.0',
            description: manifest.description || '',
          }, pluginExports.extensionPoints || {});

          this._loaded.add(manifest.id);
        } catch (e) {
          console.warn(`插件加载失败 [${dir.name}]:`, e);
        }
      }
    } catch (_) {
      // 插件目录不存在，正常
    }
  }

  unloadAll() {
    for (const id of this._loaded) {
      pluginRegistry.unregister(id);
    }
    this._loaded.clear();
  }

  async _loadState(workspaceRoot) {
    try {
      const stateJson = await readFile(workspaceRoot + '/.docforge/plugins/_state.json');
      return JSON.parse(stateJson);
    } catch (_) {
      return {};
    }
  }

  async setEnabled(workspaceRoot, pluginId, enabled) {
    const state = await this._loadState(workspaceRoot);
    if (enabled) {
      delete state[pluginId];
    } else {
      state[pluginId] = false;
    }
    try {
      await writeFile(workspaceRoot + '/.docforge/plugins/_state.json', JSON.stringify(state, null, 2));
    } catch (_) {}
  }

  _executeInSandbox(code, pluginId) {
    // 沙箱：Function 构造器 + with + 冻结原型链 + strict mode
    const sandbox = Object.freeze({
      console: Object.freeze({
        log: (...args) => console.log(`[${pluginId}]`, ...args),
        warn: (...args) => console.warn(`[${pluginId}]`, ...args),
        error: (...args) => console.error(`[${pluginId}]`, ...args),
      }),
      eventBus: Object.freeze({
        on: (name, fn) => eventBus.on(name, fn),
        off: (name, fn) => eventBus.off(name, fn),
        emit: (name, data) => eventBus.emit(name, data),
      }),
      // 受限的 IPC 调用白名单
      invoke: async (cmd, args) => {
        const allowed = ['search_files', 'list_all_adoc_files', 'read_file', 'list_directory'];
        if (!allowed.includes(cmd)) throw new Error(`插件无权调用: ${cmd}`);
        return window.__TAURI__.core.invoke(cmd, args);
      },
      exports: {},
      module: Object.freeze({ exports: {} }),
    });

    try {
      // 用 Proxy 拦截未定义属性访问，阻止原型链逃逸
      const proxy = new Proxy(sandbox, {
        get(target, prop) {
          if (prop in target) return target[prop];
          return undefined;
        },
        set() { return false; },
        has() { return true; }, // 让 with 中所有属性查找都命中 proxy
      });
      const fn = new Function('sandbox', '"use strict";with(sandbox){' + code + '\nreturn(typeof exports!=="undefined"?exports:{})}');
      return fn(proxy);
    } catch (e) {
      console.error(`插件执行失败 [${pluginId}]:`, e);
      return {};
    }
  }

  getLoaded() {
    return [...this._loaded];
  }
}

export const pluginLoader = new PluginLoader();
