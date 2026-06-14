import { describe, expect, it } from 'vitest';

/**
 * IPC 领域处理器注册测试。
 * 验证各领域 IPC 模块导出了正确的注册函数。
 */
describe('IPC domain registration', () => {
  it('chat, knowledge, settings IPC modules all export register functions', async () => {
    // 动态导入各领域模块
    const chatModule = await import('../../apps/desktop/electron/ipc/chat-ipc.js');
    const knowledgeModule = await import('../../apps/desktop/electron/ipc/knowledge-ipc.js');
    const settingsModule = await import('../../apps/desktop/electron/ipc/settings-ipc.js');
    const workspaceModule = await import('../../apps/desktop/electron/ipc/workspace-ipc.js');

    expect(typeof chatModule.registerChatIpc).toBe('function');
    expect(typeof knowledgeModule.registerKnowledgeIpc).toBe('function');
    expect(typeof settingsModule.registerSettingsIpc).toBe('function');
    expect(typeof workspaceModule.registerWorkspaceIpc).toBe('function');
  });

  it('context module exports IpcHandlerContext type', async () => {
    const contextModule = await import('../../apps/desktop/electron/ipc/context.js');
    // TypeScript 类型导出在运行时不可直接验证，验证模块可导入即可
    expect(contextModule).toBeDefined();
  });

  it('chat-ipc exports createChatRuntimeState', async () => {
    const chatModule = await import('../../apps/desktop/electron/ipc/chat-ipc.js');
    expect(typeof chatModule.createChatRuntimeState).toBe('function');

    // 验证 state 创建结果
    const state = chatModule.createChatRuntimeState(null);
    expect(state.currentRunId).toBeNull();
    expect(state.activeChatSessionId).toBeNull();
    expect(state.currentIterator).toBeNull();
    expect(state.terminalRunIds).toBeInstanceOf(Set);
    expect(state.useWorkerMode).toBe(false);
  });
});
