import { createBridge } from '@dom-bridge/bridge';
import { createNodeWorkerChannel } from '@dom-bridge/bridge/node';
import { resolveExample } from '@dom-bridge/examples';
import { TerminalRenderer } from '@dom-bridge/renderer/terminal';

/**
 * Node 终端演示：主线程扮演渲染线程（终端文本快照），
 * worker 线程扮演无 DOM 的 JS 引擎。直接用 Node 22 的类型擦除运行：`pnpm demo`。
 */

/** 演示脚本：轮流点击界面上所有可点击节点（对任意示例都适用）。 */
const CLICK_ROUNDS = 8;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const channel = createNodeWorkerChannel(new URL('./engine-worker.ts', import.meta.url));
const bridge = createBridge(channel);
const renderer = new TerminalRenderer();
// 统一接口：命令行第一个参数选示例（`pnpm demo -- react` 会带上 "--" 分隔符）
const requestedId = process.argv.slice(2).find((arg) => arg !== '--');
const app = resolveExample(requestedId);

bridge.attachRenderer(renderer);
renderer.onUserEvent = bridge.transport;

let frame = 0;

bridge.subscribe((event) => {
  if (event.type !== 'batch') return;
  frame += 1;
  const { ops, batches, events } = event.stats;
  console.log(
    `\n──── frame #${String(frame).padStart(2, '0')} · ` +
      `渲染线程累计 ops=${ops} · batches=${batches} · 用户事件=${events} ────`,
  );
  console.log(renderer.format().join('\n'));
});

async function main(): Promise<void> {
  console.log('=== dom-bridge Node 演示（终端渲染）===');
  console.log(`[main] 主线程(渲染) 已就绪，准备挂载「${app.title}」…`);

  channel.post({ kind: 'start', appId: app.id });

  await sleep(500);

  for (let round = 0; round < CLICK_ROUNDS; round += 1) {
    await sleep(600);
    const targets = renderer.clickTargets();
    const target = targets[round % Math.max(targets.length, 1)];
    renderer.simulateUserClick(target);
  }

  await sleep(400);
  console.log('\n=== 演示结束：通知 JS 引擎线程关闭 ===');
  await bridge.shutdown();

  const { ops, batches, events } = bridge.stats;
  console.log(
    `\n汇总：引擎→渲染共 ${ops} 条 op（${batches} 个批次，` +
      `平均每批 ${(ops / batches).toFixed(1)} 条），渲染→引擎共 ${events} 个用户事件。`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
