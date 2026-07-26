/**
 * tab 溢出分区纯函数。
 *
 * 给定每个 tab 的水平几何区间 [left, right) 与可视区 [scrollLeft, scrollLeft+clientWidth)，
 * 分出「被左侧遮挡」与「被右侧遮挡」的 tab path 列表。
 *
 * 判定采用「部分遮挡」语义：只要 tab 有任何一部分落在可视区外（哪怕只是横跨边界
 * 露出一半），就归入对应方向的溢出列表——这样溢出按钮在任何遮挡发生时都会出现，
 * 而非要求整块 tab 完全移出可视区。
 *
 * 组件负责 DOM 测量（offsetLeft/offsetWidth/scrollLeft/clientWidth），本函数只做几何判断，便于单测。
 *
 * @param {Array<{path:string,left:number,right:number}>} items 各 tab 的水平区间
 * @param {number} scrollLeft 可视区左边界（.tabs-track.scrollLeft）
 * @param {number} clientWidth 可视区宽度（.tabs-track.clientWidth）
 * @returns {{left:string[], right:string[]}}
 */
export function partitionOverflow(items, scrollLeft, clientWidth) {
  const rightEdge = scrollLeft + clientWidth;
  const left = [];
  const right = [];
  for (const it of items) {
    const leftOut = it.left < scrollLeft; // 左边缘被可视区左边界遮挡
    const rightOut = it.right > rightEdge; // 右边缘超出可视区右边界
    // 横跨整个可视区的超大 tab（仅当 clientWidth < 单个 tab 宽度，极端窄屏才会出现）：
    // 它部分可见、仍可点击或横向滚动访问，不进下拉，以免与可视区重复列出
    if (leftOut && rightOut) continue;
    if (leftOut) left.push(it.path);
    else if (rightOut) right.push(it.path);
  }
  return { left, right };
}
