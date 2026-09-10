import {
  type HostToRendererMessage,
  isOpBatch,
  type Op,
  type RendererTransport,
} from '@dom-bridge/protocol';
import type { EngineChannel } from './channel.ts';

export type { EngineChannel } from './channel.ts';

export interface BridgeStats {
  ops: number;
  batches: number;
  events: number;
  /** 从发出用户事件到收到下一批 op 的耗时（近似值）。 */
  lastRoundTripMs: number | null;
}

export type BridgeEvent =
  | { readonly type: 'ready' }
  | { readonly type: 'batch'; readonly ops: readonly Op[]; readonly stats: BridgeStats }
  | { readonly type: 'eval-result'; readonly ok: boolean; readonly value: string }
  | { readonly type: 'error'; readonly message: string };

/** 桥接层只要求渲染器能消费消息，不关心它是真实 DOM 还是终端实现。 */
export interface BridgeRenderer {
  apply(message: HostToRendererMessage): void;
}

export interface BridgeOptions {
  /** 可注入的时钟，便于测试统计逻辑。 */
  now?: () => number;
}

export interface Bridge {
  /** 交给渲染器使用：渲染线程发出的消息都会经过这里并计入统计。 */
  readonly transport: RendererTransport;
  readonly stats: BridgeStats;
  attachRenderer(renderer: BridgeRenderer): void;
  subscribe(listener: (event: BridgeEvent) => void): () => void;
  /** 调试用：在引擎线程里执行代码。 */
  runEval(code: string): void;
  shutdown(): Promise<void>;
}

export function createBridge(channel: EngineChannel, options: BridgeOptions = {}): Bridge {
  const now = options.now ?? defaultNow;
  const listeners = new Set<(event: BridgeEvent) => void>();
  const stats: BridgeStats = { ops: 0, batches: 0, events: 0, lastRoundTripMs: null };

  let renderer: BridgeRenderer | null = null;
  let pendingEventAt: number | null = null;

  const emit = (event: BridgeEvent): void => {
    for (const listener of [...listeners]) listener(event);
  };

  const transport: RendererTransport = (message) => {
    if (message.kind === 'event') {
      stats.events += 1;
      pendingEventAt = now();
    }
    channel.post(message);
  };

  channel.onMessage((message) => {
    if (isOpBatch(message)) {
      renderer?.apply(message);
      stats.batches += 1;
      stats.ops += message.batch.length;
      if (pendingEventAt !== null) {
        stats.lastRoundTripMs = now() - pendingEventAt;
        pendingEventAt = null;
      }
      emit({ type: 'batch', ops: message.batch, stats });
      return;
    }

    // ready / host-error 是应用生命周期消息：桥接层只做转发，不解释其业务含义
    if (message.kind === 'ready') {
      emit({ type: 'ready' });
      return;
    }

    if (message.kind === 'eval-result') {
      emit({ type: 'eval-result', ok: message.ok, value: message.value });
      return;
    }

    if (message.kind === 'host-error') {
      emit({ type: 'error', message: message.message });
    }
  });

  channel.onError((message) => emit({ type: 'error', message }));

  return {
    transport,
    stats,
    attachRenderer: (next) => {
      renderer = next;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    runEval: (code) => channel.post({ kind: 'eval', code }),
    shutdown: () => channel.close(),
  };
}

function defaultNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
