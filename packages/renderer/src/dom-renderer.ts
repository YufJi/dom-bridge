import {
  ROOT_ID,
  isOpBatch,
  type EventDetail,
  type HostToRendererMessage,
  type NodeId,
  type Op,
  type RendererTransport,
} from '@dom-bridge/protocol';
import type { RendererStats } from './types.ts';

/**
 * 渲染线程的实现之一：把 op 流落到真实 DOM 上。
 *
 * - 每个远端节点映射成一个真 DOM 节点，并带 data-vb-id 便于 DevTools 定位；
 * - on/off 直接转成原生 addEventListener / removeEventListener；
 * - 因此整条链路都能用 Elements / Event Listeners / Performance 面板调试。
 */

type ManagedNode = HTMLElement | Text;

interface BoundHandler {
  readonly element: EventTarget;
  readonly type: string;
  readonly handler: EventListener;
}

export class DomRenderer {
  readonly stats: RendererStats = { ops: 0, batches: 0, events: 0 };
  onBatch: ((ops: readonly Op[]) => void) | null = null;
  highlight = true;

  private readonly root: HTMLElement;
  private readonly send: RendererTransport;
  private readonly nodes = new Map<NodeId, ManagedNode>();
  private readonly boundHandlers = new Map<string, BoundHandler>();
  private readonly flashQueue = new Set<HTMLElement>();
  private readonly forwardedEvents = new WeakSet<Event>();
  private flashScheduled = false;

  constructor(root: HTMLElement, send: RendererTransport) {
    this.root = root;
    this.send = send;
    this.nodes.set(ROOT_ID, root);
    root.setAttribute('data-vb-id', String(ROOT_ID));
  }

  apply(message: HostToRendererMessage): void {
    if (!isOpBatch(message)) return;
    for (const op of message.batch) this.applyOp(op);
    this.stats.batches += 1;
    this.scheduleFlash();
    this.onBatch?.(message.batch);
  }

  /** 用原生 DOM 事件模拟用户操作：事件走浏览器真实事件流，再经 on 注册的 handler 回传。 */
  simulateClick(): boolean {
    const [id] = this.listenerIds('click');
    if (id === undefined) return false;
    const element = this.nodes.get(id);
    if (!(element instanceof HTMLElement)) return false;
    element.click();
    return true;
  }

  private applyOp(op: Op): void {
    this.stats.ops += 1;
    switch (op.op) {
      case 'createElement': {
        const element = document.createElement(op.tag);
        element.setAttribute('data-vb-id', String(op.id));
        this.nodes.set(op.id, element);
        this.touch(element);
        break;
      }
      case 'createText':
        this.nodes.set(op.id, document.createTextNode(op.text));
        break;
      case 'updateText': {
        const node = this.nodes.get(op.id);
        if (!node) break;
        if (node instanceof Text) node.data = op.text;
        else node.textContent = op.text;
        this.touch(node);
        break;
      }
      case 'insertChild': {
        const parent = this.nodes.get(op.parentId);
        const child = this.nodes.get(op.childId);
        if (!parent || !child) break;
        const reference = parent.childNodes[op.index] ?? null;
        parent.insertBefore(child, reference);
        this.touch(child);
        break;
      }
      case 'removeChild': {
        const parent = this.nodes.get(op.parentId);
        const child = this.nodes.get(op.childId);
        if (!parent || !child) break;
        if (child.parentNode === parent) parent.removeChild(child);
        break;
      }
      case 'setAttribute': {
        const node = this.nodes.get(op.id);
        if (!(node instanceof HTMLElement)) break;
        if (op.value === null) node.removeAttribute(op.name);
        else node.setAttribute(op.name, op.value);
        this.touch(node);
        break;
      }
      case 'setStyle': {
        const node = this.nodes.get(op.id);
        if (!(node instanceof HTMLElement)) break;
        if (op.name === 'cssText') node.style.cssText = op.value ?? '';
        else if (op.value === null) node.style.removeProperty(toKebabCase(op.name));
        else node.style.setProperty(toKebabCase(op.name), op.value);
        this.touch(node);
        break;
      }
      case 'on':
        this.addListener(op.id, op.type);
        break;
      case 'off':
        this.removeListener(op.id, op.type);
        break;
      default:
        console.warn('[dom-renderer] 未知 op:', op);
    }
  }

  private addListener(id: NodeId, type: string): void {
    const key = `${id}:${type}`;
    if (this.boundHandlers.has(key)) return;
    const element = this.nodes.get(id);
    if (!element) return;
    const handler: EventListener = (event) => {
      // 一次原生事件只上报一次：传播（捕获 / 目标 / 冒泡）由引擎侧负责，
      // 否则祖先和子节点都挂了监听时，同一次交互会被派发多次。
      if (this.forwardedEvents.has(event)) return;
      this.forwardedEvents.add(event);
      this.stats.events += 1;
      this.send({
        kind: 'event',
        id: this.resolveTargetId(event.target) ?? id,
        type,
        detail: extractDetail(type, event),
      });
    };
    element.addEventListener(type, handler);
    this.boundHandlers.set(key, { element, type, handler });
  }

  private removeListener(id: NodeId, type: string): void {
    const key = `${id}:${type}`;
    const entry = this.boundHandlers.get(key);
    if (!entry) return;
    entry.element.removeEventListener(entry.type, entry.handler);
    this.boundHandlers.delete(key);
  }

  private listenerIds(type: string): NodeId[] {
    const ids: NodeId[] = [];
    for (const key of this.boundHandlers.keys()) {
      if (key.endsWith(`:${type}`)) ids.push(Number(key.split(':')[0]));
    }
    return ids;
  }

  /** 从原生事件目标回溯出虚拟节点：监听器所在的节点不一定是事件目标。 */
  private resolveTargetId(target: EventTarget | null): NodeId | undefined {
    let node: Node | null = target instanceof Node ? target : null;
    while (node) {
      if (node instanceof Element) {
        const raw = node.getAttribute('data-vb-id');
        if (raw !== null) return Number(raw);
      }
      node = node.parentNode;
    }
    return undefined;
  }

  private touch(node: ManagedNode): void {
    if (!this.highlight) return;
    if (node instanceof HTMLElement && node !== this.root) this.flashQueue.add(node);
  }

  private scheduleFlash(): void {
    if (this.flashQueue.size === 0 || this.flashScheduled) return;
    this.flashScheduled = true;
    const nodes = [...this.flashQueue];
    this.flashQueue.clear();
    requestAnimationFrame(() => {
      this.flashScheduled = false;
      for (const node of nodes) node.classList.add('vb-flash');
      setTimeout(() => {
        for (const node of nodes) node.classList.remove('vb-flash');
      }, 320);
    });
  }
}

function toKebabCase(property: string): string {
  return property.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function extractDetail(type: string, event: Event): EventDetail {
  const detail: EventDetail = { source: 'dom' };

  if (type.startsWith('key') && 'key' in event) {
    const keyboard = event as KeyboardEvent;
    detail.key = keyboard.key;
    detail.code = keyboard.code;
  }

  if ((type === 'input' || type === 'change') && event.target instanceof HTMLInputElement) {
    detail.value = event.target.value;
  }

  if ('clientX' in event) {
    const mouse = event as MouseEvent;
    detail.clientX = Math.round(mouse.clientX);
    detail.clientY = Math.round(mouse.clientY);
    detail.button = mouse.button;
  }

  return detail;
}
