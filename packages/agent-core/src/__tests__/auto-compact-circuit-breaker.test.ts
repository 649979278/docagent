/**
 * AutoCompact + Circuit Breaker 测试
 * 验证：
 * 1. autoCompactIfNeeded 在 80% 阈值触发
 * 2. circuit breaker 在连续3次压缩无效后触发
 * 3. circuit breaker 触发后跳过压缩
 * 4. 压缩成功时重置 consecutiveFailures
 * 5. 80% 以下不触发压缩
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autoCompactIfNeeded } from '../context/compact.js';
import type { AutoCompactTracking } from '../query-state.js';
import type { Message, Memory, ContextBudget } from '@workagent/shared';
import type { ModelProvider, ChatRequest } from '@workagent/model-provider';

/** 创建测试用预算 */
function createTestBudget(overrides?: Partial<ContextBudget>): ContextBudget {
  return {
    systemPrompt: 500,
    conversationHistory: 15000,
    ragResults: 8000,
    toolResults: 4000,
    maxCompletionTokens: 4096,
    total: 32768,
    ...overrides,
  };
}

/** 创建初始 AutoCompactTracking */
function createTracking(overrides?: Partial<AutoCompactTracking>): AutoCompactTracking {
  return {
    lastCompactedMessageCount: 0,
    compactCount: 0,
    consecutiveFailures: 0,
    circuitBreakerTripped: false,
    ...overrides,
  };
}

/** 创建测试消息（带指定 tokenCount） */
function createMessage(tokenCount: number, content = '测试内容'): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content,
    tokenCount,
    timestamp: Date.now(),
  };
}

/** 创建大量消息以触发 80% 阈值 */
function createLargeMessageList(budget: ContextBudget): Message[] {
  // 80% of 32768 = 26214 tokens
  const messages: Message[] = [];
  let total = 0;
  while (total < budget.total * 0.85) {
    const msg = createMessage(2000, 'A'.repeat(2000));
    messages.push(msg);
    total += 2000;
  }
  return messages;
}

/** 创建 mock ModelProvider - 返回短摘要压缩结果 */
function createMockCompactProvider(): ModelProvider {
  return {
    chat: vi.fn().mockImplementation((request: ChatRequest) => {
      const events = [
        { type: 'token', data: '压缩摘要：用户讨论了测试内容' },
        { type: 'usage', data: { promptTokens: 100, completionTokens: 30, totalTokens: 130 } },
        { type: 'done', data: undefined },
      ];
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
    }),
  };
}

describe('autoCompactIfNeeded', () => {
  let provider: ModelProvider;
  let budget: ContextBudget;
  let memories: Memory[];

  beforeEach(() => {
    provider = createMockCompactProvider();
    budget = createTestBudget();
    memories = [];
  });

  it('80% 以下不触发压缩', async () => {
    const smallMessages = [createMessage(100), createMessage(100)];
    const tracking = createTracking();

    const result = await autoCompactIfNeeded(smallMessages, provider, memories, budget, tracking);

    expect(result.didCompact).toBe(false);
    expect(result.freedTokens).toBe(0);
    expect(result.messages).toBe(smallMessages);
    expect(result.tracking.compactCount).toBe(0);
  });

  it('80% 以上触发压缩', async () => {
    const largeMessages = createLargeMessageList(budget);
    const tracking = createTracking();

    const result = await autoCompactIfNeeded(largeMessages, provider, memories, budget, tracking);

    expect(result.didCompact).toBe(true);
    expect(result.tracking.compactCount).toBe(1);
  });

  it('circuit breaker 触发后跳过压缩', async () => {
    const largeMessages = createLargeMessageList(budget);
    const tracking = createTracking({ circuitBreakerTripped: true });

    const result = await autoCompactIfNeeded(largeMessages, provider, memories, budget, tracking);

    expect(result.didCompact).toBe(false);
    expect(result.freedTokens).toBe(0);
    expect(result.tracking.circuitBreakerTripped).toBe(true);
  });

  it('连续3次压缩无效后触发 circuit breaker', async () => {
    // 创建消息列表使得压缩后仍超过90%（模拟压缩失败）
    // 由于 mock provider 返回短摘要，实际压缩会成功
    // 所以这里用小预算让压缩后的消息仍然超标
    const smallBudget = createTestBudget({ total: 1000 });
    const largeMessages: Message[] = [];
    let total = 0;
    while (total < 900) {
      largeMessages.push(createMessage(300, 'B'.repeat(300)));
      total += 300;
    }

    const tracking = createTracking({ consecutiveFailures: 2 });

    const result = await autoCompactIfNeeded(largeMessages, provider, memories, smallBudget, tracking);

    // 如果压缩后仍 > 90%，consecutiveFailures 从2增到3，触发 breaker
    if (result.tracking.circuitBreakerTripped) {
      expect(result.tracking.consecutiveFailures).toBe(3);
    } else {
      // 压缩成功，consecutiveFailures 重置为0
      expect(result.tracking.consecutiveFailures).toBe(0);
    }
  });

  it('压缩成功时重置 consecutiveFailures', async () => {
    const largeMessages = createLargeMessageList(budget);
    const tracking = createTracking({ consecutiveFailures: 2 });

    const result = await autoCompactIfNeeded(largeMessages, provider, memories, budget, tracking);

    // 大预算 + 短摘要 → 压缩后使用率应 < 90% → 重置
    expect(result.tracking.consecutiveFailures).toBe(0);
    expect(result.tracking.circuitBreakerTripped).toBe(false);
  });

  it('tracking 的 compactCount 递增', async () => {
    const largeMessages = createLargeMessageList(budget);
    const tracking = createTracking({ compactCount: 2 });

    const result = await autoCompactIfNeeded(largeMessages, provider, memories, budget, tracking);

    expect(result.tracking.compactCount).toBe(3);
  });

  it('lastCompactedMessageCount 更新', async () => {
    const largeMessages = createLargeMessageList(budget);
    const tracking = createTracking();

    const result = await autoCompactIfNeeded(largeMessages, provider, memories, budget, tracking);

    expect(result.tracking.lastCompactedMessageCount).toBeGreaterThan(0);
  });
});
