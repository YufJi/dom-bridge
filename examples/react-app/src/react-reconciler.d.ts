/**
 * react-reconciler 的 host config 签名随版本变化（0.29.x 与 0.2x 差异很大），
 * 社区类型包通常滞后，因此这里只声明我们用到的模块形状，
 * 具体调用签名由 `reconciler-types.ts` 按已安装版本的源码调用点手写。
 */
declare module 'react-reconciler' {
  const factory: unknown;
  export default factory;
}

// 注意：react-reconciler 没有 exports 映射，Node ESM 要求显式扩展名
declare module 'react-reconciler/constants.js' {
  export const ConcurrentRoot: number;
  export const LegacyRoot: number;
  export const ContinuousEventPriority: number;
  export const DefaultEventPriority: number;
  export const DiscreteEventPriority: number;
  export const IdleEventPriority: number;
}
