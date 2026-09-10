import type { HostToRendererMessage, RendererToHostMessage } from '@dom-bridge/protocol';
import type { EngineChannel } from './channel.ts';

/**
 * 浏览器侧通道：把一个 Worker 实例适配成 EngineChannel。
 *
 * Worker 由宿主创建，且必须写成 `new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' })`
 * 这种内联形式 —— 打包器要能静态识别它，才会产出独立的 worker chunk。
 */
export function createWebWorkerChannel(worker: Worker): EngineChannel {
  // 引擎线程可能在通道监听器挂载前就发消息，先缓存再补发
  const pending: HostToRendererMessage[] = [];
  let messageListener: ((message: HostToRendererMessage) => void) | null = null;
  let errorListener: ((message: string) => void) | null = null;

  worker.onmessage = (event: MessageEvent<HostToRendererMessage>) => {
    const message = event.data;
    if (messageListener) messageListener(message);
    else pending.push(message);
  };

  worker.onerror = (event) => {
    errorListener?.(event.message || 'engine worker error');
  };

  return {
    post: (message) => worker.postMessage(message),
    onMessage: (listener) => {
      messageListener = listener;
      for (const message of pending.splice(0)) listener(message);
    },
    onError: (listener) => {
      errorListener = listener;
    },
    close: async () => {
      worker.postMessage({ kind: 'shutdown' } satisfies RendererToHostMessage);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      worker.terminate();
    },
  };
}
