import type { HostToRendererMessage, Op } from '@dom-bridge/protocol';
import { describe, expect, it } from 'vitest';
import { createDomHost, type DomHost, type VirtualDocument } from '../src/index.ts';

interface Harness {
  host: DomHost;
  document: VirtualDocument;
  ops: Op[];
  reset(): void;
}

function setup(): Harness {
  const ops: Op[] = [];
  const { host, document } = createDomHost((message: HostToRendererMessage) => {
    if ('batch' in message) ops.push(...message.batch);
  });
  return {
    host,
    document,
    ops,
    reset: () => {
      host.flush();
      ops.length = 0;
    },
  };
}

describe('classList', () => {
  it('读写 class 属性，并与 className 同步', () => {
    const { document, host, ops, reset } = setup();
    const div = document.createElement('div');
    div.className = 'a';
    reset();

    div.classList.add('b', 'c');
    expect(div.className).toBe('a b c');
    expect(div.classList.contains('b')).toBe(true);
    expect(div.classList.toggle('b')).toBe(false);
    div.classList.remove('a');

    expect(div.classList.length).toBe(1);
    expect(div.classList.item(0)).toBe('c');
    expect(div.classList.value).toBe('c');

    host.flush();
    expect(ops).toEqual([
      { op: 'setAttribute', id: div.handle, name: 'class', value: 'a b c' },
      { op: 'setAttribute', id: div.handle, name: 'class', value: 'a c' },
      { op: 'setAttribute', id: div.handle, name: 'class', value: 'c' },
    ]);
  });

  it('重复添加同样的 token 不产生 op', () => {
    const { document, host, ops, reset } = setup();
    const div = document.createElement('div');
    div.classList.add('a');
    reset();

    div.classList.add('a');
    host.flush();

    expect(ops).toEqual([]);
  });

  it('非法 token 会抛错', () => {
    const { document } = setup();
    const div = document.createElement('div');

    expect(() => div.classList.add('a b')).toThrow(/非法的 token/);
    expect(() => div.classList.contains('')).toThrow(/非法的 token/);
  });
});

describe('dataset', () => {
  it('camelCase ↔ data-* 双向映射', () => {
    const { document } = setup();
    const div = document.createElement('div');

    div.dataset.userId = '42';
    div.dataset.done = '';
    expect(div.getAttribute('data-user-id')).toBe('42');
    expect(div.dataset.userId).toBe('42');
    expect(div.dataset.done).toBe('');
    expect('userId' in div.dataset).toBe(true);
    expect(Object.keys(div.dataset)).toEqual(['userId', 'done']);

    div.setAttribute('data-role', 'admin');
    expect(div.dataset.role).toBe('admin');

    delete div.dataset.userId;
    expect(div.getAttribute('data-user-id')).toBeNull();
    expect(div.dataset.userId).toBeUndefined();
    expect('userId' in div.dataset).toBe(false);
  });
});

describe('结构操作', () => {
  it('replaceChild 用新节点替换旧节点并返回旧节点', () => {
    const { document, host, ops, reset } = setup();
    const list = document.createElement('ul');
    const first = document.createElement('li');
    const second = document.createElement('li');
    const replacement = document.createElement('li');
    document.body.appendChild(list);
    list.appendChild(first);
    list.appendChild(second);
    reset();

    const removed = list.replaceChild(replacement, second);

    expect(removed).toBe(second);
    expect(list.children).toEqual([first, replacement]);
    expect(second.parentNode).toBeNull();
    host.flush();
    expect(ops).toEqual([
      { op: 'insertChild', parentId: list.handle, childId: replacement.handle, index: 1 },
      { op: 'removeChild', parentId: list.handle, childId: second.handle },
    ]);
  });

  it('remove() 从父节点摘下自己，contains() 沿祖先链判断', () => {
    const { document } = setup();
    const parent = document.createElement('div');
    const child = document.createElement('span');
    const grandchild = document.createElement('b');
    document.body.appendChild(parent);
    parent.appendChild(child);
    child.appendChild(grandchild);

    expect(parent.contains(child)).toBe(true);
    expect(parent.contains(grandchild)).toBe(true);
    expect(parent.contains(parent)).toBe(true);
    expect(grandchild.contains(parent)).toBe(false);
    expect(parent.contains(null)).toBe(false);

    child.remove();
    expect(child.parentNode).toBeNull();
    expect(parent.children).toHaveLength(0);
    expect(parent.contains(grandchild)).toBe(false);
  });

  it('提供 nodeType / nodeName / ownerDocument / isConnected', () => {
    const { document } = setup();
    const div = document.createElement('div');
    const text = document.createTextNode('hi');
    const fragment = document.createDocumentFragment();

    expect([div.nodeType, text.nodeType, fragment.nodeType]).toEqual([1, 3, 11]);
    expect([div.nodeName, text.nodeName, fragment.nodeName]).toEqual([
      'DIV',
      '#text',
      '#document-fragment',
    ]);
    expect(div.ownerDocument).toBe(document);
    expect(div.isConnected).toBe(false);

    document.body.appendChild(div);
    expect(div.isConnected).toBe(true);
    expect(fragment.isConnected).toBe(false);
  });
});

describe('文档片段', () => {
  it('片段内的增删不发 op，插入父节点时按顺序展开', () => {
    const { document, host, ops, reset } = setup();
    const list = document.createElement('ul');
    document.body.appendChild(list);

    const fragment = document.createDocumentFragment();
    const item1 = document.createElement('li');
    const item2 = document.createElement('li');
    reset();

    fragment.appendChild(item1);
    fragment.appendChild(item2);
    expect(fragment.children).toHaveLength(2);
    expect(ops).toEqual([]);

    list.appendChild(fragment);
    host.flush();

    expect(fragment.children).toHaveLength(0);
    expect(list.children).toEqual([item1, item2]);
    expect(item1.parentNode).toBe(list);
    expect(ops).toEqual([
      { op: 'insertChild', parentId: list.handle, childId: item1.handle, index: 0 },
      { op: 'insertChild', parentId: list.handle, childId: item2.handle, index: 1 },
    ]);
  });

  it('insertBefore 支持在参照节点前展开片段', () => {
    const { document } = setup();
    const list = document.createElement('ul');
    const existing = document.createElement('li');
    document.body.appendChild(list);
    list.appendChild(existing);

    const fragment = document.createDocumentFragment();
    const item1 = document.createElement('li');
    const item2 = document.createElement('li');
    fragment.appendChild(item1);
    fragment.appendChild(item2);

    list.insertBefore(fragment, existing);

    expect(list.children).toEqual([item1, item2, existing]);
  });
});
