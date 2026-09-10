import type { EventDetail, NodeId, Op, RemoteEventMessage } from '@dom-bridge/protocol';

/**
 * 第一层 · 契约：被托管应用能看到的全部 DOM 能力都是这里的接口。
 *
 * 这是 DOM 的一个**子集**而非完整实现：已实现能力与缺口清单见
 * `packages/engine/README.md`，代码里对应的缺口用 `TODO(dom-subset)` 标注。
 */

export type EventListener = (event: VirtualEvent) => void;

/** 与 DOM 的 addEventListener 选项对齐（`capture` 也接受布尔简写）。 */
export interface EventListenerOptions {
  capture?: boolean;
  once?: boolean;
  passive?: boolean;
}

export type EventListenerOrOptions = boolean | EventListenerOptions;

/** 事件阶段常量，数值与 DOM 规范一致。 */
export const CAPTURING_PHASE = 1;
export const AT_TARGET = 2;
export const BUBBLING_PHASE = 3;

export type DispatchPhase = 'capture' | 'at-target' | 'bubble';

export interface VirtualEvent {
  readonly type: string;
  readonly target: VirtualNode;
  readonly detail: EventDetail;
  /** 该事件类型是否冒泡（focus / blur 等不冒泡）。 */
  readonly bubbles: boolean;
  currentTarget: VirtualNode;
  /** 1 capturing / 2 at target / 3 bubbling。 */
  eventPhase: number;
  defaultPrevented: boolean;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
  preventDefault(): void;
}

/** 内联样式对象：`node.style.color = 'red'` 会触发一条 setStyle op。 */
export interface VirtualStyle {
  [property: string]: string | undefined;
}

/** `data-*` 属性视图：`dataset.userId` ↔ `data-user-id`。 */
export interface VirtualDataset {
  [key: string]: string | undefined;
}

export interface VirtualClassList {
  readonly length: number;
  readonly value: string;
  item(index: number): string | null;
  contains(token: string): boolean;
  add(...tokens: string[]): void;
  remove(...tokens: string[]): void;
  toggle(token: string, force?: boolean): boolean;
}

export interface VirtualNode {
  /** 桥接句柄，与渲染线程上的节点一一对应。 */
  readonly handle: NodeId;
  readonly tag: string;
  readonly kind: 'element' | 'text' | 'fragment';
  /** 1 element / 3 text / 11 fragment（与 DOM 的 Node.nodeType 一致）。 */
  readonly nodeType: number;
  readonly nodeName: string;
  readonly ownerDocument: VirtualDocument;
  readonly isConnected: boolean;
  readonly children: readonly VirtualNode[];
  readonly firstChild: VirtualNode | null;
  readonly nextSibling: VirtualNode | null;
  readonly style: VirtualStyle;
  readonly classList: VirtualClassList;
  readonly dataset: VirtualDataset;
  parentNode: VirtualNode | null;
  /** DOM 的 id 属性（注意与桥接句柄 handle 区分）。 */
  id: string;
  className: string;
  textContent: string;
  appendChild(child: VirtualNode): VirtualNode;
  insertBefore(child: VirtualNode, reference: VirtualNode): VirtualNode;
  replaceChild(child: VirtualNode, reference: VirtualNode): VirtualNode;
  removeChild(child: VirtualNode): VirtualNode;
  /** 从父节点上摘下自己（对应 DOM 的 ChildNode.remove()）。 */
  remove(): void;
  contains(node: VirtualNode | null): boolean;
  setAttribute(name: string, value: string | null): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: EventListener, options?: EventListenerOrOptions): void;
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: EventListenerOrOptions,
  ): void;
}

export interface VirtualDocument {
  readonly body: VirtualNode;
  readonly documentElement: VirtualNode;
  createElement(tag: string): VirtualNode;
  createTextNode(text: string): VirtualNode;
  createDocumentFragment(): VirtualNode;
  getElementById(id: string): VirtualNode | null;
}

export interface DomHost {
  readonly document: VirtualDocument;
  /** 已入队但尚未发送的 op 数（调试 / 测试用）。 */
  readonly pendingOpCount: number;
  /** 立刻把已入队的 op 发送出去。 */
  flush(): void;
  dispatchRemoteEvent(message: RemoteEventMessage): void;
}

/** 已注册监听器（含选项），事件层据此决定在哪个阶段调用。 */
export interface RegisteredListener {
  readonly listener: EventListener;
  readonly capture: boolean;
  readonly once: boolean;
  readonly passive: boolean;
}

/** 事件层需要的节点能力：让派发逻辑不必知道节点注册表。 */
export interface DispatchableNode extends VirtualNode {
  listenersFor(type: string, phase: DispatchPhase): readonly RegisteredListener[];
}

/** 节点回调其所属文档的最小接口，避免树模型直接依赖 host 实现。 */
export interface NodeOwner {
  readonly document: VirtualDocument;
  createTextNode(text: string): VirtualNode;
  emit(op: Op): void;
  indexId(node: VirtualNode, name: string, value: string | null): void;
}
