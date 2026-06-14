/**
 * Compact 五层全流程集成测试
 * 验证五层 compact 的完整流程：
 * 层1: microCompact - 每轮 pipeline
 * 层2: autoCompactIfNeeded - 80% 阈值
 * 层3: compactContext - 90% 阈值
 * 层4: reactiveCompact - 413/prompt_too_long
 * 层5: recoverFromCompact - 压缩后第一轮
 *
 * 验证：
 * 1. 五层 compact 按顺序和条件正确触发
 * 2. compact 后 boundary 正确记录
 * 3. compact 后恢复机制正确工作
 * 4. circuit breaker 防止无限压缩
 * 5. 全流程 state 不可变更新
 */

import { describe, it, expect, vi } from 'vitest';
import { compactContext, reactiveCompact, autoCompactIfNeeded } from '../context/compact.js';
import { recoverFromCompact } from '../context/compact-recovery.js';
import { microCompact } from '../context/microCompact.js';
import type { Message, Memory, ContextBudget, Plan, RetrievedChunk } from '@workagent/shared';
import type { ModelProvider } from '@workagent/model-provider';
import type { AutoCompactTracking } from '../query-state.js';
import { createQueryLoopState } from '../query-state.js';
import type { RAGSearchProvider } from '@workagent/tools';

// ============================================================
// Mock 工具函数
// ============================================================

function createTestBudget(total: number = 32768): ContextBudget {
  return {
    systemPrompt: 500,
    conversationHistory: Math.floor(total * 0.6),
    ragResults: Math.floor(total * 0.25),
    toolResults: Math.floor(total * 0.15),
    maxCompletionTokens: 4096,
    total,
  };
}

function createMockProvider(): ModelProvider {
  return {
    chat: vi.fn().mockImplementation(async function* () {
      yield { type: 'token', data: '压缩摘要：用户讨论了测试内容，包含关键要求和结论' };
      yield { type: 'done' };
    }),
  } as unknown as ModelProvider;
}

/** 创建消息列表 */
function createMessages(tokenTotal: number, perMsg: number = 500): Message[] {
  const count = Math.ceil(tokenTotal / perMsg);
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `消息${i}内容`.repeat(Math.ceil(perMsg / 4)),
    tokenCount: perMsg,
    timestamp: Date.now() - (count - i) * 1000,
  }));
}

/** 创建带工具调用的消息 */
function createToolMessages(): Message[] {
  return [
    { id: 'user-1', role: 'user', content: '请帮我检索资料', tokenCount: 200, timestamp: Date.now() },
    { id: 'asst-1', role: 'assistant', content: '', tokenCount: 50, toolCalls: [{ id: 'call-1', name: 'rag_search', arguments: { query: '测试' } }], timestamp: Date.now() },
    { id: 'tool-1', role: 'tool', content: '检索结果内容'.repeat(50), tokenCount: 300, toolCallId: 'call-1', toolName: 'rag_search', timestamp: Date.now() },
    { id: 'asst-2', role: 'assistant', content: '根据检索结果分析', tokenCount: 200, timestamp: Date.now() },
  ];
}

function createDefaultTracking(): AutoCompactTracking {
  return {
    lastCompactedMessageCount: 0,
    compactCount: 0,
    consecutiveFailures: 0,
    circuitBreakerTripped: false,
  };
}

/** 创建活跃计划 */
function createActivePlan(): Plan {
  return {
    id: 'plan-1',
    sessionId: 'session-1',
    status: 'executing',
    title: '起草通知',
    goal: '起草正式通知',
    outline: {
      title: '起草通知',
      goal: '起草正式通知',
      materialBasis: '参考文档',
      structure: [
        { id: 'step-1', description: '研读材料', status: 'completed' },
        { id: 'step-2', description: '起草正文', status: 'in_progress' },
      ],
      expectedOutput: '正式通知',
      risks: [],
      questions: [],
      citations: ['chunk-1'],
    },
    createdAt: Date.now(),
  };
}

/** 创建 mock RAG 搜索提供者 */
function createMockRagProvider(): RAGSearchProvider {
  return {
    search: vi.fn().mockResolvedValue([
      { content: '参考材料内容', sourceFile: '文档.docx', sourceType: 'docx', locator: '段落1', score: 0.9, chunkId: 'chunk-1' } as RetrievedChunk,
    ]),
  };
}

/** 创建测试用记忆 */
function createMemories(): Memory[] {
  return [
    { id: 'mem-1', type: 'user_requirement', content: '必须使用正式格式', source: 's1', enabled: true, createdAt: Date.now() },
  ];
}

// ============================================================
// 测试
// ============================================================

