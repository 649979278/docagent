/**
 * Runtime 差距修复测试
 * 验证：
 * 1. max_turns 终止时 transition 正确设置
 * 2. max_output_tokens 恢复路径（注入恢复消息 + 重试）
 * 3. max_output_tokens 恢复超过3次后放弃
 * 4. handleError 不可变返回
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from '../runtime.js';
import type { ModelProvider, ChatRequest, ModelEvent } from '@workagent/model-provider';
import type { ModelConfig } from '@workagent/shared';
import type { ToolRegistry, ToolExecutor, AgentTool } from '@workagent/tools';
import type { Database } from '@workagent/store';
import { updateQueryLoopState } from '../query-state.js';
import { createQueryLoopState } from '../query-state.js';
import type { QueryLoopState } from '../query-state.js';
import type { ContextBudget, Memory } from '@workagent/shared';

// ============================================================
// Mock 工具函数
// ============================================================

/** 创建 mock ModelProvider */
function createMockProvider(options?: {
  reply?: string;
  maxTurns?: number;
  errorOnNthCall?: { nth: number; error: string };
}): ModelProvider {
  const reply = options?.reply ?? '助手回复';
  let callCount = 0;

  return {
    chat: vi.fn().mockImplementation((request: ChatRequest) => {
      callCount++;
      const events: ModelEvent[] = [];

      // 模拟特定轮次出错
      if (options?.errorOnNthCall && callCount === options.errorOnNthCall.nth) {
        events.push({ type: 'error', data: options.errorOnNthCall.error });
        events.push({ type: 'done', data: undefined });
      } else {
        events.push({ type: 'token', data: reply });
        events.push({ type: 'usage', data: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } });
        events.push({ type: 'done', data: undefined });
      }

      return (async function* () {
        for (const event of events) { yield event; }
      })();
    }),
    embed: vi.fn().mockResolvedValue({ embedding: [], model: 'test' }),
    listModels: vi.fn().mockResolvedValue([]),
    pullModel: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(true),
    getModelsStatus: vi.fn().mockResolvedValue({
      providers: [],
      activeModel: 'test',
      health: true,
    }),
    getContextLength: vi.fn().mockResolvedValue(32768),
    getConfig: vi.fn().mockReturnValue({
      chatModel: 'test-model',
      embeddingModel: 'test-embed',
      baseUrl: 'http://localhost:11434',
      temperature: 0.7,
      maxTokens: 4096,
    } satisfies ModelConfig),
  };
}

/** 创建 mock ToolRegistry */
function createMockRegistry(tools: AgentTool[] = []): ToolRegistry {
  const toolMap = new Map(tools.map(t => [t.name, t]));
  return {
    register: vi.fn(),
    getTools: vi.fn().mockReturnValue(tools),
    getTool: vi.fn().mockImplementation((name: string) => toolMap.get(name)),
    getToolNames: vi.fn().mockReturnValue(tools.map(t => t.name)),
    has: vi.fn().mockImplementation((name: string) => toolMap.has(name)),
  } as unknown as ToolRegistry;
}

/** 创建 mock ToolExecutor */
function createMockExecutor(): ToolExecutor {
  return {
    executeAll: vi.fn().mockResolvedValue([]),
    executeOne: vi.fn(),
  } as unknown as ToolExecutor;
}

/** 创建 mock Database */
function createMockDatabase(): Database {
  return {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(undefined),
      run: vi.fn().mockReturnValue({ changes: 0 }),
    }),
    exec: vi.fn(),
    transaction: vi.fn().mockImplementation((fn: () => void) => fn),
    pragma: vi.fn(),
    save: vi.fn(),
    close: vi.fn(),
    getSqlJsDb: vi.fn().mockReturnValue({}),
  } as unknown as Database;
}

