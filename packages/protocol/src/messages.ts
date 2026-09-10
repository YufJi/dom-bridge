import type { NodeId, Op } from './op.ts';

/** 渲染线程回传的用户输入细节。 */
export interface EventDetail {
  source?: string;
  key?: string;
  code?: string;
  value?: string;
  clientX?: number;
  clientY?: number;
  button?: number;
}

/** 引擎 → 渲染：批量变更信封（保持变更顺序）。 */
export interface OpBatchMessage {
  readonly batch: readonly Op[];
}

/** 渲染 → 引擎：用户输入。 */
export interface RemoteEventMessage {
  readonly kind: 'event';
  readonly id: NodeId;
  readonly type: string;
  readonly detail: EventDetail;
}

/** 渲染 → 引擎：调试用，把代码送进无 DOM 的引擎线程执行。 */
export interface EvalRequestMessage {
  readonly kind: 'eval';
  readonly code: string;
}

/** 引擎 → 渲染：eval 执行结果。 */
export interface EvalResultMessage {
  readonly kind: 'eval-result';
  readonly ok: boolean;
  readonly value: string;
}

/** 引擎 → 渲染：业务代码已加载完毕。 */
export interface ReadyMessage {
  readonly kind: 'ready';
}

/** 渲染 → 引擎：关闭引擎线程。 */
export interface ShutdownMessage {
  readonly kind: 'shutdown';
}

/** 渲染 → 引擎：选择并启动一个被托管应用。 */
export interface StartMessage {
  readonly kind: 'start';
  readonly appId: string;
}

/** 引擎 → 渲染：引擎线程内的启动 / 运行错误。 */
export interface HostErrorMessage {
  readonly kind: 'host-error';
  readonly message: string;
}

export type HostToRendererMessage =
  OpBatchMessage | EvalResultMessage | ReadyMessage | HostErrorMessage;

export type RendererToHostMessage =
  RemoteEventMessage | EvalRequestMessage | ShutdownMessage | StartMessage;

/** 引擎线程发送消息的通道。 */
export type HostTransport = (message: HostToRendererMessage) => void;

/** 渲染线程发送消息的通道。 */
export type RendererTransport = (message: RendererToHostMessage) => void;

export function isOpBatch(message: HostToRendererMessage): message is OpBatchMessage {
  return 'batch' in message;
}
