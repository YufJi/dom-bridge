import { type Op, ROOT_ID } from '@dom-bridge/protocol';
import { describe, expect, it, vi } from 'vitest';
import { TerminalRenderer } from '../src/terminal-renderer.ts';

const STRUCTURE_OPS: Op[] = [
  { op: 'createElement', id: 1, tag: 'div' },
  { op: 'setAttribute', id: 1, name: 'id', value: 'app' },
  { op: 'createElement', id: 2, tag: 'span' },
  { op: 'setStyle', id: 2, name: 'fontWeight', value: 'bold' },
  { op: 'createText', id: 3, text: 'hi' },
  { op: 'insertChild', parentId: 2, childId: 3, index: 0 },
  { op: 'insertChild', parentId: 1, childId: 2, index: 0 },
  { op: 'insertChild', parentId: ROOT_ID, childId: 1, index: 0 },
];

describe('TerminalRenderer', () => {
  it('把 op 流格式化成文本快照', () => {
    const renderer = new TerminalRenderer();
    renderer.apply({ batch: STRUCTURE_OPS });

    expect(renderer.format()).toEqual([
      '<body>',
      '  <div id="app">',
      '    <span style="font-weight:bold">',
      '      "hi"',
      '    </span>',
      '  </div>',
      '</body>',
    ]);
    expect(renderer.stats).toMatchObject({ ops: 8, batches: 1, events: 0 });
  });

  it('支持摘除节点', () => {
    const renderer = new TerminalRenderer();
    renderer.apply({ batch: STRUCTURE_OPS });
    renderer.apply({ batch: [{ op: 'removeChild', parentId: ROOT_ID, childId: 1 }] });

    expect(renderer.format()).toEqual(['<body></body>']);
  });

  it('simulateUserClick 只在有监听器的节点上触发，并把事件交给 onUserEvent', () => {
    const renderer = new TerminalRenderer();
    const onUserEvent = vi.fn();
    renderer.onUserEvent = onUserEvent;

    renderer.apply({ batch: STRUCTURE_OPS });
    expect(renderer.simulateUserClick()).toBe(false);

    renderer.apply({ batch: [{ op: 'on', id: 2, type: 'click' }] });
    expect(renderer.simulateUserClick()).toBe(true);
    expect(onUserEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'event', id: 2, type: 'click' }),
    );
    expect(renderer.stats.events).toBe(1);
  });

  it('onChange 会在每个批次后回调', () => {
    const renderer = new TerminalRenderer();
    const onChange = vi.fn();
    renderer.onChange = onChange;

    renderer.apply({ batch: STRUCTURE_OPS });
    renderer.apply({ kind: 'ready' });

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('clickTargets 按创建顺序返回可点击节点，并可指定点击目标', () => {
    const renderer = new TerminalRenderer();
    const onUserEvent = vi.fn();
    renderer.onUserEvent = onUserEvent;

    renderer.apply({
      batch: [
        ...STRUCTURE_OPS,
        { op: 'on', id: 2, type: 'click' },
        { op: 'on', id: 1, type: 'click' },
      ],
    });

    expect(renderer.clickTargets()).toEqual([1, 2]);
    expect(renderer.simulateUserClick(1)).toBe(true);
    expect(onUserEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'event', id: 1 }));
    expect(renderer.simulateUserClick(999)).toBe(false);
  });
});
