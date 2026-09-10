import type { VirtualClassList } from './types.ts';

/** classList 只需要节点的属性读写能力。 */
export interface ClassListTarget {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string | null): void;
}

/**
 * `classList` 实现：读写都落到 `class` 属性上，因此与 `className` 天然同步。
 * 每次变更发一条 setAttribute op，不额外引入协议。
 */
export class ClassList implements VirtualClassList {
  private readonly target: ClassListTarget;

  constructor(target: ClassListTarget) {
    this.target = target;
  }

  get value(): string {
    return this.target.getAttribute('class') ?? '';
  }

  get length(): number {
    return this.tokens().length;
  }

  item(index: number): string | null {
    return this.tokens()[index] ?? null;
  }

  contains(token: string): boolean {
    return this.tokens().includes(assertToken(token));
  }

  add(...tokens: string[]): void {
    const next = this.tokens();
    for (const token of tokens.map(assertToken)) {
      if (!next.includes(token)) next.push(token);
    }
    this.write(next);
  }

  remove(...tokens: string[]): void {
    const removing = new Set(tokens.map(assertToken));
    this.write(this.tokens().filter((token) => !removing.has(token)));
  }

  toggle(token: string, force?: boolean): boolean {
    const name = assertToken(token);
    const present = this.contains(name);
    const shouldAdd = force === undefined ? !present : force;
    if (shouldAdd) this.add(name);
    else this.remove(name);
    return shouldAdd;
  }

  toString(): string {
    return this.value;
  }

  private tokens(): string[] {
    return this.value.split(/\s+/).filter(Boolean);
  }

  private write(tokens: string[]): void {
    const next = tokens.join(' ');
    if (next === this.value) return;
    this.target.setAttribute('class', next);
  }
}

function assertToken(token: string): string {
  if (token === '' || /\s/.test(token)) {
    throw new Error(`classList: 非法的 token "${token}"`);
  }
  return token;
}
