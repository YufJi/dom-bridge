# dom-bridge

把一个普通 Web 应用放进**没有 DOM 的 JS 引擎线程**运行：引擎线程里的 `document`
全是代理，任何 DOM 变更被翻译成一条条 **op**，经桥接层转发到**渲染线程**
（类 webview / 原生 UI 线程）真正执行渲染；用户输入则作为事件**反向**回传引擎线程。

> 同类思想的成熟实现：AMP WorkerDOM、Shopify Remote DOM、React Native / Weex 的 JS↔Native bridge。

## 模块划分

三个 workspace 根，边界是「通用能力 / 宿主 / 被托管应用」：

### `packages/*` — 与业务无关的通用能力

| 包                     | 目录                | 职责                                                                                           | 依赖     |
| ---------------------- | ------------------- | ---------------------------------------------------------------------------------------------- | -------- |
| `@dom-bridge/protocol` | `packages/protocol` | 桥接协议：`Op` / 消息类型 / `describeOp`，零依赖                                               | —        |
| `@dom-bridge/engine`   | `packages/engine`   | 引擎层：`createDomHost`（虚拟 DOM 代理）、`createEngineHost`（协议接线，其余消息交应用层回调） | protocol |
| `@dom-bridge/renderer` | `packages/renderer` | 渲染器：契约（`.`）、真实 DOM 实现（`./dom`）、终端文本实现（`./terminal`）                    | protocol |
| `@dom-bridge/bridge`   | `packages/bridge`   | 桥接层：`createBridge`（消息路由 / 往返统计）、`./web` 与 `./node` 通道实现                    | protocol |

### `apps/*` — 宿主（建线程、装能力、决定挂载什么）

| 包                          | 目录                 | 职责                                                        | 依赖                                             |
| --------------------------- | -------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| `@dom-bridge/debug-console` | `apps/debug-console` | Vite 调试台：真实 DOM + DevTools + op 日志面板 + 示例切换器 | bridge / engine / examples / protocol / renderer |
| `@dom-bridge/node-demo`     | `apps/node-demo`     | Node 终端演示：worker_threads + 文本快照                    | bridge / engine / examples / renderer            |

### `examples/*` — 被托管应用（只认识 `VirtualDocument`）

| 包                            | 目录                   | 职责                                                       | 依赖                                     |
| ----------------------------- | ---------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `@dom-bridge/examples`        | `examples/registry`    | 应用层入口：`HostedApp` 契约 + 示例清单 + `startHostedApp` | engine / example-counter / example-react |
| `@dom-bridge/example-counter` | `examples/counter-app` | 直接调用虚拟 DOM 代理的计数器                              | engine                                   |
| `@dom-bridge/example-react`   | `examples/react-app`   | React 18 + `react-reconciler` 自定义 renderer              | engine / react / react-reconciler        |

依赖方向只有一种：`apps/*` 与 `examples/*` → `packages/*`，`packages/*` 内部单向收敛到 `protocol`；
示例之间互不依赖，`examples/registry` 是唯一的聚合点。

各包职责的关键取舍：

- **protocol 零依赖**：它是引擎、渲染器、桥接层、调试面板共同的语言，必须能被任何运行时加载。
- **engine / renderer 互不依赖**：两侧只认协议，所以可以把它们分别跑在不同进程、不同机器甚至不同语言实现上。
- **bridge 抽掉平台差异**：`EngineChannel` 把 Web Worker 与 `worker_threads` 的差异收在一处，
  `createBridge` 只做消息路由与统计，因此 Web 调试台和 Node 演示共用同一套接线逻辑。
- **renderer 用子路径导出**：`./dom` 需要 DOM，`./terminal` 只输出文本，消费方各取所需，避免把浏览器专属代码拖进 Node。
- **examples 独立于 packages**：counter 应用是“被托管的示例”，不是可复用能力，
  因此不放 `packages/`；它只依赖 `VirtualDocument` 接口，证明“被托管的 Web 应用”不感知真实 DOM。
- **生命周期属于应用层**：`HostedApp` 契约、示例清单、按 id 查找与 start/ready 握手都在
  `examples/registry` 与各 app 的引擎线程入口里；`packages/engine` 只处理与 DOM 代理直接相关的
  `event` / `eval` / `shutdown`，其余消息原样交给应用层回调。

## 示例的统一接口

示例对外不暴露零散的函数名，而是实现同一个契约（定义在应用层 `examples/registry/src/index.ts`）：

```ts
export interface HostedApp {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  mount(document: VirtualDocument): void;
}
```

- **示例侧**：只实现 `mount(document)`，就同时能被 Web 调试台和 Node 演示托管；
  它不需要知道桥接层、渲染器、worker 的存在，也不需要知道自己在浏览器还是 Node 里跑。
- **宿主侧**：`@dom-bridge/examples` 是唯一入口，导出 `examples` 清单与
  `startHostedApp(document, id)`；引擎线程只提供虚拟 DOM 与通道，握手由应用层完成：

