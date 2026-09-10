import type { VirtualDataset } from './types.ts';

/** dataset 需要节点的属性枚举与读写能力。 */
export interface DatasetTarget {
  attributeNames(): string[];
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string | null): void;
  removeAttribute(name: string): void;
}

const DATA_PREFIX = 'data-';

/** `dataset.userId` ↔ `data-user-id`，读写都落到属性上（与 className / classList 共用同一份真相）。 */
export function createDataset(target: DatasetTarget): VirtualDataset {
  return new Proxy({} as VirtualDataset, {
    get: (_value, property) => {
      if (typeof property !== 'string') return undefined;
      const name = `${DATA_PREFIX}${toKebabCase(property)}`;
      if (!target.attributeNames().includes(name)) return undefined;
      return target.getAttribute(name) ?? undefined;
    },
    set: (_value, property, value: unknown) => {
      if (typeof property !== 'string') return false;
      const name = `${DATA_PREFIX}${toKebabCase(property)}`;
      if (value === null || value === undefined) target.removeAttribute(name);
      else target.setAttribute(name, String(value));
      return true;
    },
    deleteProperty: (_value, property) => {
      if (typeof property !== 'string') return false;
      target.removeAttribute(`${DATA_PREFIX}${toKebabCase(property)}`);
      return true;
    },
    has: (_value, property) =>
      typeof property === 'string' &&
      target.attributeNames().includes(`${DATA_PREFIX}${toKebabCase(property)}`),
    ownKeys: () =>
      target
        .attributeNames()
        .filter((name) => name.startsWith(DATA_PREFIX))
        .map((name) => toCamelCase(name.slice(DATA_PREFIX.length))),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });
}

function toKebabCase(name: string): string {
  return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function toCamelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
}
