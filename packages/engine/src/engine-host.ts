import type { HostToRendererMessage, RendererToHostMessage } from '@dom-bridge/protocol';
import { createDomHost, type VirtualDocument } from './dom/index.ts';

/** 引擎线程与宿主之间的发送通道（Web Worker / worker_threads 各自实现）。 */
export interface EngineTransport {
  post(message: HostToRendererMessage): void;
  /** 引擎线程自行收尾：Web Worker 用 self.close()，Node 用 port.close()。 */
  close(): void;
}

/** 把消息交给应用层时附带的上下文。 */
export interface EngineHostContext {
  readonly document: VirtualDocument;
  post(message: HostToRendererMessage): void;
}

/**
 * 应用层回调：引擎不认识的消息原样交给它。
 *
 * 引擎只负责协议里直接作用于 DOM 代理的三类消息（event / eval / shutdown），
 * 不掺任何应用、业务或"挂载哪个应用"的语义。
 */
export interface EngineHostHandlers {
  onAppMessage?(message: RendererToHostMessage, context: EngineHostContext): void;
  /** 是否允许调试用的 eval（默认开启）。 */
  allowEval?: boolean;
}

export interface EngineHost {
  readonly document: VirtualDocument;
  handleMessage(message: RendererToHostMessage): void;
}

export function createEngineHost(
  transport: EngineTransport,
  handlers: EngineHostHandlers = {},
): EngineHost {
  const { host, document } = createDomHost((message) => transport.post(message));
  const context: EngineHostContext = {
    document,
    post: (message) => transport.post(message),
  };

  // 仅供本地调试：把代码送进无 DOM 的引擎线程执行（间接 eval，不触发 no-eval）
  const runEval = (code: string): void => {
    try {
      const value = (0, eval)(code);
      transport.post({ kind: 'eval-result', ok: true, value: String(value) });
    } catch (error) {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      transport.post({ kind: 'eval-result', ok: false, value: detail });
    }
  };

  const handleMessage = (message: RendererToHostMessage): void => {
    switch (message.kind) {
      case 'event':
        // 应用还没挂载时也不会出错：空文档没有任何监听器
        host.dispatchRemoteEvent(message);
        return;
      case 'eval':
        if (handlers.allowEval !== false) runEval(message.code);
        return;
      case 'shutdown':
        transport.close();
        return;
      default:
        handlers.onAppMessage?.(message, context);
    }
  };

  return { document, handleMessage };
}