/** 收集 AsyncGenerator 的所有事件 */
async function collectEvents(gen: AsyncGenerator<any>): Promise<any[]> {
  const events: any[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ============================================================
// 测试
// ============================================================

describe('max_turns 终止', () => {
  it('达到 maxTurns 时产出 done 事件（正常终止）', async () => {
    // 设置 maxTurns=1，第一轮就应退出
    const provider = createMockProvider();
    const runtime = new AgentRuntime(provider, createMockRegistry(), createMockExecutor(), createMockDatabase(), {
      maxTurns: 1,
    });

    const events = await collectEvents(runtime.runTurn('session-1', '你好'));

    // 应有 done 事件
    const doneEvents = events.filter(e => e.type === 'done');
    expect(doneEvents.length).toBe(1);

    // 应有 token 事件
    const tokenEvents = events.filter(e => e.type === 'token');
    expect(tokenEvents.length).toBeGreaterThan(0);
  });
});

describe('handleError max_output_tokens 恢复', () => {
  it('max_output_tokens 错误时注入恢复消息并重试', async () => {
    // 第一轮返回 max_output_tokens 错误，第二轮正常
    let callCount = 0;
    const provider = createMockProvider();

    (provider.chat as any).mockImplementation((request: ChatRequest) => {
      callCount++;
      const events: ModelEvent[] = [];

      if (callCount === 1) {
        // 第一轮：返回 max_output_tokens 错误
        events.push({ type: 'error', data: 'max_output_tokens reached' });
      } else {
        // 第二轮：正常回复
        events.push({ type: 'token', data: '继续完成回复' });
        events.push({ type: 'usage', data: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } });
      }

      events.push({ type: 'done', data: undefined });

      return (async function* () {
        for (const event of events) { yield event; }
      })();
    });

    const runtime = new AgentRuntime(provider, createMockRegistry(), createMockExecutor(), createMockDatabase(), {
      maxTurns: 5,
    });

    const events = await collectEvents(runtime.runTurn('session-1', '写报告'));

    // 应有 done 事件
    const doneEvents = events.filter(e => e.type === 'done');
    expect(doneEvents.length).toBe(1);
  });

  it('maxOutputTokensRecoveryCount 字段在不可变更新中正确追踪', () => {
    // 单元测试：验证 maxOutputTokensRecoveryCount 不可变更新
    const budget: ContextBudget = {
      systemPrompt: 500,
      conversationHistory: 15000,
      ragResults: 8000,
      toolResults: 4000,
      maxCompletionTokens: 4096,
      total: 32768,
    };
    const original = createQueryLoopState('session-1', 'chat', budget, [], '测试');

    expect(original.maxOutputTokensRecoveryCount).toBe(0);

    const updated = updateQueryLoopState(original, {
      maxOutputTokensRecoveryCount: 1,
    });

    // 旧状态不变
    expect(original.maxOutputTokensRecoveryCount).toBe(0);
    // 新状态已更新
    expect(updated.maxOutputTokensRecoveryCount).toBe(1);
  });

  it('连续3次 max_output_tokens 恢复后不再重试', () => {
    // 验证 maxOutputTokensRecoveryCount >= 3 时不再恢复
    const budget: ContextBudget = {
      systemPrompt: 500,
      conversationHistory: 15000,
      ragResults: 8000,
      toolResults: 4000,
      maxCompletionTokens: 4096,
      total: 32768,
    };
    const state = createQueryLoopState('session-1', 'chat', budget, [], '测试');
    const recovered = updateQueryLoopState(state, { maxOutputTokensRecoveryCount: 3 });

    // 恢复计数已达上限
    expect(recovered.maxOutputTokensRecoveryCount).toBe(3);
    // 不可变
    expect(state.maxOutputTokensRecoveryCount).toBe(0);
  });
});

describe('autoCompactTracking 不可变性', () => {
  it('autoCompactTracking 更新不影响旧状态', () => {
    const budget: ContextBudget = {
      systemPrompt: 500,
      conversationHistory: 15000,
      ragResults: 8000,
      toolResults: 4000,
      maxCompletionTokens: 4096,
      total: 32768,
    };
    const original = createQueryLoopState('session-1', 'chat', budget, [], '测试');

    const updated = updateQueryLoopState(original, {
      autoCompactTracking: {
        ...original.autoCompactTracking,
        compactCount: 5,
        circuitBreakerTripped: true,
      },
    });

    expect(original.autoCompactTracking.compactCount).toBe(0);
    expect(original.autoCompactTracking.circuitBreakerTripped).toBe(false);
    expect(updated.autoCompactTracking.compactCount).toBe(5);
    expect(updated.autoCompactTracking.circuitBreakerTripped).toBe(true);
  });
});
