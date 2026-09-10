import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'docs/**', 'coverage/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // TS 编译器负责全局/类型检查，ESLint 的 no-undef 会误报类型与 lib 全局
      'no-undef': 'off',
      // 跨包消费 TS 源码时，ambient 声明需要用 path 引用显式拉进 program
      '@typescript-eslint/triple-slash-reference': [
        'error',
        { path: 'always', types: 'prefer-import', lib: 'always' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
