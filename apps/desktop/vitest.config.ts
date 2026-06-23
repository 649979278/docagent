import path from 'node:path';

/**
 * Desktop 包 Vitest 配置。
 * 当前只覆盖可纯函数化的 renderer 逻辑，Electron main 相关逻辑保持通过根级 e2e 覆盖。
 */
export default {
  resolve: {
    alias: {
      '@workagent/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
};