describe('Compact 五层全流程', () => {
  it('层1: microCompact 清理过时 tool_result', () => {
    const toolMessages = createToolMessages();
    // 添加更多旧消息让 microCompact 有内容可压缩
    const oldMessages = createMessages(5000, 500);
    const allMessages = [...oldMessages, ...toolMessages];

    const result = microCompact(allMessages);

    // microCompact 应该正常执行
    expect(result.messages.length).toBeLessThanOrEqual(allMessages.length);
    // freedTokens 可能为0（如果所有 tool_result 都在保留范围内）
    expect(result.freedTokens).toBeGreaterThanOrEqual(0);
  });

  it('层2: autoCompactIfNeeded 在 80% 阈值触发', async () => {
    const budget = createTestBudget(5000);
    // 90% 使用率
    const messages = createMessages(Math.floor(budget.total * 0.9), 500);
    const provider = createMockProvider();

    const result = await autoCompactIfNeeded(
      messages, provider, [], budget, createDefaultTracking(),
    );

    expect(result.didCompact).toBe(true);
    expect(result.freedTokens).toBeGreaterThan(0);
    expect(result.boundary).not.toBeNull();
  });

  it('层3: compactContext 在 90% 阈值触发摘要压缩', async () => {
    const budget = createTestBudget(5000);
    const messages = createMessages(Math.floor(budget.total * 0.95), 500);
    const provider = createMockProvider();

    const result = await compactContext(messages, provider, [], budget);

    // 应该触发 level 2 摘要压缩
    expect(result.level).toBe(2);
    expect(result.strategy).toBe('summary');
    expect(result.boundary).not.toBeNull();
    expect(result.summary).not.toBeNull();
  });

  it('层4: reactiveCompact 直接执行摘要压缩', async () => {
    const messages = createMessages(15000, 500);
    const provider = createMockProvider();

    const result = await reactiveCompact(messages, provider, []);

    expect(result.strategy).toBe('reactive');
    expect(result.level).toBe(2);
    expect(result.boundary).not.toBeNull();
    expect(result.boundary!.strategy).toBe('reactive');
  });

  it('层5: recoverFromCompact 压缩后恢复', async () => {
    const plan = createActivePlan();
    const ragProvider = createMockRagProvider();
    const memories = createMemories();
    const budget = createTestBudget();

    const state = createQueryLoopState('session-1', 'plan', budget, memories, '请起草通知');
    state.activePlan = plan;

    const result = await recoverFromCompact(state, ragProvider);

    expect(result.memoryInjected).toBe(true);
    expect(result.planInjected).toBe(true);
    expect(result.ragRehydrated).toBe(true);
    expect(result.totalRecoveryTokens).toBeGreaterThan(0);
  });

  it('全流程：compact → boundary 记录 → recovery', async () => {
    const budget = createTestBudget(5000);
    const messages = createMessages(Math.floor(budget.total * 0.9), 500);
    const provider = createMockProvider();
    const memories = createMemories();
    const plan = createActivePlan();
    const ragProvider = createMockRagProvider();

    // 1. 自动压缩
    const compactResult = await autoCompactIfNeeded(
      messages, provider, memories, budget, createDefaultTracking(),
    );
    expect(compactResult.didCompact).toBe(true);
    expect(compactResult.boundary).not.toBeNull();

    // 2. 模拟压缩后的状态
    const state = createQueryLoopState('session-1', 'plan', budget, memories, '请起草通知');
    state.messages = compactResult.messages;
    state.activePlan = plan;
    state.lastCompactBoundaryId = compactResult.boundary?.id ?? null;

    // 3. 恢复
    const recoveryResult = await recoverFromCompact(state, ragProvider);
    expect(recoveryResult.memoryInjected).toBe(true);
    expect(recoveryResult.planInjected).toBe(true);
    // RAG 可能注入也可能不注入（取决于搜索结果）
  });

  it('circuit breaker 防止无限压缩', async () => {
    const budget = createTestBudget(5000);
    const messages = createMessages(Math.floor(budget.total * 0.9), 500);
    const provider = createMockProvider();
    const trippedTracking: AutoCompactTracking = {
      lastCompactedMessageCount: 0,
      compactCount: 5,
      consecutiveFailures: 3,
      circuitBreakerTripped: true,
    };

    const result = await autoCompactIfNeeded(
      messages, provider, [], budget, trippedTracking,
    );

    expect(result.didCompact).toBe(false);
    expect(result.freedTokens).toBe(0);
  });

  it('全流程 state 不可变更新', async () => {
    const budget = createTestBudget(5000);
    const messages = createMessages(Math.floor(budget.total * 0.9), 500);
    const provider = createMockProvider();
    const memories = createMemories();
    const plan = createActivePlan();
    const ragProvider = createMockRagProvider();

    // 初始状态
    const originalState = createQueryLoopState('session-1', 'plan', budget, memories, '请起草通知');
    originalState.activePlan = plan;
    originalState.messages = messages;
    const originalMessagesRef = originalState.messages;

    // 恢复
    const recoveryResult = await recoverFromCompact(originalState, ragProvider);

    // 原状态不被修改
    expect(originalState.messages).toBe(originalMessagesRef);
    expect(originalState.messages.length).toBe(messages.length);

    // 新状态是新的引用
    expect(recoveryResult.state.messages).not.toBe(originalMessagesRef);
    expect(recoveryResult.state.messages.length).toBeGreaterThan(messages.length);
  });
});
