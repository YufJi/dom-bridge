import type { HostToRendererMessage, Op } from '@dom-bridge/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  AT_TARGET,
  BUBBLING_PHASE,
  CAPTURING_PHASE,
  createDomHost,
  type DomHost,
  type VirtualDocument,
  type VirtualEvent,
  type VirtualNode,
} from '../src/index.ts';

interface Harness {
  host: DomHost;
  document: VirtualDocument;
  root: VirtualNode;
  middle: VirtualNode;
  leaf: VirtualNode;
  ops: Op[];
}

function setup(): Harness {
  const ops: Op[] = [];
  const { host, document } = createDomHost((message: HostToRendererMessage) => {
    if ('batch' in message) ops.push(...message.batch);
  });

  const root = document.createElement('div');
  const middle = document.createElement('div');
  const leaf = document.createElement('button');
  document.body.appendChild(root);
  root.appendChild(middle);
  middle.appendChild(leaf);

  return { host, document, root, middle, leaf, ops };
}

const click = (host: DomHost, id: number): void => {
  host.dispatchRemoteEvent({ kind: 'event', id, type: 'click', detail: {} });
};

describe('事件传播', () => {
  it('按捕获 → 目标 → 冒泡的顺序派发，并带正确的 eventPhase', () => {
    const { host, root, middle, leaf } = setup();
    const order: string[] = [];

    root.addEventListener('click', (event) => order.push(`root:capture:${event.eventPhase}`), true);
    middle.addEventListener('click', () => order.push('middle:capture'), { capture: true });
    leaf.addEventListener('click', (event) => order.push(`leaf:target:${event.eventPhase}`));
    middle.addEventListener('click', () => order.push('middle:bubble'));
    root.addEventListener('click', (event) => order.push(`root:bubble:${event.eventPhase}`));

    click(host, leaf.handle);

    expect(order).toEqual([
      `root:capture:${CAPTURING_PHASE}`,
      'middle:capture',
      `leaf:target:${AT_TARGET}`,
      'middle:bubble',
      `root:bubble:${BUBBLING_PHASE}`,
    ]);
  });

  it('事件对象携带 target / currentTarget / detail', () => {
    const { host, middle, leaf } = setup();
    const seen: Array<[number, number, unknown]> = [];

    middle.addEventListener('click', (event: VirtualEvent) => {
      seen.push([event.target.handle, event.currentTarget.handle, event.detail]);
    });
    click(host, leaf.handle);

    expect(seen).toEqual([[leaf.handle, middle.handle, {}]]);
  });

  it('stopPropagation 中断后续阶段，stopImmediatePropagation 还中断同节点的后续监听', () => {
    const { host, root, middle, leaf } = setup();
    const order: string[] = [];

    root.addEventListener('click', () => order.push('root:bubble'));
    middle.addEventListener('click', (event) => {
      order.push('middle:first');
      event.stopPropagation();
    });
    middle.addEventListener('click', () => order.push('middle:second'));
    leaf.addEventListener('click', (event) => {
      order.push('leaf:first');
      event.stopImmediatePropagation();
    });
    leaf.addEventListener('click', () => order.push('leaf:second'));

    click(host, leaf.handle);

    expect(order).toEqual(['leaf:first']);
  });

  it('不冒泡的事件类型不会到达祖先（但捕获阶段仍会经过）', () => {
    const { host, middle, leaf } = setup();
    const order: string[] = [];

    middle.addEventListener('focus', () => order.push('middle:capture'), true);
    middle.addEventListener('focus', () => order.push('middle:bubble'));
    leaf.addEventListener('focus', () => order.push('leaf:target'));

    host.dispatchRemoteEvent({ kind: 'event', id: leaf.handle, type: 'focus', detail: {} });

    expect(order).toEqual(['middle:capture', 'leaf:target']);
  });
});

describe('监听器选项', () => {
  it('once 只触发一次，并在触发时摘掉监听', () => {
    const { host, leaf, ops } = setup();
    const listener = vi.fn();
    leaf.addEventListener('click', listener, { once: true });
    ops.length = 0;

    click(host, leaf.handle);
    click(host, leaf.handle);

    expect(listener).toHaveBeenCalledTimes(1);
    host.flush();
    expect(ops.map((op) => op.op)).toContain('off');
  });

  it('removeEventListener 需要 capture 选项匹配', () => {
    const { host, leaf } = setup();
    const capturing = vi.fn();
    leaf.addEventListener('click', capturing, true);

    leaf.removeEventListener('click', capturing);
    click(host, leaf.handle);
    expect(capturing).toHaveBeenCalledTimes(1);

    leaf.removeEventListener('click', capturing, { capture: true });
    click(host, leaf.handle);
    expect(capturing).toHaveBeenCalledTimes(1);
  });

  it('passive 选项被接受（当前没有默认行为可阻止）', () => {
    const { host, leaf } = setup();
    const listener = vi.fn();
    leaf.addEventListener('click', listener, { passive: true });

    expect(() => click(host, leaf.handle)).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
