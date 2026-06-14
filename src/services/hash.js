/**
 * 稳定字符串哈希（DJB2 变种），返回无符号 32 位十六进制字符串。
 * 同输入必同输出、跨运行时稳定，用于内容指纹做缓存 key。
 * 与 app-shell._hashPath 同算法；提取为公共工具以便复用与测试。
 */
export function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}
