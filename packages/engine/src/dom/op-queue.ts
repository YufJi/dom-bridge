import type { HostTransport, Op } from '@dom-bridge/protocol';

/**
 * 第二层 · 写路径：把 shadow tree 的变更攒成批次发给渲染线程。
 * 只关心"何时发、发多少"，不解释 op 语义，也不接触节点树。
 *
 * TODO(dom-subset): 目前只是朴素的攒批 —— 缺少 op 合并（连续写同一个样式属性
 * 会重复入队）、按帧调度与背压；详见 `packages/engine/README.md`。
 */
export class OpQueue {
  private readonly send: HostTransport;
  private queue: Op[] = [];
  private scheduled = false;

  constructor(send: HostTransport) {
    this.send = send;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  emit(op: Op): void {
    this.queue.push(op);
    if (this.scheduled) return;
    this.scheduled = true;
    scheduleFlush(() => this.flush());
  }

  flush(): void {
    this.scheduled = false;
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    this.send({ batch });
  }
}

/** Node 用 setImmediate，浏览器 Worker 只有 setTimeout —— 这里做运行时回退。 */
const scheduleFlush: (task: () => void) => void = resolveFlushScheduler();

function resolveFlushScheduler(): (task: () => void) => void {
  const candidate = (globalThis as { setImmediate?: (task: () => void) => void }).setImmediate;
  if (typeof candidate === 'function') return candidate;
  return (task) => setTimeout(task, 0);
}
