/**
 * 自动压缩阈值测试
 * 验证：
 * 1. 使用率 ≤ 80% 时不触发自动压缩
 * 2. 使用率 > 80% 时触发自动压缩
 * 3. 压缩后返回 boundary
 * 4. didCompact 正确反映是否执行了压缩
 */

import { describe, it, expect, vi } from 'vitest';
import { autoCompactIfNeeded } from '../context/compact.js';
import type { Message, ContextBudget } from '@workagent/shared';
import type { ModelProvider } from '@workagent/model-provider';
import type { AutoCompactTracking } from '../query-state.js';

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
      yield { type: 'token', data: '压缩摘要' };
      yield { type: 'done' };
    }),
  } as unknown as ModelProvider;
}

function createDefaultTracking(): AutoCompactTracking {
  return {
    lastCompactedMessageCount: 0,
    compactCount: 0,
    consecutiveFailures: 0,
    circuitBreakerTripped: false,
  };
}

/** 创建大消息列表（超过 80% 阈值） */
function createLargeMessages(totalBudget: number, usageRatio: number): Message[] {
  const targetTokens = Math.floor(totalBudget * usageRatio);
  const messages: Message[] = [];
  let accTokens = 0;
  let i = 0;

  while (accTokens < targetTokens) {
    const tokenCount = Math.min(500, targetTokens - accTokens);
    messages.push({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: '填充内容'.repeat(Math.ceil(tokenCount / 3)),
      tokenCount,
      timestamp: Date.now() - i * 1000,
    });
    accTokens += tokenCount;
    i++;
  }

  return messages;
}

// ============================================================
// 测试
// ============================================================

describe('自动压缩阈值', () => {
  it('使用率 ≤ 80% 时不触发自动压缩', async () => {
    const budget = createTestBudget(32768);
    // 创建使用率约 60% 的消息
    const messages = createLargeMessages(32768, 0.6);
    const provider = createMockProvider();

    const result = await autoCompactIfNeeded(
      messages, provider, [], budget, createDefaultTracking(),
    );

    expect(result.didCompact).toBe(false);
    expect(result.freedTokens).toBe(0);
    expect(result.boundary).toBeNull();
    expect(result.messages).toBe(messages); // 同一引用
  });

  it('使用率 > 80% 时触发自动压缩', async () => {
    const budget = createTestBudget(5000);
    // 创建使用率约 90% 的消息
    const messages = createLargeMessages(5000, 0.9);
    const provider = createMockProvider();

    const result = await autoCompactIfNeeded(
      messages, provider, [], budget, createDefaultTracking(),
    );

    expect(result.didCompact).toBe(true);
    expect(result.freedTokens).toBeGreaterThan(0);
  });

  it('压缩后返回 boundary', async () => {
    const budget = createTestBudget(5000);
    const messages = createLargeMessages(5000, 0.9);
    const provider = createMockProvider();

    const result = await autoCompactIfNeeded(
      messages, provider, [], budget, createDefaultTracking(),
    );

    if (result.didCompact) {
      expect(result.boundary).not.toBeNull();
      expect(result.boundary!.messageCountBefore).toBe(messages.length);
    }
  });

  it('didCompact 正确反映是否执行了压缩', async () => {
    const budget = createTestBudget(32768);

    // 低使用率 → 不压缩
    const smallMessages = createLargeMessages(32768, 0.5);
    const provider = createMockProvider();
    const result1 = await autoCompactIfNeeded(
      smallMessages, provider, [], budget, createDefaultTracking(),
    );
    expect(result1.didCompact).toBe(false);

    // 高使用率 → 压缩
    const bigBudget = createTestBudget(5000);
    const bigMessages = createLargeMessages(5000, 0.9);
    const result2 = await autoCompactIfNeeded(
      bigMessages, provider, [], bigBudget, createDefaultTracking(),
    );
    expect(result2.didCompact).toBe(true);
  });

  it('压缩后 tracking.compactCount 递增', async () => {
    const budget = createTestBudget(5000);
    const messages = createLargeMessages(5000, 0.9);
    const provider = createMockProvider();
    const tracking = createDefaultTracking();

    const result = await autoCompactIfNeeded(
      messages, provider, [], budget, tracking,
    );

    if (result.didCompact) {
      expect(result.tracking.compactCount).toBe(tracking.compactCount + 1);
    }
  });
});
