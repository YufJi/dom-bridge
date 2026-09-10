import { describe, expect, it } from 'vitest';
import { describeOp, isOpBatch, type Op } from '../src/index.ts';

describe('describeOp', () => {
  const cases: Array<[Op, string]> = [
    [{ op: 'createElement', id: 1, tag: 'div' }, '#1 <div>'],
    [{ op: 'createText', id: 2, text: 'hi' }, '#2 "hi"'],
    [{ op: 'updateText', id: 2, text: 'yo' }, '#2 ← "yo"'],
    [{ op: 'insertChild', parentId: 1, childId: 2, index: 0 }, 'parent #1 ← child #2 @0'],
    [{ op: 'removeChild', parentId: 1, childId: 2 }, 'parent #1 ✕ child #2'],
    [{ op: 'setAttribute', id: 1, name: 'id', value: 'app' }, '#1 id="app"'],
    [{ op: 'setAttribute', id: 1, name: 'id', value: null }, '#1 id=(删除)'],
    [{ op: 'setStyle', id: 1, name: 'color', value: 'red' }, '#1 style.color=red'],
    [{ op: 'setStyle', id: 1, name: 'color', value: null }, '#1 style.color=(删除)'],
    [{ op: 'on', id: 1, type: 'click' }, "#1 addEventListener('click')"],
    [{ op: 'off', id: 1, type: 'click' }, "#1 removeEventListener('click')"],
  ];

  it.each(cases)('把 %o 描述成 "%s"', (op, expected) => {
    expect(describeOp(op)).toBe(expected);
  });
});

describe('isOpBatch', () => {
  it('区分批次消息与其它协议消息', () => {
    expect(isOpBatch({ batch: [] })).toBe(true);
    expect(isOpBatch({ kind: 'ready' })).toBe(false);
    expect(isOpBatch({ kind: 'eval-result', ok: true, value: 'ok' })).toBe(false);
  });
});
