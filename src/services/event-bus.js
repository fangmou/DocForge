// 简单的事件总线
class EventBus extends EventTarget {
  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
  on(name, handler) {
    this.addEventListener(name, (e) => handler(e.detail));
  }
  off(name, handler) {
    this.removeEventListener(name, (e) => handler(e.detail));
  }
}

export const eventBus = new EventBus();
