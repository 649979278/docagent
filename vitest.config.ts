import path from 'node:path';

/**
 * 根级 Vitest 配置。
 * 为第三期的根目录 e2e/集成测试提供统一入口，并把 workspace 包别名映射到源码目录。
 */
export default {
  resolve: {
    alias: {
      '@workagent/agent-core': path.resolve(__dirname, 'packages/agent-core/src/index.ts'),
      '@workagent/docgen': path.resolve(__dirname, 'packages/docgen/src/index.ts'),
      '@workagent/ingest': path.resolve(__dirname, 'packages/ingest/src/index.ts'),
      '@workagent/model-provider': path.resolve(__dirname, 'packages/model-provider/src/index.ts'),
      '@workagent/rag': path.resolve(__dirname, 'packages/rag/src/index.ts'),
      '@workagent/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@workagent/store': path.resolve(__dirname, 'packages/store/src/index.ts'),
      '@workagent/tools': path.resolve(__dirname, 'packages/tools/src/index.ts'),
      '@workagent/windows-tools': path.resolve(__dirname, 'packages/windows-tools/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 30000,
  },
};
