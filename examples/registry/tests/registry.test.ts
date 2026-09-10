import { createDomHost } from '@dom-bridge/engine';
import { describe, expect, it } from 'vitest';
import {
  examples,
  getExample,
  listExampleIds,
  resolveExample,
  startHostedApp,
} from '../src/index.ts';

describe('示例清单', () => {
  it('每个示例都有唯一 id、标题与 mount 实现', () => {
    expect(examples.length).toBeGreaterThan(0);
    for (const app of examples) {
      expect(app.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(app.title.length).toBeGreaterThan(0);
      expect(typeof app.mount).toBe('function');
    }
    expect(new Set(listExampleIds()).size).toBe(examples.length);
    expect(getExample('react')?.id).toBe('react');
  });

  it('resolveExample 找不到入参时回退到第一个示例', () => {
    const fallback = examples[0]?.id;
    expect(resolveExample('react').id).toBe('react');
    expect(resolveExample('not-exists').id).toBe(fallback);
    expect(resolveExample(null).id).toBe(fallback);
  });
});

describe('startHostedApp', () => {
  it('按 id 挂载示例应用，并把 DOM 变更交给引擎通道', () => {
    const batches: unknown[] = [];
    const { host, document } = createDomHost((message) => {
      if ('batch' in message) batches.push(message.batch);
    });

    const result = startHostedApp(document, 'counter');
    host.flush();

    expect(result.ok).toBe(true);
    expect(document.getElementById('app')).not.toBeNull();
    expect(batches.length).toBeGreaterThan(0);
  });

  it('未知 id 或启动异常时返回可上报的结果', () => {
    const { document } = createDomHost(() => {});

    const result = startHostedApp(document, 'not-exists');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('not-exists');
    expect(result.message).toContain('可用');
  });
});
