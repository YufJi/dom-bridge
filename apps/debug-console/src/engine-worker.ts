import { bootWebEngineWorker } from '@dom-bridge/engine/web-worker';
import { startHostedApp } from '@dom-bridge/examples';

/**
 * 无 DOM 的引擎线程入口。
 *
 * 引擎只提供虚拟 DOM 与通道；「挂载哪个应用、何时算就绪」是应用层的事，
 * 因此这里自己处理 start 消息。
 */
let started = false;

bootWebEngineWorker({
  onAppMessage: (message, context) => {
    if (message.kind !== 'start' || started) return;
    started = true;

    const result = startHostedApp(context.document, message.appId);
    context.post(result.ok ? { kind: 'ready' } : { kind: 'host-error', message: result.message });
  },
});
