import type { ReactNode } from 'react';
import type { VirtualNode } from '@dom-bridge/engine';

/**
 * 我们实现的 host config 形状，按 react-reconciler@0.29 实际调用点整理：
 * 只覆盖 mutation 模式（不支持 persistence / hydration）。
 */

export type HostElement = VirtualNode;
export type HostContainer = VirtualNode;
export type HostContext = Record<string, never>;
export type Props = Record<string, unknown>;
export type RootHandle = unknown;

export interface ReconcilerHostConfig {
  readonly isPrimaryRenderer: boolean;
  readonly supportsMutation: boolean;
  readonly supportsPersistence: boolean;
  readonly supportsHydration: boolean;
  readonly noTimeout: number;

  getRootHostContext(container: HostContainer): HostContext;
  getChildHostContext(parent: HostContext, type: string, container: HostContainer): HostContext;
  getPublicInstance(instance: HostElement): HostElement;

  createInstance(
    type: string,
    props: Props,
    container: HostContainer,
    context: HostContext,
    fiber: unknown,
  ): HostElement;
  createTextInstance(
    text: string,
    container: HostContainer,
    context: HostContext,
    fiber: unknown,
  ): HostElement;

  appendInitialChild(parent: HostElement, child: HostElement): void;
  appendChild(parent: HostElement, child: HostElement): void;
  appendChildToContainer(container: HostContainer, child: HostElement): void;
  insertBefore(parent: HostElement, child: HostElement, before: HostElement): void;
  insertInContainerBefore(container: HostContainer, child: HostElement, before: HostElement): void;
  removeChild(parent: HostElement, child: HostElement): void;
  removeChildFromContainer(container: HostContainer, child: HostElement): void;
  clearContainer(container: HostContainer): void;

  prepareUpdate(
    instance: HostElement,
    type: string,
    oldProps: Props,
    newProps: Props,
    container: HostContainer,
    context: HostContext,
  ): unknown;
  commitUpdate(
    instance: HostElement,
    payload: unknown,
    type: string,
    oldProps: Props,
    newProps: Props,
    fiber: unknown,
  ): void;
  commitTextUpdate(instance: HostElement, oldText: string, newText: string): void;
  resetTextContent(instance: HostElement): void;
  finalizeInitialChildren(
    instance: HostElement,
    type: string,
    props: Props,
    container: HostContainer,
    context: HostContext,
  ): boolean;
  shouldSetTextContent(type: string, props: Props): boolean;

  prepareForCommit(container: HostContainer): unknown;
  resetAfterCommit(container: HostContainer): void;
  hideInstance(instance: HostElement): void;
  unhideInstance(instance: HostElement, props: Props): void;
  detachDeletedInstance(instance: HostElement): void;

  scheduleTimeout(handler: () => void, delay: number): unknown;
  cancelTimeout(handle: unknown): void;
  scheduleMicrotask(callback: () => void): void;
  getCurrentEventPriority(): number;
}

export interface ReconcilerInstance {
  createContainer(
    container: HostContainer,
    tag: number,
    hydrationCallbacks: unknown,
    isStrictMode: boolean,
  ): RootHandle;
  updateContainer(
    element: ReactNode,
    root: RootHandle,
    parentComponent: unknown,
    callback?: () => void,
  ): void;
  flushSync(callback: () => void): void;
  getCurrentUpdatePriority(): number;
}

export type ReconcilerFactory = (config: ReconcilerHostConfig) => ReconcilerInstance;
