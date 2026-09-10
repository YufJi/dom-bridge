import { describe, expect, it, vi } from 'vitest';
import type { HostToRendererMessage, RendererToHostMessage } from '@dom-bridge/protocol';
import { createBridge, type BridgeEvent, type BridgeRenderer } from '../src/index.ts';
import type { EngineChannel } from '../src/channel.ts';

interface FakeChannel {
  channel: EngineChannel;
  readonly posted: RendererToHostMessage[];
  emit(message: HostToRendererMessage): void;
  fail(message: string): void;
  readonly closeCount: number;
}

function createFakeChannel(): FakeChannel {
  const posted: RendererToHostMessage[] = [];
  let messageListener: ((message: HostToRendererMessage) => void) | null = null;
  let errorListener: ((message: string) => void) | null = null;
  const counters = { close: 0 };

  return {
    channel: {
      post: (message) => posted.push(message),
      onMessage: (listener) => {
        messageListener = listener;
      },
      onError: (listener) => {
        errorListener = listener;
      },
      close: async () => {
        counters.close += 1;
      },
    },
    posted,
    emit: (message) => messageListener?.(message),
    fail: (message) => errorListener?.(message),
    get closeCount() {
      return counters.close;
    },
  };
}

function createRenderer(): BridgeRenderer & { applied: number } {
  const renderer = {
    applied: 0,
    apply: () => {
      renderer.applied += 1;
    },
  };
  return renderer;
}

describe('createBridge', () => {
  it('把 op 批次交给渲染器，并累计 ops / batches', () => {
    const fake = createFakeChannel();
    const bridge = createBridge(fake.channel);
    const renderer = createRenderer();
    bridge.attachRenderer(renderer);

    fake.emit({ batch: [{ op: 'createElement', id: 1, tag: 'div' }] });
    fake.emit({ batch: [] });

    expect(renderer.applied).toBe(2);
    expect(bridge.stats.batches).toBe(2);
    expect(bridge.stats.ops).toBe(1);
  });

  it('用户事件经 transport 发出，并统计往返耗时', () => {
    const fake = createFakeChannel();
    let clock = 0;
    const bridge = createBridge(fake.channel, { now: () => clock });

    bridge.transport({ kind: 'event', id: 7, type: 'click', detail: {} });
    expect(fake.posted).toEqual([{ kind: 'event', id: 7, type: 'click', detail: {} }]);
    expect(bridge.stats.events).toBe(1);
    expect(bridge.stats.lastRoundTripMs).toBeNull();

    clock = 12.5;
    fake.emit({ batch: [] });
    expect(bridge.stats.lastRoundTripMs).toBe(12.5);
  });

  it('把 ready / eval-result / error 转成订阅事件', () => {
    const fake = createFakeChannel();
    const bridge = createBridge(fake.channel);
    const events: BridgeEvent[] = [];
    bridge.subscribe((event) => events.push(event));

    fake.emit({ kind: 'ready' });
    fake.emit({ kind: 'eval-result', ok: true, value: '已插入' });
    fake.emit({ kind: 'host-error', message: '未知应用: nope' });
    fake.fail('boom');

    expect(events).toEqual([
      { type: 'ready' },
      { type: 'eval-result', ok: true, value: '已插入' },
      { type: 'error', message: '未知应用: nope' },
      { type: 'error', message: 'boom' },
    ]);
  });

  it('取消订阅后不再收到事件', () => {
    const fake = createFakeChannel();
    const bridge = createBridge(fake.channel);
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);

    fake.emit({ kind: 'ready' });
    unsubscribe();
    fake.emit({ kind: 'ready' });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('runEval 与 shutdown 分别发送 eval 消息、关闭通道', async () => {
    const fake = createFakeChannel();
    const bridge = createBridge(fake.channel);

    bridge.runEval("document.body.appendChild(document.createElement('hr'))");
    expect(fake.posted).toEqual([
      { kind: 'eval', code: "document.body.appendChild(document.createElement('hr'))" },
    ]);

    await bridge.shutdown();
    expect(fake.closeCount).toBe(1);
  });
});
