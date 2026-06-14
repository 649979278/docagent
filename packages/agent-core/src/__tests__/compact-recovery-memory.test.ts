/**
 * 压缩后记忆恢复测试
 * 验证：
 * 1. 压缩后记忆被重新注入到消息列表
 * 2. 注入的记忆消息角色为 system
 * 3. 记忆注入受预算限制
 * 4. 无记忆时不注入
 */

import { describe, it, expect, vi } from 'vitest';
import { recoverFromCompact } from '../context/compact-recovery.js';
import type { Message, Memory } from '@workagent/shared';
import type { QueryLoopState } from '../query-state.js';
import { createQueryLoopState } from '../query-state.js';

// ============================================================
// Mock 工具函数
// ============================================================

/** 创建测试用记忆 */
function createMemories(): Memory[] {
  return [
    { id: 'mem-1', type: 'user_requirement', content: '必须使用正式公文格式', source: 'session-1', enabled: true, createdAt: Date.now() },
    { id: 'mem-2', type: 'style_preference', content: '避免口语化表达', source: 'session-1', enabled: true, createdAt: Date.now() },
    { id: 'mem-3', type: 'banned_expression', content: '不要使用网络用语', source: 'session-1', enabled: false, createdAt: Date.now() },
  ];
}

/** 创建测试用状态 */
function createTestState(overrides?: Partial<QueryLoopState>): QueryLoopState {
  const base = createQueryLoopState('session-1', 'chat', {
    systemPrompt: 500, conversationHistory: 15000, ragResults: 8000, toolResults: 4000, maxCompletionTokens: 4096, total: 32768,
  }, createMemories(), '测试输入');

  return { ...base, ...overrides };
}

// ============================================================
// 测试
// ============================================================

describe('压缩后记忆恢复', () => {
  it('压缩后记忆被重新注入到消息列表', async () => {
    const state = createTestState();
    const result = await recoverFromCompact(state);

    expect(result.memoryInjected).toBe(true);
    // 消息列表应增加记忆消息
    expect(result.state.messages.length).toBeGreaterThan(state.messages.length);
  });

  it('注入的记忆消息角色为 system', async () => {
    const state = createTestState();
    const result = await recoverFromCompact(state);

    const memoryMessages = result.state.messages.filter(
      m => m.id.startsWith('recovery-memory-'),
    );
    expect(memoryMessages.length).toBeGreaterThan(0);
    for (const msg of memoryMessages) {
      expect(msg.role).toBe('system');
    }
  });

  it('记忆注入内容包含用户偏好', async () => {
    const state = createTestState();
    const result = await recoverFromCompact(state);

    const memoryMessages = result.state.messages.filter(
      m => m.id.startsWith('recovery-memory-'),
    );
    if (memoryMessages.length > 0) {
      // 应包含启用的记忆内容
      expect(memoryMessages[0].content).toContain('用户要求');
      expect(memoryMessages[0].content).toContain('必须使用正式公文格式');
      // 不应包含禁用的记忆
      expect(memoryMessages[0].content).not.toContain('不要使用网络用语');
    }
  });

  it('无记忆时不注入', async () => {
    const state = createTestState({ memories: [] });
    const result = await recoverFromCompact(state);

    expect(result.memoryInjected).toBe(false);
    const memoryMessages = result.state.messages.filter(
      m => m.id.startsWith('recovery-memory-'),
    );
    expect(memoryMessages.length).toBe(0);
  });

  it('记忆注入受预算限制', async () => {
    const manyMemories: Memory[] = Array.from({ length: 50 }, (_, i) => ({
      id: `mem-${i}`,
      type: 'user_requirement' as const,
      content: `很长的记忆内容${'填充'.repeat(100)}`,
      source: 'session-1',
      enabled: true,
      createdAt: Date.now(),
    }));

    const state = createTestState({ memories: manyMemories });
    // 设置极小预算
    const result = await recoverFromCompact(
      state, null, { fileAttachmentBudget: 100 },
    );

    // 预算不够时可能无法注入
    const memoryMessages = result.state.messages.filter(
      m => m.id.startsWith('recovery-memory-'),
    );
    // 即使有大量记忆，注入也应受预算控制
    expect(result.totalRecoveryTokens).toBeLessThanOrEqual(100);
  });

  it('恢复不修改原状态的 messages 引用', async () => {
    const state = createTestState();
    const originalMessages = state.messages;

    const result = await recoverFromCompact(state);

    // 新状态的消息列表应该是新数组（不可变更新）
    expect(result.state.messages).not.toBe(originalMessages);
  });
});
