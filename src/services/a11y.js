/**
 * 可访问性工具：让带 role="button" 的元素支持键盘激活（Enter / Space）。
 * 配合 tabindex="0" 使用：@keydown=${activateOnKey}
 */
export function activateOnKey(e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.currentTarget.click();
  }
}
