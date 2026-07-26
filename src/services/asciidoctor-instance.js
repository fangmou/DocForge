// asciidoctor 单例：preview-pane 渲染与 outline-parser 解析共用同一实例，避免重复初始化（module.default() 开销不小）。
let instance = null;

/** 获取（必要时创建）共享的 asciidoctor 处理器实例 */
export async function getAsciidoctor() {
  if (!instance) {
    const module = await import('@asciidoctor/core');
    instance = module.default();
  }
  return instance;
}
