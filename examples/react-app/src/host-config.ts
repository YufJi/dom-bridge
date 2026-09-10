/// <reference path="./react-reconciler.d.ts" />
import type { VirtualDocument, VirtualEvent, VirtualNode } from '@dom-bridge/engine';
import { DiscreteEventPriority } from 'react-reconciler/constants.js';
import type {
  HostContainer,
  HostContext,
  HostElement,
  Props,
  ReconcilerHostConfig,
} from './reconciler-types.ts';

/**
 * React 18 的 host config：把 React 的宿主操作翻译成虚拟 DOM 调用。
 *
 * 相比 shim 一个假 DOM 给 react-dom，这条路更"正"：
 * React 本身与平台无关，react-dom 只是它的一个 renderer 实现而已。
 */

/** React 事件处理器看到的适配对象（对应 SyntheticEvent 的最小子集）。 */
interface ReactLikeEvent {
  readonly type: string;
  readonly target: HostElement;
  readonly currentTarget: HostElement;
  readonly nativeEvent: VirtualEvent;
  readonly detail: VirtualEvent['detail'];
  readonly defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  isDefaultPrevented(): boolean;
}

const EMPTY_CONTEXT: HostContext = {};

/**
 * 每个 (节点, 事件类型) 只挂一个监听器，dispatch 时再读取“当前”的 props.handler。
 * 这与 react-dom 的做法一致：React 每次渲染都会产生新的闭包，如果按引用增删监听器，
 * 每次提交都会产生一轮 off/on op 抖动。
 */
interface HandlerSlot {
  current: ((event: ReactLikeEvent) => void) | null;
  readonly listener: (event: VirtualEvent) => void;
}

const eventSlots = new WeakMap<HostElement, Map<string, HandlerSlot>>();
const appliedStyles = new WeakMap<HostElement, Set<string>>();

export function createHostConfig(document: VirtualDocument): ReconcilerHostConfig {
  return {
    isPrimaryRenderer: true,
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    noTimeout: -1,

    getRootHostContext: () => EMPTY_CONTEXT,
    getChildHostContext: (parentContext: HostContext) => parentContext,
    getPublicInstance: (instance: HostElement) => instance,

    createInstance: (type: string, props: Props) => {
      const instance = document.createElement(type);
      for (const [name, value] of Object.entries(props)) applyProp(instance, name, value);
      return instance;
    },
    createTextInstance: (text: string) => document.createTextNode(text),

    appendInitialChild: (parent: HostElement, child: HostElement) => {
      parent.appendChild(child);
    },
    appendChild: (parent: HostElement, child: HostElement) => {
      parent.appendChild(child);
    },
    appendChildToContainer: (container: HostContainer, child: HostElement) => {
      container.appendChild(child);
    },
    insertBefore: (parent: HostElement, child: HostElement, before: HostElement) => {
      parent.insertBefore(child, before);
    },
    insertInContainerBefore: (
      container: HostContainer,
      child: HostElement,
      before: HostElement,
    ) => {
      container.insertBefore(child, before);
    },
    removeChild: (parent: HostElement, child: HostElement) => {
      parent.removeChild(child);
    },
    removeChildFromContainer: (container: HostContainer, child: HostElement) => {
      container.removeChild(child);
    },
    clearContainer: (container: HostContainer) => {
      let child = container.firstChild;
      while (child) {
        container.removeChild(child);
        child = container.firstChild;
      }
    },

    // React 只在 props 引用变化时调用 prepareUpdate，diff 交给 commitUpdate
    prepareUpdate: () => ({}),
    commitUpdate: (
      instance: HostElement,
      _payload: unknown,
      _type: string,
      oldProps: Props,
      newProps: Props,
    ) => {
      for (const name of new Set([...Object.keys(oldProps), ...Object.keys(newProps)])) {
        if (oldProps[name] === newProps[name]) continue;
        applyProp(instance, name, newProps[name]);
      }
    },
    commitTextUpdate: (instance: HostElement, _oldText: string, newText: string) => {
      instance.textContent = newText;
    },
    resetTextContent: (instance: HostElement) => {
      instance.textContent = '';
    },
    finalizeInitialChildren: () => false,
    shouldSetTextContent: () => false,

    prepareForCommit: () => null,
    resetAfterCommit: () => {},
    hideInstance: (instance: HostElement) => {
      instance.style.display = 'none';
    },
    unhideInstance: (instance: HostElement) => {
      delete instance.style.display;
    },
    detachDeletedInstance: () => {},

    scheduleTimeout: (handler: () => void, delay: number) => setTimeout(handler, delay),
    cancelTimeout: (handle: unknown) => {
      clearTimeout(handle as number);
    },
    scheduleMicrotask: (callback: () => void) => queueMicrotask(callback),
    // 我们的“用户事件”全部来自渲染线程，等价于 React DOM 的离散事件
    getCurrentEventPriority: () => DiscreteEventPriority,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function setAttributeValue(instance: HostElement, name: string, value: unknown): void {
  if (value === null || value === undefined || value === false) {
    instance.removeAttribute(name);
    return;
  }
  if (value === true) {
    instance.setAttribute(name, '');
    return;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    instance.setAttribute(name, String(value));
  }
}

function applyStyle(instance: HostElement, value: unknown): void {
  const next = isRecord(value) ? value : {};
  const nextKeys = new Set(Object.keys(next));

  for (const name of appliedStyles.get(instance) ?? []) {
    if (!nextKeys.has(name)) delete instance.style[name];
  }
  for (const name of nextKeys) {
    const styleValue = next[name];
    instance.style[name] =
      styleValue === null || styleValue === undefined ? '' : String(styleValue);
  }
  appliedStyles.set(instance, nextKeys);
}

function eventTypeFor(prop: string): string {
  const raw = prop.slice(2).toLowerCase();
  return raw === 'doubleclick' ? 'dblclick' : raw;
}

function applyEvent(instance: HostElement, prop: string, handler: unknown): void {
  const type = eventTypeFor(prop);
  let slots = eventSlots.get(instance);
  if (!slots) {
    slots = new Map();
    eventSlots.set(instance, slots);
  }

  const next = typeof handler === 'function' ? (handler as (event: ReactLikeEvent) => void) : null;
  const existing = slots.get(type);

  if (existing) {
    existing.current = next;
    return;
  }
  if (!next) return;

  const slot: HandlerSlot = {
    current: next,
    listener: (event: VirtualEvent) => slot.current?.(toReactEvent(event)),
  };
  instance.addEventListener(type, slot.listener);
  slots.set(type, slot);
}

function toReactEvent(event: VirtualEvent): ReactLikeEvent {
  return {
    type: event.type,
    target: event.target,
    currentTarget: event.currentTarget,
    nativeEvent: event,
    detail: event.detail,
    defaultPrevented: event.defaultPrevented,
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
    isDefaultPrevented: () => event.defaultPrevented,
  };
}

function applyProp(instance: HostElement, name: string, value: unknown): void {
  switch (name) {
    case 'children':
    case 'key':
    case 'ref':
      return;
    case 'style':
      applyStyle(instance, value);
      return;
    case 'className':
      setAttributeValue(instance, 'class', value);
      return;
    case 'htmlFor':
      setAttributeValue(instance, 'for', value);
      return;
    case 'dangerouslySetInnerHTML':
      console.warn('[react-app] 示例暂不支持 dangerouslySetInnerHTML（协议还没有 innerHTML op）');
      return;
    default:
      if (name.startsWith('on')) {
        applyEvent(instance, name, value);
        return;
      }
      setAttributeValue(instance, name, value);
  }
}

export type { VirtualNode };
