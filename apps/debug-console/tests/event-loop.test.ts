// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createDomHost, type DomHost, type VirtualDocument } from '@dom-bridge/engine';
import type { HostToRendererMessage } from '@dom-bridge/protocol';
import { DomRenderer } from '@dom-bridge/renderer/dom';

/**
 * 引擎 ↔ 渲染器的联调：不经过 worker / 桥接层，直接把两侧接起来。
 * 关注两条契约：
 * 1. 渲染线程每次用户交互只上报一条 event，且携带真正的目标节点；
 * 2. 传播（捕获 → 目标 → 冒泡）完全由引擎侧负责。
 */
function connect(): {
  host: DomHost;
  document: VirtualDocument;
  screen: HTMLElement;
  renderer: DomRenderer;
} {
  const screen = document.createElement('div');
  document.body.appendChild(screen);

  let dispatch: ((message: RemoteEventMessage) => void) | null = null;
  const renderer = new DomRenderer(screen, (message) => {
    if (message.kind === 'event') dispatch?.(message);
  });
  const { host, document: virtualDocument } = createDomHost((message: HostToRendererMessage) =>
    renderer.apply(message),
  );
  dispatch = (message) => host.dispatchRemoteEvent(message);
  host.flush();

  return { host, document: virtualDocument, screen, renderer };
}

describe('事件回路', () => {
  it('一次点击只上报一次，且按捕获 → 目标 → 冒泡派发', () => {
    const { host, document, screen, renderer } = connect();
    const order: string[] = [];

    const container = document.createElement('div');
    const button = document.createElement('button');
    document.body.appendChild(container);
    container.appendChild(button);
    host.flush();

    container.addEventListener('click', () => order.push('container:capture'), true);
    button.addEventListener('click', () => order.push('button:target'));
    container.addEventListener('click', () => order.push('container:bubble'));
    host.flush();

    screen.querySelector('button')?.click();

    expect(order).toEqual(['container:capture', 'button:target', 'container:bubble']);
    expect(renderer.stats.events).toBe(1);
  });

  it('点击没有监听器的子节点时，事件仍以子节点为目标冒泡到祖先', () => {
    const { host, document, screen } = connect();
    const targets: number[] = [];

    const container = document.createElement('div');
    const label = document.createElement('span');
    document.body.appendChild(container);
    container.appendChild(label);
    host.flush();

    container.addEventListener('click', (event) => targets.push(event.target.handle));
    host.flush();

    screen.querySelector('span')?.click();

    expect(targets).toEqual([label.handle]);
  });
});
