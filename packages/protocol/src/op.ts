/** 桥接层为每个远端节点分配的句柄。 */
export type NodeId = number;

/** 渲染树根（body）由渲染线程预置，引擎侧用 shadow tree 镜像它。 */
export const ROOT_ID: NodeId = 0;

/** 引擎 → 渲染：一次 DOM 变更。 */
export type Op =
  | { readonly op: 'createElement'; readonly id: NodeId; readonly tag: string }
  | { readonly op: 'createText'; readonly id: NodeId; readonly text: string }
  | { readonly op: 'updateText'; readonly id: NodeId; readonly text: string }
  | {
      readonly op: 'insertChild';
      readonly parentId: NodeId;
      readonly childId: NodeId;
      readonly index: number;
    }
  | { readonly op: 'removeChild'; readonly parentId: NodeId; readonly childId: NodeId }
  | {
      readonly op: 'setAttribute';
      readonly id: NodeId;
      readonly name: string;
      readonly value: string | null;
    }
  | {
      readonly op: 'setStyle';
      readonly id: NodeId;
      readonly name: string;
      readonly value: string | null;
    }
  | { readonly op: 'on'; readonly id: NodeId; readonly type: string }
  | { readonly op: 'off'; readonly id: NodeId; readonly type: string };

export type OpName = Op['op'];

/** 把 op 渲染成人类可读文本（调试面板、日志、测试共用）。 */
export function describeOp(op: Op): string {
  switch (op.op) {
    case 'createElement':
      return `#${op.id} <${op.tag}>`;
    case 'createText':
      return `#${op.id} "${op.text}"`;
    case 'updateText':
      return `#${op.id} ← "${op.text}"`;
    case 'insertChild':
      return `parent #${op.parentId} ← child #${op.childId} @${op.index}`;
    case 'removeChild':
      return `parent #${op.parentId} ✕ child #${op.childId}`;
    case 'setAttribute':
      return `#${op.id} ${op.name}=${op.value === null ? '(删除)' : JSON.stringify(op.value)}`;
    case 'setStyle':
      return `#${op.id} style.${op.name}=${op.value === null ? '(删除)' : op.value}`;
    case 'on':
      return `#${op.id} addEventListener('${op.type}')`;
    case 'off':
      return `#${op.id} removeEventListener('${op.type}')`;
    default:
      return assertNever(op);
  }
}

function assertNever(value: never): never {
  throw new Error(`未处理的 op: ${JSON.stringify(value)}`);
}
