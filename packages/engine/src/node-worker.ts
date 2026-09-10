import { parentPort } from 'node:worker_threads';
import type { RendererToHostMessage } from '@dom-bridge/protocol';
import { createEngineHost, type EngineHostHandlers } from './engine-host.ts';

/** Node 版“JS 引擎线程”引导：同样没有 DOM，复用同一套代理层与业务代码。 */
export function bootNodeEngineWorker(handlers: EngineHostHandlers = {}): void {
  const port = parentPort;
  if (!port) throw new Error('bootNodeEngineWorker 必须在 worker 线程中运行');

  const runtime = createEngineHost(
    {
      post: (message) => port.postMessage(message),
      close: () => port.close(),
    },
    handlers,
  );

  port.on('message', (message: RendererToHostMessage) => {
    runtime.handleMessage(message);
  });
}