```ts
// 引擎线程入口（应用层）：引擎不认识 start，由这里决定挂载什么
bootWebEngineWorker({
  onAppMessage: (message, { document, post }) => {
    if (message.kind !== 'start') return;
    const result = startHostedApp(document, message.appId);
    post(result.ok ? { kind: 'ready' } : { kind: 'host-error', message: result.message });
  },
});

// 渲染线程：发一条 start；引擎侧 mount 完成后回 ready
channel.post({ kind: 'start', appId: 'react' });
```

- **外部提供统一接口**：外部团队要接入自己的应用，只需依赖 `@dom-bridge/engine`
  （为了拿 `VirtualDocument` 类型）并实现 `HostedApp`；把清单换成自己的清单即可，
  协议、引擎、渲染器、桥接层都不用改。
- **新增示例**：在 `examples/<name>/` 建包 → 导出 `HostedApp` → 在
  `examples/registry/src/index.ts` 的清单里加一行；两个 app 无需改动。

### React 18 示例的实现方式

`examples/react-app` 没有去 shim 一个假 DOM 骗过 `react-dom`，而是用
`react-reconciler` 写了一个自定义 renderer（React 本身与平台无关，`react-dom`
只是它的一个 renderer 实现）。host config 里每个钩子都直接落到虚拟 DOM：

| React 宿主操作                                 | 落到虚拟 DOM                                   |
| ---------------------------------------------- | ---------------------------------------------- |
| `createInstance` / `createTextInstance`        | `document.createElement` / `createTextNode`    |
| `appendChild` / `insertBefore` / `removeChild` | 同名的代理方法（并产生对应 op）                |
| `commitUpdate`（props diff）                   | 属性、`className`、`style`、`onXxx` 的增量应用 |
| `onClick` 等事件 props                         | `addEventListener('click', …)` + 事件适配对象  |
| `getCurrentEventPriority`                      | 固定返回离散事件优先级（事件来自渲染线程）     |

一个实测出来的坑：React 每次渲染都会生成新的 handler 闭包，如果按引用增删监听器，
每次提交都会产生一轮 `off` / `on` op 抖动。这里采用 react-dom 的做法 ——
每个（节点, 事件类型）只挂一个监听器，dispatch 时再读“当前”handler；
改成这样之后 React 重渲染的 op 数从 9 降到 3。

当前限制（也是这份示例划出的边界）：

- `dangerouslySetInnerHTML` 未实现——协议里还没有 `innerHTML` op；
- 受控 `input` 未实现——`setAttribute('value')` 是 attribute 语义，
  真实 DOM 需要写 property，需要给协议补一条 setProperty 类 op；
- 不区分 SVG 命名空间（`getChildHostContext` 直接透传），也没有实现 React 的
  合成事件系统与事件委托，只是把虚拟事件适配成 handler 能用的对象。

## 消息协议

引擎侧变更先入队，在任务边界上一次性发送 `{ batch: Op[] }`，减少跨线程消息数。

| op                                       | 含义                                        |
| ---------------------------------------- | ------------------------------------------- |
| `createElement {id, tag}`                | 新建元素                                    |
| `createText {id, text}`                  | 新建文本节点                                |
| `insertChild {parentId, childId, index}` | 按 index 插入（移动节点同样用它）           |
| `removeChild {parentId, childId}`        | 摘除子节点                                  |
| `setAttribute {id, name, value}`         | 设 / 删属性（`value === null` 表示删除）    |
| `setStyle {id, name, value}`             | 设 / 删内联样式（`node.style.x = …` 触发）  |
| `updateText {id, text}`                  | 更新文本节点内容                            |
| `on` / `off {id, type}`                  | 注册 / 注销监听（渲染线程据此知道要监听谁） |

| 反方向消息                         | 方向        | 用途                                     |
| ---------------------------------- | ----------- | ---------------------------------------- |
| `{kind:'event', id, type, detail}` | 渲染 → 引擎 | 用户输入，代理层派发成合成事件（含冒泡） |
| `{kind:'eval', code}`              | 渲染 → 引擎 | 调试：在引擎线程里执行代码               |
| `{kind:'eval-result', ok, value}`  | 引擎 → 渲染 | 上面的执行结果                           |
| `{kind:'ready'}`                   | 引擎 → 渲染 | 业务代码加载完毕                         |
| `{kind:'shutdown'}`                | 渲染 → 引擎 | 关闭引擎线程                             |
| `{kind:'start', appId}`            | 渲染 → 引擎 | 指定挂载哪个被托管应用（统一接口入口）   |
| `{kind:'host-error', message}`     | 引擎 → 渲染 | 引擎线程内的启动 / 运行错误              |

前四条由引擎与桥接层直接消费；`start` / `ready` / `host-error` 是**应用生命周期消息**——
协议只定义报文形状，语义（挂载哪个应用、何时算就绪）由应用层实现。

