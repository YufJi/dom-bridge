import type { BridgeStats } from '@dom-bridge/bridge';
import type { HostedApp } from '@dom-bridge/examples';
import { describeOp, type Op } from '@dom-bridge/protocol';

export interface PanelHandlers {
  onSimulateClick(): void;
  onAutoClicks(count: number): void;
  onClearLog(): void;
  onHighlightChange(enabled: boolean): void;
  onEval(code: string): void;
}

export interface EvalOutcome {
  readonly ok: boolean;
  readonly value: string;
}

const MAX_LOG_ROWS = 300;

/** 调试面板：只负责把状态渲染成 DOM，不关心 op 从哪来。 */
export class DebugPanel {
  private readonly statusEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly statOps: HTMLElement;
  private readonly statBatches: HTMLElement;
  private readonly statEvents: HTMLElement;
  private readonly statRtt: HTMLElement;
  private readonly evalCodeEl: HTMLTextAreaElement;
  private readonly autoButton: HTMLButtonElement;
  private readonly autoCount: number;
  private batchNo = 0;

  constructor(handlers: PanelHandlers, autoCount = 5) {
    this.autoCount = autoCount;
    this.statusEl = mustFind('#status');
    this.logEl = mustFind('#log');
    this.statOps = mustFind('#stat-ops');
    this.statBatches = mustFind('#stat-batches');
    this.statEvents = mustFind('#stat-events');
    this.statRtt = mustFind('#stat-rtt');
    this.evalCodeEl = mustFind<HTMLTextAreaElement>('#eval-code');
    this.autoButton = mustFind<HTMLButtonElement>('#btn-auto');

    mustFind('#btn-click').addEventListener('click', () => handlers.onSimulateClick());
    this.autoButton.addEventListener('click', () => handlers.onAutoClicks(this.autoCount));
    mustFind('#btn-clear').addEventListener('click', () => handlers.onClearLog());
    mustFind('#btn-eval').addEventListener('click', () => handlers.onEval(this.evalCodeEl.value));
    mustFind<HTMLInputElement>('#chk-flash').addEventListener('change', (event) => {
      handlers.onHighlightChange((event.target as HTMLInputElement).checked);
    });
  }

  setStatus(text: string, isError = false): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('error', isError);
  }

  renderStats(stats: BridgeStats): void {
    this.statOps.textContent = String(stats.ops);
    this.statBatches.textContent = String(stats.batches);
    this.statEvents.textContent = String(stats.events);
    this.statRtt.textContent =
      stats.lastRoundTripMs === null ? '—' : `${stats.lastRoundTripMs.toFixed(1)} ms`;
  }

  logBatch(ops: readonly Op[]): void {
    this.batchNo += 1;
    const row = document.createElement('li');
    row.className = 'batch';

    const head = document.createElement('div');
    head.className = 'batch-head';
    head.textContent = `batch #${this.batchNo} · ${ops.length} ops`;
    row.appendChild(head);

    const list = document.createElement('div');
    list.className = 'batch-ops';
    for (const op of ops) {
      const opRow = document.createElement('div');
      opRow.className = 'op-row';

      const name = document.createElement('span');
      name.className = 'op-name';
      name.textContent = op.op;

      opRow.append(name, document.createTextNode(` ${describeOp(op)}`));
      list.appendChild(opRow);
    }
    row.appendChild(list);
    this.prepend(row);
  }

  logInfo(text: string): void {
    const row = document.createElement('li');
    row.className = 'batch info';
    row.textContent = text;
    this.prepend(row);
  }

  logEvalResult(outcome: EvalOutcome): void {
    const row = document.createElement('li');
    row.className = `batch eval ${outcome.ok ? 'ok' : 'fail'}`;
    row.textContent = `${outcome.ok ? 'eval → ' : 'eval ✗ '}${truncate(outcome.value, 200)}`;
    this.prepend(row);
  }

  clearLog(): void {
    this.logEl.replaceChildren();
  }

  setAutoButtonDisabled(disabled: boolean): void {
    this.autoButton.disabled = disabled;
  }

  /** 用示例清单填充顶部的应用切换器（切换即整页重载，URL 可分享 / 可调试）。 */
  bindExampleSelector(
    apps: readonly HostedApp[],
    currentId: string,
    onChange: (id: string) => void,
  ): void {
    const select = mustFind<HTMLSelectElement>('#example-select');
    select.replaceChildren();
    for (const app of apps) {
      const option = document.createElement('option');
      option.value = app.id;
      option.textContent = app.title;
      option.selected = app.id === currentId;
      select.appendChild(option);
    }
    select.addEventListener('change', () => onChange(select.value));
  }

  private prepend(row: HTMLElement): void {
    this.logEl.prepend(row);
    while (this.logEl.children.length > MAX_LOG_ROWS) {
      this.logEl.lastElementChild?.remove();
    }
  }
}

function mustFind<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`调试面板缺少元素: ${selector}`);
  return element;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
