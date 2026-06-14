/**
 * QueryLoopState 不可变性测试
 * 验证：
 * 1. createQueryLoopState 创建的初始状态字段完整
 * 2. updateQueryLoopState 返回新对象，旧引用不变
 * 3. 嵌套对象（diagnostics, autoCompactTracking）不可变
 * 4. 消息列表不可变（追加消息不修改旧列表）
 */

import { describe, it, expect } from 'vitest';
import { createQueryLoopState, updateQueryLoopState } from '../query-state.js';
import type { AutoCompactTracking, QueryLoopState } from '../query-state.js';
import type { ContextBudget, Memory, PromptDiagnostics } from '@workagent/shared';

/** 创建测试用预算 */
function createTestBudget(): ContextBudget {
  return {
    systemPrompt: 500,
    conversationHistory: 15000,
    ragResults: 8000,
    toolResults: 4000,
    maxCompletionTokens: 4096,
    total: 32768,
  };
}

/** 创建测试用记忆 */
function createTestMemories(): Memory[] {
  return [
    {
      id: 'mem-1',
      type: 'user_requirement',
      content: '使用正式语气',
      source: 'session-1',
      enabled: true,
      createdAt: Date.now(),
    },
  ];
}

describe('createQueryLoopState', () => {
  it('创建的初始状态字段完整', () => {
    const state = createQueryLoopState('session-1', 'chat', createTestBudget(), createTestMemories(), '你好');

    expect(state.sessionId).toBe('session-1');
    expect(state.mode).toBe('chat');
    expect(state.messages).toEqual([]);
    expect(state.turnCount).toBe(0);
    expect(state.totalTokensUsed).toBe(0);
    expect(state.transition).toBe('next_turn');
    expect(state.lastCompactBoundaryId).toBeNull();
    expect(state.activePlan).toBeNull();
    expect(state.compactCount).toBe(0);
    expect(state.budget).toEqual(createTestBudget());
    expect(state.memories).toHaveLength(1);
    expect(state.memories[0].id).toBe('mem-1');
    expect(state.memories[0].content).toBe('使用正式语气');
    expect(state.ragChunks).toEqual([]);
    expect(state.hasAttemptedReactiveCompact).toBe(false);
    expect(state.maxOutputTokensRecoveryCount).toBe(0);
    expect(state.userInput).toBe('你好');
    expect(state.assistantContent).toBe('');
    expect(state.hasToolCalls).toBe(false);
    expect(state.hasError).toBe(false);
    expect(state.retried).toBe(false);
  });

  it('初始 diagnostics 字段完整且为默认值', () => {
    const state = createQueryLoopState('session-1', 'chat', createTestBudget(), [], '测试');

    expect(state.diagnostics.triggeredSections).toEqual([]);
    expect(state.diagnostics.historyTokens).toBe(0);
    expect(state.diagnostics.ragTokens).toBe(0);
    expect(state.diagnostics.toolTokens).toBe(0);
    expect(state.diagnostics.completionTokens).toBe(0);
    expect(state.diagnostics.hadToolCall).toBe(false);
    expect(state.diagnostics.toolParseFailed).toBe(false);
    expect(state.diagnostics.compactOccurred).toBe(false);
    expect(state.diagnostics.compactFreedTokens).toBe(0);
    expect(state.diagnostics.terminalReason).toBeNull();
    expect(state.diagnostics.planTransition).toBeNull();
    expect(state.diagnostics.ragHitCount).toBe(0);
    expect(state.diagnostics.ragInjectedTokens).toBe(0);
  });

  it('初始 autoCompactTracking 字段完整且为默认值', () => {
    const state = createQueryLoopState('session-1', 'chat', createTestBudget(), [], '测试');

    expect(state.autoCompactTracking.lastCompactedMessageCount).toBe(0);
    expect(state.autoCompactTracking.compactCount).toBe(0);
    expect(state.autoCompactTracking.consecutiveFailures).toBe(0);
    expect(state.autoCompactTracking.circuitBreakerTripped).toBe(false);
  });

  it('plan 模式初始化 planPhase 为 PLAN_COLLECT', () => {
    const state = createQueryLoopState('session-1', 'plan', createTestBudget(), [], '写报告');
    expect(state.planPhase).toBe('PLAN_COLLECT');
  });
});