事件消息的约定：一次用户交互只上报一条 `event`，`id` 是真实事件目标对应的虚拟节点；
捕获 / 冒泡顺序与 `stopPropagation()` 等语义由引擎侧统一负责（见 `packages/engine/README.md`）。

## 快速开始

要求 Node >= 22.18（用到原生类型擦除）与 pnpm 9。

```bash
pnpm install

pnpm dev             # 浏览器调试台：http://localhost:5173/
pnpm demo            # Node 终端演示（默认第一个示例：counter）
pnpm demo -- react   # 指定示例（React 18）
```

## 浏览器调试台

- 左栏由 `DomRenderer` 把 op 落到**真实 DOM**，每个节点带 `data-vb-id`，
  可在 DevTools 的 Elements / Event Listeners 面板直接检查；变更节点会高亮。
- 右栏显示「应用 op 数 / 批次数 / 用户事件数 / 事件→回流近似耗时」与逐条 op 日志。
- 「在引擎线程执行」把任意代码送进**无 DOM 的 Worker**，可以看到它产生的 op 立刻渲染到左栏。
- 顶部「示例」下拉可在 counter / React 18 之间切换（本质是重载 `?example=react`，URL 可分享、可调试）。
- Worker 由宿主内联创建（`new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' })`），
  这样打包器才能静态识别并产出独立的 worker chunk —— 生产构建必须如此，否则部署出去会白屏。
- 断点调试：DevTools → Sources → Threads/Workers → `engine-worker.ts`，
  可在 `packages/engine/src/dom/`、`examples/counter-app/src/counter-app.ts` 单步跟踪。
- Console 里可用 `domBridge.renderer` / `domBridge.bridge` 查看两侧状态。

调试台界面见 `docs/web-debug-console.png`（counter）与 `docs/web-debug-console-react.png`（React 18）。

## 工程化

```bash
pnpm test               # Vitest：9 个文件 63 个用例（协议 / 代理层 / 事件 / 桥接 / 两个渲染实现 / 示例注册表）
pnpm typecheck          # pnpm -r，逐个包跑 tsc --noEmit
pnpm lint               # ESLint flat config + typescript-eslint
pnpm format             # Prettier
pnpm build              # 递归构建（当前只有 debug-console 需要产物）
pnpm --filter @dom-bridge/engine typecheck   # 也可以只跑单个包
```

两个刻意的工程决策：

1. **包不预编译（internal packages / JIT）**：各包 `exports` 直接指向 `src/*.ts`，
   Vite、Vitest、Node 22 类型擦除都能直接消费，所以 `pnpm dev` / `pnpm demo` 都没有前置构建步骤。
   若将来要发布这些包，只需给每个包加一条 `tsc`（或 tsup）构建并把 `exports` 改成 `dist/*.js` + `types`。
2. **严格的 workspace 依赖**：pnpm 的非扁平 `node_modules` 会立刻暴露“用了但没声明”的依赖
   （本次改造中调试台就因此暴露了缺失的 `@dom-bridge/protocol` 声明）。

## CI 与部署

- `.github/workflows/ci.yml`：push / PR 时依次跑 `format:check`、`lint`、`typecheck`、`test`、`build`，
  并额外跑一次无浏览器的端到端 smoke（`pnpm demo`，走完整条「引擎 ↔ 渲染器」回路）。
- `.github/workflows/deploy-pages.yml`：把调试台构建成静态站点并发布到 GitHub Pages。
  子路径由 `actions/configure-pages` 的 `base_path` 注入 `PAGES_BASE`，
  因此用户站点（`https://<user>.github.io/`）与项目站点（`https://<user>.github.io/<repo>/`）都能直接用。
- 首次启用：仓库 Settings → Pages → Source 选 **GitHub Actions**，之后 push 到默认分支即自动部署。
- 本地复现 Pages 构建：

```bash
PAGES_BASE=/dom-bridge/ pnpm --filter @dom-bridge/debug-console build
```

## 接下来可以探索的方向

已补齐的能力（结构操作、`classList` / `dataset`、节点标识、事件捕获 / `once` / `passive` 等）
以 `packages/engine/README.md` 的「已实现的 DOM 子集」为准，那里同时维护完整缺口清单与 `TODO(dom-subset)` 对照。

1. `innerHTML` / `outerHTML`：整体委托渲染线程解析，或引擎侧内置 HTML parser；
2. 表单 property 语义：协议补一条 property 类 op，让受控 `input`（`value` / `checked`）成立；
3. 同步测量（`getBoundingClientRect` 等）的同步桥或异步测量 API；
4. 焦点与输入：`focus` / `blur`、`selectionStart`、IME 合成、滚动位置同步；
5. op 合并去重 + 按帧调度 + 渲染端增量 diff，以及节点句柄回收；
6. 把 `protocol` 抽成版本化的独立制品（含协议兼容性测试），并接入真实 JS 引擎（QuickJS / Hermes）与真实 WebView 渲染端。

引擎 ↔ 渲染器的联调测试在 `apps/debug-console/tests/event-loop.test.ts`，跑 `pnpm test` 即可覆盖。
