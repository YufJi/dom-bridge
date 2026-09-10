import { bootNodeEngineWorker } from '@dom-bridge/engine/node-worker';
import { startHostedApp } from '@dom-bridge/examples';

/** 与浏览器版同构：应用层处理 start，引擎只提供虚拟 DOM 与通道。 */
let started = false;

bootNodeEngineWorker({
  onAppMessage: (message, context) => {
    if (message.kind !== 'start' || started) return;
    started = true;

    const result = startHostedApp(context.document, message.appId);
    context.post(result.ok ? { kind: 'ready' } : { kind: 'host-error', message: result.message });
  },
});
