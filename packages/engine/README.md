# @dom-bridge/engine

在**没有 DOM** 的 JS 引擎线程里托管 Web 应用：提供虚拟 DOM 代理，以及把代理接到桥接通道上的协议接线。

## 分层

| 层  | 文件                                          | 职责                                                                   |
| --- | --------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | `src/dom/types.ts`                            | 契约：`VirtualNode` / `VirtualDocument` / `VirtualEvent` / `NodeOwner` |
| 2   | `src/dom/op-queue.ts`                         | 写路径：变更攒批、flush 调度（`setImmediate` → `setTimeout` 回退）     |
| 3   | `src/dom/node.ts`                             | 树模型：`DomNode` 的结构、属性、样式、`classList`、`dataset`、监听注册 |
| 3   | `src/dom/class-list.ts`、`src/dom/dataset.ts` | 属性派生视图，读写都落到属性上                                         |
| 4   | `src/dom/events.ts`                           | 事件：合成事件与捕获 → 目标 → 冒泡派发                                 |
| 5   | `src/dom/host.ts`                             | 文档/宿主：句柄分配、注册表、id 索引、组装 `document`                  |
| 6   | `src/engine-host.ts`                          | 协议接线：只处理 `event` / `eval` / `shutdown`，其余交应用层           |
| 7   | `src/web-worker.ts`、`src/node-worker.ts`     | 平台入口（Web Worker / worker_threads）                                |

依赖方向单向：`protocol ← op-queue ← host`、`types ← node ← host`、`types ← events ← host`。

## 已实现的 DOM 子集

| 分类   | 能力                                                                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 结构   | `createElement` / `createTextNode` / `createDocumentFragment` / `appendChild` / `insertBefore` / `replaceChild` / `removeChild` / `remove` / `contains`                      |
| 遍历   | `children` / `firstChild` / `nextSibling` / `parentNode`                                                                                                                     |
| 标识   | `nodeType` / `nodeName` / `ownerDocument` / `isConnected` / `handle`                                                                                                         |
| 属性   | `setAttribute` / `getAttribute` / `removeAttribute` / `id` / `className` / `classList` / `dataset`                                                                           |
| 样式   | `style` 属性读写与 `delete`（置空或删除发 `setStyle(null)`）                                                                                                                 |
| 文本   | `textContent` 读写（元素写入会替换为单个文本节点）                                                                                                                           |
| 查询   | `getElementById`（跟随 `id` 属性增删）                                                                                                                                       |
| 事件   | `addEventListener` / `removeEventListener`（`capture` / `once` / `passive`）、捕获 → 目标 → 冒泡、`stopPropagation` / `stopImmediatePropagation`、`eventPhase`、非冒泡类型表 |
| 写路径 | op 队列、批量 flush、`pendingOpCount`、手动 `flush()`                                                                                                                        |

## 跨包契约

- **一次交互只上报一次**：渲染线程每次用户交互只发一条 `{kind:'event', id, type, detail}`，
  其中 `id` 是真实 DOM 事件目标对应的虚拟节点（**不一定是挂监听器的那个节点**）。
  捕获/冒泡顺序、`stopPropagation()`、`once` 全部由本包负责；
  渲染线程不应为同一次原生事件重复上报（见 `packages/renderer/src/dom-renderer.ts`）。
- **文档片段只在引擎侧存在**：`#fragment` 不进注册表、不发 op；片段内的增删不产生 op，
  插入父节点时才按顺序展开成若干 `insertChild`。
- **属性是一份真相**：`className` / `classList` / `dataset` 都读写属性表，因此互相可见。

## 缺口与 TODO

代码里的 `TODO(dom-subset)` 注释与本节一一对应。缺口是已知且可接受的，补齐时请同步更新本表。

### 结构 API

- 缺 `cloneNode` / `normalize` / `splitText` / 注释节点（`createComment`）。
- `children` 是普通数组，没有 `NodeList` / `HTMLCollection` 语义（`item()`、live 集合）。
- 缺 `innerHTML` / `outerHTML` / `insertAdjacentHTML`：需要 HTML 解析，建议整体委托渲染线程。
- 缺 `querySelector(All)` / `getElementsByClassName` / `getElementsByTagName` / `matches` / `closest`。

### 属性与样式

- 样式只有属性代理，缺 `setProperty` / `getPropertyValue` / `removeProperty`、`cssText`、CSS 变量与 shorthand。
- 属性枚举只有内部的 `attributeNames()`，缺公开的 `hasAttribute` / `toggleAttribute` / `attributes` 集合。
- 表单状态：`value` / `checked` 的真实语义是 **property**，目前 `setAttribute` 只写 attribute；
  受控 `input` 会踩到，需要协议补一条 property 类 op。

### 事件语义

- `preventDefault()` 只置标记，没有默认行为的消费者（`<a>` 跳转、表单提交等）。
- 缺应用侧 `dispatchEvent()`：目前事件只能由渲染线程触发。
- 每个节点独立注册监听，渲染线程侧监听器数量与远端节点一一对应，没有事件委托优化。
- 「不冒泡的事件类型」是一张硬编码表（`focus` / `blur` / `mouseenter` / …），
  不是从渲染线程回传的真实语义。

### 测量与布局（需要协议/架构扩展）

- `getBoundingClientRect` / `offsetWidth` / `clientWidth` / `scrollTop` / `scrollIntoView` 全部缺失：布局只在渲染线程，需要同步桥或异步测量 API。
- `getComputedStyle` 缺失：需要渲染线程回传计算样式。

### 焦点与输入

- 缺 `focus()` / `blur()` / `activeElement`、`selectionStart/End`、IME 合成事件、滚动位置同步。

### 观察者

- 缺 `MutationObserver` / `ResizeObserver` / `IntersectionObserver`。

### 生命周期与调度

- 句柄不回收：`removeChild` 之后节点仍留在 host 注册表里，长生命周期页面会泄漏；也没有 id 复用。
- 与渲染线程没有 ack / 对账机制，两侧树漂移无法发现。
- op 不做合并（连续写同一个样式属性会重复入队）、没有按帧调度、没有背压。
- `documentElement` 目前直接等于 `body`，也没有 `head` / `title`。

### 明确非目标

- Shadow DOM、自定义元素、`<template>` 内容。
- SVG 命名空间（`createElementNS`）。
- 完整 CSSOM（伪元素、动画、媒体查询）。
- 同步布局读取（除非将来引入同步桥）。
