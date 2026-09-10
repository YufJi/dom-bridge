import type { VirtualDocument, VirtualEvent } from '@dom-bridge/engine';

/**
 * 被托管的示例应用。
 *
 * 它只依赖 `VirtualDocument` 接口（不依赖真实 DOM），因此同一份代码可以在
 * Web Worker、Node worker 这两个“无 DOM 引擎线程”里原样运行。
 */
export function mountCounterApp(document: VirtualDocument): void {
  console.log('[app] 业务代码已在 JS 引擎线程启动（无 DOM 环境）');

  const app = document.createElement('div');
  app.id = 'app';
  document.body.appendChild(app);

  const title = document.createElement('h1');
  title.textContent = 'dom-bridge 演示：JS 引擎线程 ↔ 渲染线程';
  app.appendChild(title);

  const hint = document.createElement('p');
  hint.textContent =
    '下面每次“点击”都走一遍完整回路：渲染线程发事件 → 引擎线程执行回调 → DOM 变更 op 回流渲染。';
  app.appendChild(hint);

  let count = 0;

  const counter = document.createElement('span');
  counter.style.fontWeight = 'bold';
  counter.textContent = `点击次数: ${count}`;
  app.appendChild(counter);

  const button = document.createElement('button');
  button.className = 'primary';
  button.textContent = '点我 +1';
  app.appendChild(button);

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.textContent = '我是第 2 次点击后才被 insertBefore 动态挂载的节点';

  const colors = ['green', 'red', 'blue', 'magenta'];

  button.addEventListener('click', (event: VirtualEvent) => {
    count += 1;
    counter.textContent = `点击次数: ${count}`;
    counter.style.color = colors[count % colors.length] ?? 'black';
    button.setAttribute('data-count', String(count));

    if (count === 2) {
      // 动态挂载：演示 insertBefore 与“运行中新增节点”
      app.insertBefore(tip, counter.nextSibling ?? button);
    } else if (count === 4) {
      // 动态卸载：演示 removeChild
      app.removeChild(tip);
    }

    console.log(`[app] click 回调执行完毕 (count=${count}, target=<${event.target.tag}>)`);
  });
}
