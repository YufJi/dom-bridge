import type { NodeId } from '@dom-bridge/protocol';
import { ClassList } from './class-list.ts';
import { createDataset } from './dataset.ts';
import type {
  DispatchableNode,
  DispatchPhase,
  EventListener,
  EventListenerOptions,
  EventListenerOrOptions,
  NodeOwner,
  RegisteredListener,
  VirtualClassList,
  VirtualDataset,
  VirtualDocument,
  VirtualNode,
  VirtualStyle,
} from './types.ts';

const TEXT_TAG = '#text';
const FRAGMENT_TAG = '#fragment';

/**
 * 第三层 · 节点模型：元素 / 文本节点 / 文档片段的结构、属性、样式与监听注册。
 *
 * 所有会改变可见状态的写操作都通过 `owner.emit` 交给写路径，本层不做调度；
 * 文档片段（`#fragment`）只存在于引擎侧，它的增删改不会产生任何 op。
 *
 * TODO(dom-subset): 仍缺 cloneNode / normalize / splitText / 注释节点、
 * 真正的 NodeList 语义、innerHTML 系列与 querySelector 系列，见 `packages/engine/README.md`。
 */
export class DomNode implements DispatchableNode {
  readonly handle: NodeId;
  readonly tag: string;
  readonly kind: 'element' | 'text' | 'fragment';
  readonly children: DomNode[] = [];
  readonly style: VirtualStyle;
  parentNode: DomNode | null = null;
  text = '';

  private readonly owner: NodeOwner;
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, RegisteredListener[]>();
  private readonly registeredEvents = new Set<string>();
  private classListCache: VirtualClassList | null = null;
  private datasetCache: VirtualDataset | null = null;

  constructor(owner: NodeOwner, handle: NodeId, tag: string) {
    this.owner = owner;
    this.handle = handle;
    this.tag = tag;
    this.kind = tag === TEXT_TAG ? 'text' : tag === FRAGMENT_TAG ? 'fragment' : 'element';
    this.style = new Proxy({} as VirtualStyle, {
      get: (target, property) => (typeof property === 'string' ? target[property] : undefined),
      set: (target, property, value: unknown) => {
        if (typeof property !== 'string') return false;
        // 与 CSSOM 一致：null / undefined / 空字符串都表示“移除该样式”
        const next = value === null || value === undefined || value === '' ? null : String(value);
        if (next === null) delete target[property];
        else target[property] = next;
        owner.emit({ op: 'setStyle', id: this.handle, name: property, value: next });
        return true;
      },
      deleteProperty: (target, property) => {
        if (typeof property !== 'string' || !(property in target)) return true;
        delete target[property];
        owner.emit({ op: 'setStyle', id: this.handle, name: property, value: null });
        return true;
      },
    });
  }

  get nodeType(): number {
    if (this.kind === 'text') return 3;
    if (this.kind === 'fragment') return 11;
    return 1;
  }

  get nodeName(): string {
    if (this.kind === 'text') return '#text';
    if (this.kind === 'fragment') return '#document-fragment';
    return this.tag.toUpperCase();
  }

  get ownerDocument(): VirtualDocument {
    return this.owner.document;
  }

  get isConnected(): boolean {
    const parent = this.parentNode;
    return parent ? parent.isConnected : this === this.owner.document.body;
  }

  get classList(): VirtualClassList {
    this.classListCache ??= new ClassList(this);
    return this.classListCache;
  }

  get dataset(): VirtualDataset {
    this.datasetCache ??= createDataset(this);
    return this.datasetCache;
  }

  get id(): string {
    return this.attrs.get('id') ?? '';
  }

  set id(value: string) {
    this.setAttribute('id', value);
  }

  get className(): string {
    return this.attrs.get('class') ?? '';
  }

  set className(value: string) {
    this.setAttribute('class', value);
  }

  get firstChild(): VirtualNode | null {
    return this.children[0] ?? null;
  }

  get nextSibling(): VirtualNode | null {
    const parent = this.parentNode;
    if (!parent) return null;
    const index = parent.children.indexOf(this);
    return parent.children[index + 1] ?? null;
  }

  get textContent(): string {
    if (this.kind === 'text') return this.text;
    return this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    if (this.kind === 'text') {
      const text = String(value);
      if (text === this.text) return;
      this.text = text;
      this.owner.emit({ op: 'updateText', id: this.handle, text });
      return;
    }
    while (this.children.length > 0) {
      const first = this.children[0];
      if (!first) break;
      this.removeChild(first);
    }
    this.appendChild(this.owner.createTextNode(value));
  }

  appendChild(child: VirtualNode): VirtualNode {
    const node = this.asNode(child);
    if (node.kind === 'fragment') return this.insertFragment(node, null);
    node.parentNode?.removeChild(node);
    const index = this.children.length;
    this.children.push(node);
    node.parentNode = this;
    this.emitInsert(node, index);
    return node;
  }

