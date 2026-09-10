import {
  ROOT_ID,
  type HostTransport,
  type NodeId,
  type Op,
  type RemoteEventMessage,
} from '@dom-bridge/protocol';
import { dispatchRemoteEvent } from './events.ts';
import { DomNode } from './node.ts';
import { OpQueue } from './op-queue.ts';
import type { DomHost, NodeOwner, VirtualDocument, VirtualNode } from './types.ts';

/**
 * 第五层 · 文档与宿主：句柄分配、节点注册表、id 索引，
 * 把写路径（OpQueue）、树模型（DomNode）、事件层组合成对外的 `document`。
 *
 * TODO(dom-subset): 句柄不回收（removeChild 之后节点仍留在注册表里，长生命周期页面会泄漏）；
 * 与渲染线程之间没有对账 / ack，两侧树漂移无法发现；`documentElement` 目前直接等于 body，
 * 也没有 head / title / createDocumentFragment。完整清单见 `packages/engine/README.md`。
 */
class DomHostImpl implements DomHost, NodeOwner {
  readonly document: VirtualDocument;

  private readonly nodes = new Map<NodeId, DomNode>();
  private readonly idIndex = new Map<string, DomNode>();
  private readonly queue: OpQueue;
  private nextId = 1;

  constructor(send: HostTransport) {
    this.queue = new OpQueue(send);
    const body = new DomNode(this, ROOT_ID, 'body');
    this.nodes.set(ROOT_ID, body);
    this.document = {
      body,
      documentElement: body,
      createElement: (tag) => this.createElement(tag),
      createTextNode: (text) => this.createTextNode(text),
      createDocumentFragment: () => this.createDocumentFragment(),
      getElementById: (id) => this.idIndex.get(id) ?? null,
    };
  }

  get pendingOpCount(): number {
    return this.queue.pendingCount;
  }

  flush(): void {
    this.queue.flush();
  }

  emit(op: Op): void {
    this.queue.emit(op);
  }

  createElement(tag: string): DomNode {
    const handle = this.nextId;
    this.nextId += 1;
    const node = new DomNode(this, handle, tag);
    this.nodes.set(handle, node);
    this.emit({ op: 'createElement', id: handle, tag });
    return node;
  }

  createTextNode(text: string): DomNode {
    const handle = this.nextId;
    this.nextId += 1;
    const node = new DomNode(this, handle, '#text');
    node.text = String(text);
    this.nodes.set(handle, node);
    this.emit({ op: 'createText', id: handle, text: node.text });
    return node;
  }

  /** 文档片段只存在于引擎侧：不进注册表、不发 op，插入父节点时才展开成若干 insertChild。 */
  createDocumentFragment(): DomNode {
    const handle = this.nextId;
    this.nextId += 1;
    return new DomNode(this, handle, '#fragment');
  }

  /** 维护 id 属性 → 节点的索引，供 document.getElementById 使用。 */
  indexId(node: VirtualNode, name: string, value: string | null): void {
    if (name !== 'id') return;
    if (value === null) {
      const previous = node.getAttribute('id');
      if (previous !== null) this.idIndex.delete(previous);
      return;
    }
    this.idIndex.set(value, node as DomNode);
  }

  dispatchRemoteEvent(message: RemoteEventMessage): void {
    dispatchRemoteEvent(this.nodes.get(message.id), message);
  }
}

export function createDomHost(send: HostTransport): {
  host: DomHost;
  document: VirtualDocument;
} {
  const host = new DomHostImpl(send);
  return { host, document: host.document };
}
