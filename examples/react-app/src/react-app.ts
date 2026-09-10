/// <reference path="./react-reconciler.d.ts" />
import React from 'react';
import type { ReactNode } from 'react';
import type { VirtualDocument } from '@dom-bridge/engine';
import createReconciler from 'react-reconciler';
import { ConcurrentRoot } from 'react-reconciler/constants.js';
import { createHostConfig } from './host-config.ts';
import type { ReconcilerFactory } from './reconciler-types.ts';

/**
 * React 18 示例应用。
 *
 * 它跑在“无 DOM 的引擎线程”里：React 树通过自定义 host config 直接提交到
 * `VirtualDocument`，再由 op 流渲染到渲染线程的真实 DOM。
 */

// react-reconciler 是 CJS 工厂函数，这里显式标注我们按 0.29 源码整理的签名
const reconcilerFactory = createReconciler as unknown as ReconcilerFactory;
const h = React.createElement;

interface Todo {
  readonly id: number;
  readonly title: string;
  readonly done: boolean;
}

const colors = ['#1677ff', '#d4380d', '#389e0d', '#722ed1'];
let todoSequence = 0;
let renderCount = 0;

function App(): ReactNode {
  const [count, setCount] = React.useState(0);
  const [todos, setTodos] = React.useState<Todo[]>([]);
  renderCount += 1;

  const addTodo = (): void => {
    todoSequence += 1;
    const todo: Todo = { id: todoSequence, title: `任务 #${todoSequence}`, done: false };
    setTodos((list) => [...list, todo]);
  };

  const toggleTodo = (id: number): void => {
    setTodos((list) => list.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo)));
  };

  const removeTodo = (id: number): void => {
    setTodos((list) => list.filter((todo) => todo.id !== id));
  };

  return h(
    'div',
    { id: 'react-app' },
    h('h1', null, 'React 18 · 在无 DOM 的引擎线程里渲染'),
    h(
      'p',
      null,
      '这棵树由 react-reconciler 的自定义 host config 提交到虚拟 DOM 代理，再经 op 流渲染到左侧真实 DOM。',
    ),
    h(
      'div',
      { className: 'panel' },
      h(
        'span',
        { className: 'counter', style: { color: colors[count % colors.length] ?? '#1677ff' } },
        `计数: ${count}`,
      ),
      h('button', { onClick: () => setCount((value) => value + 1) }, '计数 +1'),
      h('button', { onClick: () => setCount(0) }, '清零'),
    ),
    h(
      'div',
      { className: 'panel' },
      h('button', { onClick: addTodo }, '添加任务'),
      h('span', { className: 'meta' }, `共 ${todos.length} 条`),
    ),
    h(
      'ul',
      { className: 'todos' },
      todos.map((todo) =>
        h(
          'li',
          { key: String(todo.id), className: todo.done ? 'todo done' : 'todo' },
          h(
            'span',
            {
              style: {
                textDecoration: todo.done ? 'line-through' : 'none',
                color: todo.done ? '#8b94a6' : '#1c1f26',
              },
            },
            todo.title,
          ),
          h('button', { onClick: () => toggleTodo(todo.id) }, todo.done ? '撤销' : '完成'),
          h('button', { onClick: () => removeTodo(todo.id) }, '删除'),
        ),
      ),
    ),
    h('p', { className: 'meta' }, `React ${React.version} · 组件渲染 ${renderCount} 次`),
  );
}

export function mountReactApp(document: VirtualDocument): void {
  console.log(`[react-app] React ${React.version} 启动（自定义 renderer，无真实 DOM）`);

  const reconciler = reconcilerFactory(createHostConfig(document));
  const root = reconciler.createContainer(document.body, ConcurrentRoot, null, false);
  reconciler.updateContainer(h(App, null), root, null, () => {
    console.log('[react-app] 首屏提交完成');
  });
}