  insertBefore(child: VirtualNode, reference: VirtualNode): VirtualNode {
    const node = this.asNode(child);
    const anchor = this.asNode(reference);
    if (anchor.parentNode !== this) return this.appendChild(node);
    if (node.kind === 'fragment') return this.insertFragment(node, anchor);
    node.parentNode?.removeChild(node);
    const index = this.children.indexOf(anchor);
    this.children.splice(index, 0, node);
    node.parentNode = this;
    this.emitInsert(node, index);
    return node;
  }

  replaceChild(child: VirtualNode, reference: VirtualNode): VirtualNode {
    const anchor = this.asNode(reference);
    if (anchor.parentNode !== this) {
      throw new Error('replaceChild: 参照节点不是当前节点的子节点');
    }
    const node = this.asNode(child);
    node.parentNode?.removeChild(node);

    if (node.kind === 'fragment') {
      this.insertFragment(node, anchor);
    } else {
      const index = this.children.indexOf(anchor);
      this.children.splice(index, 0, node);
      node.parentNode = this;
      this.emitInsert(node, index);
    }
    this.removeChild(anchor);
    return anchor;
  }

  removeChild(child: VirtualNode): VirtualNode {
    const node = this.asNode(child);
    const index = this.children.indexOf(node);
    if (index < 0) throw new Error('removeChild: 节点不是当前节点的子节点');
    this.children.splice(index, 1);
    node.parentNode = null;
    if (this.kind !== 'fragment') {
      this.owner.emit({ op: 'removeChild', parentId: this.handle, childId: node.handle });
    }
    return node;
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  contains(node: VirtualNode | null): boolean {
    let current: VirtualNode | null = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }

  setAttribute(name: string, value: string | null): void {
    const next = value === null ? null : String(value);
    this.owner.indexId(this, name, next);
    if (next === null) this.attrs.delete(name);
    else this.attrs.set(name, next);
    this.owner.emit({ op: 'setAttribute', id: this.handle, name, value: next });
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    if (!this.attrs.has(name)) return;
    this.setAttribute(name, null);
  }

  /** 属性名枚举（供 dataset 等视图使用，不属于 DOM 标准接口）。 */
  attributeNames(): string[] {
    return [...this.attrs.keys()];
  }

  addEventListener(type: string, listener: EventListener, options?: EventListenerOrOptions): void {
    const normalized = normalizeOptions(options);
    const entries = this.listeners.get(type) ?? [];
    const duplicate = entries.some(
      (entry) => entry.listener === listener && entry.capture === normalized.capture,
    );
    if (!duplicate) {
      entries.push({
        listener,
        capture: normalized.capture,
        once: normalized.once,
        passive: normalized.passive,
      });
      this.listeners.set(type, entries);
    }
    if (this.registeredEvents.has(type)) return;
    this.registeredEvents.add(type);
    this.owner.emit({ op: 'on', id: this.handle, type });
  }

  removeEventListener(
    type: string,
    listener: EventListener,
    options?: EventListenerOrOptions,
  ): void {
    const { capture } = normalizeOptions(options);
    const entries = this.listeners.get(type);
    if (!entries) return;

    const remaining = entries.filter(
      (entry) => entry.listener !== listener || entry.capture !== capture,
    );
    if (remaining.length === entries.length) return;
    if (remaining.length > 0) {
      this.listeners.set(type, remaining);
      return;
    }

    this.listeners.delete(type);
    if (!this.registeredEvents.has(type)) return;
    this.registeredEvents.delete(type);
    this.owner.emit({ op: 'off', id: this.handle, type });
  }

  listenersFor(type: string, phase: DispatchPhase): readonly RegisteredListener[] {
    const entries = this.listeners.get(type) ?? [];
    if (phase === 'at-target') return [...entries];
    const capture = phase === 'capture';
    return entries.filter((entry) => entry.capture === capture);
  }

  /** 把文档片段的子节点按顺序搬进当前节点（fragment 自身不参与桥接）。 */
  private insertFragment(fragment: DomNode, anchor: DomNode | null): VirtualNode {
    const moved = [...fragment.children];
    fragment.children.length = 0;
    for (const item of moved) {
      item.parentNode = null;
      if (anchor) this.insertBefore(item, anchor);
      else this.appendChild(item);
    }
    return fragment;
  }

  private emitInsert(node: DomNode, index: number): void {
    if (this.kind === 'fragment') return;
    this.owner.emit({ op: 'insertChild', parentId: this.handle, childId: node.handle, index });
  }

  private asNode(node: VirtualNode): DomNode {
    if (!(node instanceof DomNode)) {
      throw new Error('节点必须来自同一个虚拟文档');
    }
    return node;
  }
}

function normalizeOptions(options?: EventListenerOrOptions): Required<EventListenerOptions> {
  const source = typeof options === 'boolean' ? { capture: options } : (options ?? {});
  return {
    capture: source.capture ?? false,
    once: source.once ?? false,
    passive: source.passive ?? false,
  };
}
