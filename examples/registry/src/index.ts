import type { VirtualDocument } from '@dom-bridge/engine';
import { mountCounterApp } from '@dom-bridge/example-counter';
import { mountReactApp } from '@dom-bridge/example-react';

/**
 * 被托管应用对外的统一接口。
 *
 * 这是“宿主 ↔ 应用”的约定，属于应用层：通用包（packages/*）只提供
 * `VirtualDocument` 这类与业务无关的原语，不定义应用清单、id 或生命周期语义。
 */
export interface HostedApp {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  mount(document: VirtualDocument): void;
}

export type HostedAppCatalog = readonly HostedApp[];

/** 示例清单：宿主只认识这个列表，新增示例时在这里加一行。 */
export const examples: HostedAppCatalog = [
  {
    id: 'counter',
    title: '计数器（直接调用 DOM 代理）',
    description: '最小回路：textContent / style / insertBefore / removeChild + click 事件回传',
    mount: mountCounterApp,
  },
  {
    id: 'react',
    title: 'React 18（react-reconciler 自定义 renderer）',
    description: 'React 树由自定义 host config 提交到虚拟 DOM 代理，全程没有真实 DOM 参与',
    mount: mountReactApp,
  },
];

export function getExample(id: string): HostedApp | undefined {
  return examples.find((example) => example.id === id);
}

/** 解析 ?example= 之类的入参，找不到时回退到第一个示例。 */
export function resolveExample(id: string | null | undefined): HostedApp {
  const fallback = examples[0];
  if (!fallback) throw new Error('示例清单为空');
  return (id ? getExample(id) : undefined) ?? fallback;
}

export function listExampleIds(): string[] {
  return examples.map((example) => example.id);
}

export interface StartHostedAppResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * 宿主侧启动逻辑：按 id 找到应用并挂载，把“未知 id / 启动失败”收敛成结果对象，
 * 由宿主决定如何上报（通常是回 ready / host-error）。
 */
export function startHostedApp(document: VirtualDocument, appId: string): StartHostedAppResult {
  const app = getExample(appId);
  if (!app) {
    return {
      ok: false,
      message: `未知应用: ${appId}（可用: ${listExampleIds().join(' / ')}）`,
    };
  }

  try {
    app.mount(document);
    return { ok: true, message: app.title };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `应用 ${app.id} 启动失败: ${detail}` };
  }
}
