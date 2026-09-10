import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages 部署在子路径下时由 CI 注入 PAGES_BASE（本地默认 /）
  base: process.env.PAGES_BASE ?? '/',
  server: {
    // 双栈监听：默认只绑 ::1 时，浏览器把 localhost 解析到 127.0.0.1 会连不上
    host: '::',
    port: 5173,
  },
  // 引擎线程是 ES module worker，需要按 ESM 打包
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2023',
    sourcemap: true,
  },
});
