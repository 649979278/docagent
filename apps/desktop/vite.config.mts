import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Vite配置 - Electron渲染进程构建
 * 将React应用打包到renderer/目录
 * - root: src目录（含index.html入口）
 * - outDir: renderer目录（Electron加载目标）
 *
 * 使用.mts扩展名强制ESM模式，解决@tailwindcss/vite@4的ESM-only兼容问题
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: resolve(__dirname, 'src'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'renderer'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
