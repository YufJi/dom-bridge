import type { HostToRendererMessage, RendererToHostMessage } from '@dom-bridge/protocol';
import { createEngineHost, type EngineHostHandlers } from './engine-host.ts';

/**
 * 浏览器版“JS 引擎线程”引导：在没有 DOM 的 ES module Worker 里启动被托管的应用。
 *
 * 这里只用到 Worker 全局的极小子集，因此手写接口而不是引入 lib.webworker，
 * 避免与主线程代码的 DOM 类型互相污染。
 */
interface WorkerScope {
  onmessage: ((event: { data: RendererToHostMessage }) => void) | null;
  postMessage(message: HostToRendererMessage): void;
  close(): void;
  document?: unknown;
  window?: unknown;
}

export function bootWebEngineWorker(handlers: EngineHostHandlers = {}): void {
  const scope = globalThis as unknown as WorkerScope;
  const runtime = createEngineHost(
    {
      post: (message) => scope.postMessage(message),
      close: () => scope.close(),
    },
    handlers,
  );

  // 给业务代码一个“浏览器感”的全局环境，但 document 是代理而不是真实 DOM
  scope.document = runtime.document;
  scope.window = scope;

  scope.onmessage = (event) => runtime.handleMessage(event.data);
}
