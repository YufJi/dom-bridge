import './styles.css';
import { createBridge, type Bridge } from '@dom-bridge/bridge';
import { createWebWorkerChannel } from '@dom-bridge/bridge/web';
import { examples, getExample, resolveExample } from '@dom-bridge/examples';
import { DomRenderer } from '@dom-bridge/renderer/dom';
import { DebugPanel, truncate } from './panel.ts';

declare global {
  interface Window {
    domBridge: { renderer: DomRenderer; bridge: Bridge };
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const screen = document.querySelector<HTMLElement>('#screen');
if (!screen) throw new Error('缺少 #screen 容器');

const requestedId = new URLSearchParams(window.location.search).get('example');
if (requestedId && !getExample(requestedId)) {
  console.warn(`[debug-console] 未找到示例 "${requestedId}"，回退到默认示例`);
}
const app = resolveExample(requestedId);

// worker 必须在这里内联创建：打包器要能静态识别 new Worker(new URL(...)) 才会产出 chunk
const worker = new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' });
const channel = createWebWorkerChannel(worker);
const bridge = createBridge(channel);
const renderer = new DomRenderer(screen, bridge.transport);
bridge.attachRenderer(renderer);

const panel = new DebugPanel({
  onSimulateClick: () => {
    if (renderer.simulateClick()) panel.logInfo('▶ 派发真实 DOM click 事件');
    else panel.setStatus('当前没有节点监听 click', true);
  },
  onAutoClicks: (count) => {
    void runAutoClicks(count);
  },
  onClearLog: () => panel.clearLog(),
  onHighlightChange: (enabled) => {
    renderer.highlight = enabled;
  },
  onEval: (code) => {
    if (!code.trim()) return;
    panel.logInfo(`» 在引擎线程执行: ${truncate(code.replace(/\s+/g, ' '), 120)}`);
    bridge.runEval(code);
  },
});

bridge.subscribe((event) => {
  switch (event.type) {
    case 'ready':
      panel.setStatus(`「${app.title}」已就绪（Web Worker · 无 DOM）`);
      break;
    case 'batch':
      panel.logBatch(event.ops);
      panel.renderStats(event.stats);
      break;
    case 'eval-result':
      panel.logEvalResult(event);
      break;
    case 'error':
      panel.setStatus(`引擎线程出错: ${event.message}`, true);
      break;
  }
});

panel.bindExampleSelector(examples, app.id, (id) => {
  window.location.search = `?example=${encodeURIComponent(id)}`;
});

async function runAutoClicks(count: number): Promise<void> {
  panel.setAutoButtonDisabled(true);
  for (let index = 0; index < count; index += 1) {
    renderer.simulateClick();
    await sleep(500);
  }
  panel.setAutoButtonDisabled(false);
}

panel.renderStats(bridge.stats);
panel.setStatus(`正在启动「${app.title}」…`);

// 应用层协议：告诉引擎线程挂载哪个被托管应用
channel.post({ kind: 'start', appId: app.id });

// 方便在 DevTools Console 里直接玩：domBridge.renderer / domBridge.bridge
window.domBridge = { renderer, bridge };
