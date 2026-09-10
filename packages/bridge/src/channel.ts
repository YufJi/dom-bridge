import type { HostToRendererMessage, RendererToHostMessage } from '@dom-bridge/protocol';

/**
 * 渲染线程 ↔ 引擎线程之间的传输通道，与具体平台（Web Worker / Node worker）解耦。
 * 平台实现放在 `@dom-bridge/bridge/web` 与 `@dom-bridge/bridge/node`。
 */
export interface EngineChannel {
  post(message: RendererToHostMessage): void;
  onMessage(listener: (message: HostToRendererMessage) => void): void;
  onError(listener: (message: string) => void): void;
  /** 请求引擎线程退出；resolve 表示通道已完全停止（Node 会等线程真正结束）。 */
  close(): Promise<void>;
}
