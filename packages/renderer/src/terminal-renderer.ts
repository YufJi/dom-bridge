import {
  ROOT_ID,
  isOpBatch,
  type HostToRendererMessage,
  type NodeId,
  type Op,
  type RendererTransport,
} from '@dom-bridge/protocol';
import type { RendererStats } from './types.ts';

/**
 * 渲染线程的实现之二：终端文本快照。
 *
 * 它维护一棵镜像树并把当前树格式化成多行文本，消费的 op 流与真实 DOM 实现完全一致。
 */

interface MirrorNode {
  readonly id: NodeId;
  readonly tag: string;
  text: string | null;
  readonly attrs: Map<string, string>;
  readonly style: Map<string, string>;
  readonly children: MirrorNode[];
  parent: MirrorNode | null;
  readonly listeners: Set<string>;
}

export class TerminalRenderer {
  readonly stats: RendererStats = { ops: 0, batches: 0, events: 0 };
  onChange: ((renderer: TerminalRenderer) => void) | null = null;
  onUserEvent: RendererTransport | null = null;

  private readonly nodes = new Map<NodeId, MirrorNode>();
  private readonly root: MirrorNode;

  constructor() {
    this.root = this.createMirror(ROOT_ID, 'body', null);
  }

  apply(message: HostToRendererMessage): void {
    if (!isOpBatch(message)) return;
    for (const op of message.batch) this.applyOp(op);
    this.stats.batches += 1;
    this.onChange?.(this);
  }

  /** 当前所有注册了 click 监听的节点（演示脚本 / 调试用）。 */
  clickTargets(): NodeId[] {
    const targets: NodeId[] = [];
    for (const node of this.nodes.values()) {
      if (node.listeners.has('click')) targets.push(node.id);
    }
    return targets;
  }

  /** 模拟用户点击：默认点第一个注册了 click 的节点。 */
  simulateUserClick(target?: NodeId): boolean {
    const id = target ?? this.clickTargets()[0];
    if (id === undefined) return false;
    if (!this.nodes.get(id)?.listeners.has('click')) return false;
    this.fireUserEvent(id, 'click');
    return true;
  }

  format(): string[] {
    return formatNode(this.root, 0);
  }

  private fireUserEvent(id: NodeId, type: string): void {
    this.stats.events += 1;
    const node = this.nodes.get(id);
    console.log(`[renderer] 用户输入: ${type} → <${node?.tag ?? 'unknown'}> (id=${id})`);
    this.onUserEvent?.({
      kind: 'event',
      id,
      type,
      detail: { source: 'terminal', clientX: 120, clientY: 60 },
    });
  }

  private createMirror(id: NodeId, tag: string, text: string | null): MirrorNode {
    const node: MirrorNode = {
      id,
      tag,
      text,
      attrs: new Map(),
      style: new Map(),
      children: [],
      parent: null,
      listeners: new Set(),
    };
    this.nodes.set(id, node);
    return node;
  }

  private applyOp(op: Op): void {
    this.stats.ops += 1;
    switch (op.op) {
      case 'createElement':
        this.createMirror(op.id, op.tag, null);
        break;
      case 'createText':
        this.createMirror(op.id, '#text', op.text);
        break;
      case 'updateText': {
        const node = this.nodes.get(op.id);
        if (node) node.text = op.text;
        break;
      }
      case 'insertChild': {
        const parent = this.nodes.get(op.parentId);
        const child = this.nodes.get(op.childId);
        if (!parent || !child) break;
        if (child.parent) {
          const previous = child.parent.children.indexOf(child);
          if (previous >= 0) child.parent.children.splice(previous, 1);
        }
        parent.children.splice(Math.min(op.index, parent.children.length), 0, child);
        child.parent = parent;
        break;
      }
      case 'removeChild': {
        const parent = this.nodes.get(op.parentId);
        const child = this.nodes.get(op.childId);
        if (!parent || !child) break;
        const index = parent.children.indexOf(child);
        if (index >= 0) parent.children.splice(index, 1);
        child.parent = null;
        break;
      }
      case 'setAttribute': {
        const node = this.nodes.get(op.id);
        if (!node) break;
        if (op.value === null) node.attrs.delete(op.name);
        else node.attrs.set(op.name, op.value);
        break;
      }
      case 'setStyle': {
        const node = this.nodes.get(op.id);
        if (!node) break;
        if (op.value === null) node.style.delete(op.name);
        else node.style.set(op.name, op.value);
        break;
      }
      case 'on': {
        const node = this.nodes.get(op.id);
        if (node) node.listeners.add(op.type);
        break;
      }
      case 'off': {
        const node = this.nodes.get(op.id);
        if (node) node.listeners.delete(op.type);
        break;
      }
      default:
        console.warn('[terminal-renderer] 未知 op:', op);
    }
  }
}

function formatNode(node: MirrorNode, depth: number): string[] {
  const pad = '  '.repeat(depth);
  if (node.tag === '#text') return [`${pad}${JSON.stringify(node.text ?? '')}`];

  let open = `<${node.tag}`;
  for (const [name, value] of node.attrs) open += ` ${name}="${value}"`;

  const style = [...node.style].map(([name, value]) => `${toKebabCase(name)}:${value}`).join('; ');
  if (style) open += ` style="${style}"`;

  if (node.children.length === 0) return [`${pad}${open}></${node.tag}>`];

  const lines = [`${pad}${open}>`];
  for (const child of node.children) lines.push(...formatNode(child, depth + 1));
  lines.push(`${pad}</${node.tag}>`);
  return lines;
}

function toKebabCase(property: string): string {
  return property.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}
