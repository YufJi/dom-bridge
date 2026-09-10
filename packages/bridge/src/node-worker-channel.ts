import { Worker } from 'node:worker_threads';
import type { HostToRendererMessage, RendererToHostMessage } from '@dom-bridge/protocol';
import type { EngineChannel } from './channel.ts';

/** Node 侧通道：worker_threads。 */
export function createNodeWorkerChannel(scriptUrl: URL): EngineChannel {
  const worker = new Worker(scriptUrl);
  const exited = new Promise<void>((resolve) => {
    worker.once('exit', () => resolve());
  });

  const pending: HostToRendererMessage[] = [];
  let messageListener: ((message: HostToRendererMessage) => void) | null = null;
  let errorListener: ((message: string) => void) | null = null;

  worker.on('message', (message: HostToRendererMessage) => {
    if (messageListener) messageListener(message);
    else pending.push(message);
  });

  worker.on('error', (error: Error) => {
    errorListener?.(error.message);
  });

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
      await exited;
    },
  };
}
