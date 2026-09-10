import type { HostToRendererMessage } from '@dom-bridge/protocol';

export interface RendererStats {
  ops: number;
  batches: number;
  events: number;
}

/** 渲染线程（真实 DOM / 终端预览）共同遵守的最小契约。 */
export interface RendererLike {
  readonly stats: RendererStats;
  apply(message: HostToRendererMessage): void;
}