describe('updateQueryLoopState 不可变性', () => {
  it('更新返回新对象，旧引用不变', () => {
    const original = createQueryLoopState('session-1', 'chat', createTestBudget(), [], '你好');
    const updated = updateQueryLoopState(original, { turnCount: 5 });

    // 旧状态不变
    expect(original.turnCount).toBe(0);
    // 新状态已更新
    expect(updated.turnCount).toBe(5);
    // 不是同一个引用
    expect(updated).not.toBe(original);
  });

  it('多次更新互不影响', () => {
    const original = createQueryLoopState('session-1', 'chat', createTestBudget(), [], '你好');
    const updated1 = updateQueryLoopState(original, { turnCount: 1 });
    const updated2 = updateQueryLoopState(original, { turnCount: 2 });

    expect(original.turnCount).toBe(0);
    expect(updated1.turnCount).toBe(1);
    expect(updated2.turnCount).toBe(2);
    // 三个不同的引用
    expect(updated1).not.toBe(updated2);
  });

  it('更新 transition 不影响旧状态的 transition', () => {
    const original = createQueryLoopState('session-1', 'chat', createTestBudget(), [], '你好');
    const updated = updateQueryLoopState(original, { transition: 'completed' });

    expect(original.transition).toBe('next_turn');
    expect(updated.transition).toBe('completed');
  });

  it('更新 diagnostics 不影响旧状态的 diagnostics', () => {
    const original = createQueryLoopState('session-1', 'chat', createTestBudget(), [], '你好');
    const updated = updateQueryLoopState(original, {
      diagnostics: { ...original.diagnostics, hadToolCall: true, completionTokens: 500 },
    });

    // 旧 diagnostics 不变
    expect(original.diagnostics.hadToolCall).toBe(false);
    expect(original.diagnostics.completionTokens).toBe(0);
    // 新 diagnostics 已更新
    expect(updated.diagnostics.hadToolCall).toBe(true);
    expect(updated.diagnostics.completionTokens).toBe(500);
  });

  it('更新 autoCompactTracking 不影响旧状态', () => {
    const original = createQueryLoopState('session-1', 'chat', createTestBudget(), [], '你好');
    const updated = updateQueryLoopState(original, {
      autoCompactTracking: {
        ...original.autoCompactTracking,
        compactCount: 3,
        circuitBreakerTripped: true,
      },
    });

    expect(original.autoCompactTracking.compactCount).toBe(0);
    expect(original.autoCompactTracking.circuitBreakerTripped).toBe(false);
    expect(updated.autoCompactTracking.compactCount).toBe(3);
    expect(updated.autoCompactTracking.circuitBreakerTripped).toBe(true);
  });

  it('更新 messages 不影响旧的消息列表', () => {
    const original = createQueryLoopState('session-1', 'chat', createTestBudget(), [], '你好');
    const newMessages = [...original.messages, {
      id: 'msg-1',
      role: 'user' as const,
      content: '新消息',
      tokenCount: 10,
      timestamp: Date.now(),
    }];
    const updated = updateQueryLoopState(original, { messages: newMessages });

    expect(original.messages).toHaveLength(0);
    expect(updated.messages).toHaveLength(1);
    expect(updated.messages[0].content).toBe('新消息');
  });

  it('链式更新保持不可变', () => {
    const original = createQueryLoopState('session-1', 'chat', createTestBudget(), [], '你好');

    // 模拟一轮完整的不可变更新链
    let state = original;
    state = updateQueryLoopState(state, { turnCount: 1 });
    state = updateQueryLoopState(state, { totalTokensUsed: 100 });
    state = updateQueryLoopState(state, { hasToolCalls: true });
    state = updateQueryLoopState(state, { transition: 'next_turn' });

    // 原始状态完全不变
    expect(original.turnCount).toBe(0);
    expect(original.totalTokensUsed).toBe(0);
    expect(original.hasToolCalls).toBe(false);
    expect(original.transition).toBe('next_turn');

    // 新状态已累积更新
    expect(state.turnCount).toBe(1);
    expect(state.totalTokensUsed).toBe(100);
    expect(state.hasToolCalls).toBe(true);
    expect(state.transition).toBe('next_turn');
  });

  it('更新 hasError 和 retried 不影响旧状态', () => {
    const original = createQueryLoopState('session-1', 'chat', createTestBudget(), [], '你好');
    const updated = updateQueryLoopState(original, { hasError: true, retried: false });

    expect(original.hasError).toBe(false);
    expect(original.retried).toBe(false);
    expect(updated.hasError).toBe(true);
    expect(updated.retried).toBe(false);
  });
});
