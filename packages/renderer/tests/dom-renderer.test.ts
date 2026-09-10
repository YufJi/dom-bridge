// @vitest-environment happy-dom

import type { Op, RendererToHostMessage } from '@dom-bridge/protocol';
import { ROOT_ID } from '@dom-bridge/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { DomRenderer } from '../src/dom-renderer.ts';

interface Harness {
  screen: HTMLElement;
  renderer: DomRenderer;
  sent: RendererToHostMessage[];
  apply(...ops: Op[]): void;
}

function setup(): Harness {
  const screen = document.createElement('div');
  screen.id = 'screen';
  document.body.appendChild(screen);

  const sent: RendererToHostMessage[] = [];
  const renderer = new DomRenderer(screen, (message) => sent.push(message));
  renderer.highlight = false; // 测试里不需要闪烁动画

  return { screen, renderer, sent, apply: (...ops: Op[]) => renderer.apply({ batch: ops }) };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('DomRenderer', () => {
  it('把结构类 op 落到真实 DOM 上，并标注 data-vb-id', () => {
    const { screen, renderer } = setup();

    renderer.apply({
      batch: [
        { op: 'createElement', id: 1, tag: 'div' },
        { op: 'setAttribute', id: 1, name: 'id', value: 'app' },
        { op: 'createElement', id: 2, tag: 'span' },
        { op: 'createText', id: 3, text: '你好' },
        { op: 'insertChild', parentId: 2, childId: 3, index: 0 },
        { op: 'insertChild', parentId: 1, childId: 2, index: 0 },
        { op: 'insertChild', parentId: ROOT_ID, childId: 1, index: 0 },
      ],
    });

    const app = screen.querySelector('#app');
    expect(app).not.toBeNull();
    expect(app?.getAttribute('data-vb-id')).toBe('1');
    expect(app?.querySelector('span')?.textContent).toBe('你好');
    expect(renderer.stats.ops).toBe(7);
    expect(renderer.stats.batches).toBe(1);
  });

  it('支持 updateText 与 removeChild', () => {
    const { screen, apply } = setup();

    apply(
      { op: 'createElement', id: 1, tag: 'p' },
      { op: 'createText', id: 2, text: '旧文本' },
      { op: 'insertChild', parentId: 1, childId: 2, index: 0 },
      { op: 'insertChild', parentId: ROOT_ID, childId: 1, index: 0 },
      { op: 'updateText', id: 2, text: '新文本' },
    );
    expect(screen.querySelector('p')?.textContent).toBe('新文本');

    apply({ op: 'removeChild', parentId: ROOT_ID, childId: 1 });
    expect(screen.querySelector('p')).toBeNull();
  });

  it('把样式写成内联样式，并支持删除', () => {
    const { screen, apply } = setup();

    apply(
      { op: 'createElement', id: 1, tag: 'span' },
      { op: 'insertChild', parentId: ROOT_ID, childId: 1, index: 0 },
      { op: 'setStyle', id: 1, name: 'fontWeight', value: 'bold' },
      { op: 'setStyle', id: 1, name: 'color', value: 'red' },
    );
    const span = screen.querySelector('span');
    expect(span?.style.fontWeight).toBe('bold');
    expect(span?.style.color).toBe('red');

    apply({ op: 'setStyle', id: 1, name: 'color', value: null });
    expect(span?.style.color).toBe('');
  });

  it('on/off 会挂载和卸载原生事件监听，并把事件回传引擎', () => {
    const { screen, renderer, sent, apply } = setup();

    apply(
      { op: 'createElement', id: 1, tag: 'button' },
      { op: 'insertChild', parentId: ROOT_ID, childId: 1, index: 0 },
      { op: 'on', id: 1, type: 'click' },
    );

    const button = screen.querySelector('button');
    expect(button).not.toBeNull();
    button?.click();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'event', id: 1, type: 'click' });
    expect(renderer.stats.events).toBe(1);

    apply({ op: 'off', id: 1, type: 'click' });
    button?.click();
    expect(sent).toHaveLength(1);
  });

  it('simulateClick 用真实 DOM 事件触发已注册的监听', () => {
    const { renderer, sent, apply } = setup();

    apply(
      { op: 'createElement', id: 1, tag: 'button' },
      { op: 'insertChild', parentId: ROOT_ID, childId: 1, index: 0 },
      { op: 'on', id: 1, type: 'click' },
    );

    expect(renderer.simulateClick()).toBe(true);
    expect(sent).toHaveLength(1);

    apply({ op: 'off', id: 1, type: 'click' });
    expect(renderer.simulateClick()).toBe(false);
  });

  it('忽略非 op 协议消息', () => {
    const { renderer } = setup();

    renderer.apply({ kind: 'ready' });
    renderer.apply({ kind: 'eval-result', ok: true, value: 'ok' });

    expect(renderer.stats.batches).toBe(0);
  });

  it('同一次原生事件只上报一次，且带上真正的目标节点', () => {
    const { screen, sent, apply } = setup();

    apply(
      { op: 'createElement', id: 1, tag: 'div' },
      { op: 'insertChild', parentId: ROOT_ID, childId: 1, index: 0 },
      { op: 'createElement', id: 2, tag: 'button' },
      { op: 'insertChild', parentId: 1, childId: 2, index: 0 },
      { op: 'on', id: 1, type: 'click' },
      { op: 'on', id: 2, type: 'click' },
    );

    screen.querySelector('button')?.click();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'event', id: 2, type: 'click' });
  });
});
