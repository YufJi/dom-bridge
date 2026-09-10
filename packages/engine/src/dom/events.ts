import type { EventDetail, RemoteEventMessage } from '@dom-bridge/protocol';
import {
  AT_TARGET,
  BUBBLING_PHASE,
  CAPTURING_PHASE,
  type DispatchableNode,
  type DispatchPhase,
  type RegisteredListener,
  type VirtualEvent,
  type VirtualNode,
} from './types.ts';

/**
 * 第四层 · 事件：把渲染线程回传的一次用户交互变成合成事件，按捕获 → 目标 → 冒泡派发。
 *
 * 渲染线程只上报一次交互（目标节点 + 类型），传播完全由这里负责，
 * 因此 `stopPropagation()` / `stopImmediatePropagation()` / `once` 都是引擎侧语义。
 *
 * TODO(dom-subset): `preventDefault()` 仍只置标记，没有默认行为的消费者；
 * 也没有应用侧 `dispatchEvent()`，见 `packages/engine/README.md`。
 */
export function dispatchRemoteEvent(
  target: DispatchableNode | undefined,
  message: RemoteEventMessage,
): void {
  if (!target) return;

  const event = new SyntheticEvent(
    message.type,
    target,
    message.detail,
    !NON_BUBBLING.has(message.type),
  );
  const path = pathToRoot(target);

  event.eventPhase = CAPTURING_PHASE;
  for (const node of path.slice(1).reverse()) {
    if (event.propagationStopped) return;
    invoke(node, 'capture', event);
  }

  event.eventPhase = AT_TARGET;
  invoke(target, 'at-target', event);
  if (event.propagationStopped || !event.bubbles) return;

  event.eventPhase = BUBBLING_PHASE;
  for (const node of path.slice(1)) {
    if (event.propagationStopped) return;
    invoke(node, 'bubble', event);
  }
}

/** 与 DOM 对齐的常用不冒泡事件类型。 */
const NON_BUBBLING = new Set([
  'blur',
  'error',
  'focus',
  'load',
  'mouseenter',
  'mouseleave',
  'toggle',
]);

function invoke(node: VirtualNode, phase: DispatchPhase, event: SyntheticEvent): void {
  event.currentTarget = node;
  for (const entry of listenersFor(node, phase, event.type)) {
    if (event.immediatePropagationStopped) return;
    if (entry.once) {
      node.removeEventListener(event.type, entry.listener, { capture: entry.capture });
    }
    try {
      entry.listener(event);
    } catch (error) {
      console.error('[dom-host] 事件监听器抛错:', error);
    }
  }
}

function pathToRoot(target: DispatchableNode): DispatchableNode[] {
  const path: DispatchableNode[] = [target];
  let current: VirtualNode | null = target.parentNode;
  while (current) {
    path.push(current as DispatchableNode);
    current = current.parentNode;
  }
  return path;
}

/** 只有实现了监听能力的节点（DomNode）参与派发。 */
function listenersFor(
  node: VirtualNode,
  phase: DispatchPhase,
  type: string,
): readonly RegisteredListener[] {
  const candidate = node as Partial<DispatchableNode>;
  return typeof candidate.listenersFor === 'function' ? candidate.listenersFor(type, phase) : [];
}

class SyntheticEvent implements VirtualEvent {
  readonly type: string;
  readonly target: VirtualNode;
  readonly detail: EventDetail;
  readonly bubbles: boolean;
  currentTarget: VirtualNode;
  eventPhase = CAPTURING_PHASE;
  defaultPrevented = false;

  private stopped = false;
  private immediateStopped = false;

  constructor(type: string, target: VirtualNode, detail: EventDetail, bubbles: boolean) {
    this.type = type;
    this.target = target;
    this.detail = detail;
    this.bubbles = bubbles;
    this.currentTarget = target;
  }

  get propagationStopped(): boolean {
    return this.stopped;
  }

  get immediatePropagationStopped(): boolean {
    return this.immediateStopped;
  }

  stopPropagation(): void {
    this.stopped = true;
  }

  stopImmediatePropagation(): void {
    this.stopped = true;
    this.immediateStopped = true;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}
