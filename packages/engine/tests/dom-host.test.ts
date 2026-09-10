import { describe, expect, it, vi } from 'vitest';
import type { HostToRendererMessage, Op } from '@dom-bridge/protocol';
import {
  createDomHost,
  type DomHost,
  type VirtualDocument,
  type VirtualEvent,
} from '../src/index.ts';

interface Harness {
  host: DomHost;
  document: VirtualDocument;
  batches: Op[][];
}

function setup(): Harness {
  const batches: Op[][] = [];
  const { host, document } = createDomHost((message: HostToRendererMessage) => {
    if ('batch' in message) batches.push([...message.batch]);
  });
  return { host, document, batches };
}

const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function opNames(ops: readonly Op[]): string[] {
  return ops.map((op) => op.op);
}

function firstBatch(batches: readonly Op[][]): readonly Op[] {
  const [batch] = batches;
  if (!batch) throw new Error('没有收到任何批次');
  return batch;
}

describe('createDomHost', () => {
  it('把多次变更合并成一个批次，flush 后队列清空', async () => {
    const { host, document, batches } = setup();

    const div = document.createElement('div');
    div.id = 'app';
    document.body.appendChild(div);

    expect(host.pendingOpCount).toBe(3);
    await nextTick();

    expect(batches).toHaveLength(1);
    expect(opNames(firstBatch(batches))).toEqual(['createElement', 'setAttribute', 'insertChild']);
    expect(host.pendingOpCount).toBe(0);
  });

  it('appendChild 会把节点从原父节点摘下再挂到新父节点', () => {
    const { document } = setup();

    const left = document.createElement('div');
    const right = document.createElement('div');
    const child = document.createElement('span');
    document.body.appendChild(left);
    document.body.appendChild(right);

    left.appendChild(child);
    right.appendChild(child);

    expect(left.children).toHaveLength(0);
    expect(right.children[0]).toBe(child);
    expect(child.parentNode).toBe(right);
  });

  it('insertBefore 按参照节点插入并保持顺序', () => {
    const { document } = setup();

    const list = document.createElement('ul');
    const first = document.createElement('li');
    const second = document.createElement('li');
    const inserted = document.createElement('li');
    document.body.appendChild(list);
    list.appendChild(first);
    list.appendChild(second);

    list.insertBefore(inserted, second);

    expect(list.children).toEqual([first, inserted, second]);
  });

  it('给元素设置 textContent 会清空子节点并写入新的文本节点', async () => {
    const { document, batches } = setup();

    const span = document.createElement('span');
    span.textContent = '第一次';
    span.textContent = '第二次';

    expect(span.children).toHaveLength(1);
    expect(span.textContent).toBe('第二次');

    await nextTick();
    const names = opNames(firstBatch(batches));
    expect(names).toContain('removeChild');
    expect(names.filter((name) => name === 'createText')).toHaveLength(2);
  });

  it('直接改文本节点的 textContent 只发送 updateText', async () => {
    const { document, batches } = setup();

    const span = document.createElement('span');
    span.textContent = '第一版';
    const textNode = span.firstChild;
    if (!textNode) throw new Error('缺少文本节点');

    textNode.textContent = '第二版';

    expect(span.textContent).toBe('第二版');
    await nextTick();
    const update = firstBatch(batches).find((op) => op.op === 'updateText');
    expect(update).toEqual({ op: 'updateText', id: textNode.handle, text: '第二版' });
  });

  it('style 代理发送 setStyle，值置空时发送 null（表示删除）', async () => {
    const { document, batches } = setup();

    const box = document.createElement('div');
    box.style.color = 'red';
    box.style.fontWeight = 'bold';
    box.style.color = '';

    await nextTick();
    const ops = firstBatch(batches);
    expect(opNames(ops)).toEqual(['createElement', 'setStyle', 'setStyle', 'setStyle']);
    expect(ops[1]).toEqual({ op: 'setStyle', id: box.handle, name: 'color', value: 'red' });
    expect(ops[3]).toEqual({ op: 'setStyle', id: box.handle, name: 'color', value: null });
    expect(box.style.color).toBeUndefined();
  });

  it('delete 样式属性同样会发送 setStyle(null)', async () => {
    const { document, batches } = setup();

    const box = document.createElement('div');
    box.style.color = 'red';
    delete box.style.color;

    await nextTick();
    const ops = firstBatch(batches);
    expect(ops[2]).toEqual({ op: 'setStyle', id: box.handle, name: 'color', value: null });
    expect(box.style.color).toBeUndefined();
  });

  it('getElementById 跟随 id 属性的增删', () => {
    const { document } = setup();

    const div = document.createElement('div');
    div.id = 'app';
    expect(document.getElementById('app')).toBe(div);

    div.removeAttribute('id');
    expect(document.getElementById('app')).toBeNull();
  });

  it('回传事件会先派发到目标、再冒泡到祖先', () => {
    const { host, document } = setup();

    const parent = document.createElement('div');
    const child = document.createElement('button');
    document.body.appendChild(parent);
    parent.appendChild(child);

    const order: string[] = [];
    parent.addEventListener('click', () => order.push('parent'));
    child.addEventListener('click', (event: VirtualEvent) => {
      order.push('child');
      expect(event.target).toBe(child);
      expect(event.currentTarget).toBe(child);
    });

    host.dispatchRemoteEvent({ kind: 'event', id: child.handle, type: 'click', detail: {} });

    expect(order).toEqual(['child', 'parent']);
  });

  it('stopPropagation 能中断冒泡', () => {
    const { host, document } = setup();

    const parent = document.createElement('div');
    const child = document.createElement('button');
    document.body.appendChild(parent);
    parent.appendChild(child);

    const order: string[] = [];
    parent.addEventListener('click', () => order.push('parent'));
    child.addEventListener('click', (event: VirtualEvent) => {
      order.push('child');
      event.stopPropagation();
    });

    host.dispatchRemoteEvent({ kind: 'event', id: child.handle, type: 'click', detail: {} });

    expect(order).toEqual(['child']);
  });

  it('移除最后一个监听器会发送 off op，且不再触发回调', async () => {
    const { host, document, batches } = setup();

    const button = document.createElement('button');
    const listener = vi.fn();
    button.addEventListener('click', listener);
    button.removeEventListener('click', listener);

    await nextTick();
    expect(opNames(batches.flat())).toContain('off');

    host.dispatchRemoteEvent({ kind: 'event', id: button.handle, type: 'click', detail: {} });
    expect(listener).not.toHaveBeenCalled();
  });

  it('在没有 setImmediate 的环境（浏览器 Worker）里回退到 setTimeout', async () => {
    const original = globalThis.setImmediate;
    Reflect.deleteProperty(globalThis, 'setImmediate');

    try {
      vi.resetModules();
      const module = await import('../src/dom/index.ts');
      const batches: Op[][] = [];
      const { document } = module.createDomHost((message) => {
        if ('batch' in message) batches.push([...message.batch]);
      });

      document.body.appendChild(document.createElement('span'));
      expect(batches).toHaveLength(0);

      await nextTick();
      expect(batches).toHaveLength(1);
    } finally {
      globalThis.setImmediate = original;
    }
  });
});
