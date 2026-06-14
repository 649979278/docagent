/**
 * Compact boundary 记录测试
 * 验证：
 * 1. compactContext 返回的 boundary 包含正确的 messageCountBefore/After
 * 2. boundary 的 strategy 与 CompactResult.strategy 一致
 * 3. boundary.id 格式正确
 * 4. boundary.freedTokens 与 CompactResult.freedTokens 一致
 * 5. 无压缩时 boundary 为 null
 */

import { describe, it, expect, vi } from 'vitest';
import { compactContext, reactiveCompact } from '../context/compact.js';
import type { Message, Memory, ContextBudget } from '@workagent/shared';
import type { ModelProvider } from '@workagent/model-provider';

// ============================================================
// Mock 工具函数
// ============================================================

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

/** 创建 mock 模型提供者 */
function createMockProvider(): ModelProvider {
  return {
    chat: vi.fn().mockImplementation(async function* () {
      yield { type: 'token', data: '压缩摘要内容' };
      yield { type: 'done' };
    }),
  } as unknown as ModelProvider;
}

/** 创建大消息列表（触发压缩阈值） */
function createLargeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `这是第${i}条消息，内容足够长以消耗token。${'填充文本'.repeat(20)}`,
    tokenCount: 500,
    timestamp: Date.now() - (count - i) * 1000,
  }));
}

/** 创建工具调用消息 */
function createToolMessages(): Message[] {
  return [
    { id: 'user-1', role: 'user', content: '请帮我检索资料', tokenCount: 200, timestamp: Date.now() },
    { id: 'asst-1', role: 'assistant', content: '', tokenCount: 50, toolCalls: [{ id: 'call-1', name: 'rag_search', arguments: { query: '测试' } }], timestamp: Date.now() },
    { id: 'tool-1', role: 'tool', content: '检索结果内容'.repeat(50), tokenCount: 300, toolCallId: 'call-1', toolName: 'rag_search', timestamp: Date.now() },
    { id: 'asst-2', role: 'assistant', content: '根据检索结果分析', tokenCount: 200, timestamp: Date.now() },
  ];
}

// ============================================================
// 测试
// ============================================================

describe('Compact boundary 记录', () => {
  it('compactContext 返回的 boundary 包含正确的 messageCountBefore/After', async () => {
    const messages = createLargeMessages(30);
    const provider = createMockProvider();
    const budget = createTestBudget({ total: 5000 });

    const result = await compactContext(messages, provider, [], budget, 2);

    expect(result.boundary).not.toBeNull();
    expect(result.boundary!.messageCountBefore).toBe(30);
    expect(result.boundary!.messageCountAfter).toBe(result.messages.length);
  });

  it('boundary 的 strategy 与 CompactResult.strategy 一致', async () => {
    const messages = createLargeMessages(30);
    const provider = createMockProvider();
    const budget = createTestBudget({ total: 5000 });

    const result = await compactContext(messages, provider, [], budget, 2);

    expect(result.boundary).not.toBeNull();
    expect(result.boundary!.strategy).toBe(result.strategy);
  });

  it('boundary.id 包含策略名称', async () => {
    const messages = createLargeMessages(30);
    const provider = createMockProvider();
    const budget = createTestBudget({ total: 5000 });

    const result = await compactContext(messages, provider, [], budget, 2);

    expect(result.boundary).not.toBeNull();
    expect(result.boundary!.id).toContain('compact-');
    expect(result.boundary!.id).toContain(result.strategy);
  });

  it('boundary.freedTokens 与 CompactResult.freedTokens 一致', async () => {
    const messages = createLargeMessages(30);
    const provider = createMockProvider();
    const budget = createTestBudget({ total: 5000 });

    const result = await compactContext(messages, provider, [], budget, 2);

    expect(result.boundary).not.toBeNull();
    expect(result.boundary!.freedTokens).toBe(result.freedTokens);
  });

  it('无压缩时 boundary 为 null', async () => {
    const messages: Message[] = [
      { id: 'msg-1', role: 'user', content: '简短消息', tokenCount: 50, timestamp: Date.now() },
      { id: 'msg-2', role: 'assistant', content: '简短回复', tokenCount: 50, timestamp: Date.now() },
    ];
    const provider = createMockProvider();
    const budget = createTestBudget();

    const result = await compactContext(messages, provider, [], budget);

    expect(result.boundary).toBeNull();
    expect(result.freedTokens).toBe(0);
  });

  it('reactiveCompact 的 boundary strategy 为 reactive', async () => {
    const messages = createLargeMessages(30);
    const provider = createMockProvider();

    const result = await reactiveCompact(messages, provider, []);

    expect(result.boundary).not.toBeNull();
    expect(result.boundary!.strategy).toBe('reactive');
    expect(result.strategy).toBe('reactive');
  });

  it('boundary 包含有效的 timestamp', async () => {
    const messages = createLargeMessages(30);
    const provider = createMockProvider();
    const budget = createTestBudget({ total: 5000 });

    const before = Date.now();
    const result = await compactContext(messages, provider, [], budget, 2);
    const after = Date.now();

    expect(result.boundary).not.toBeNull();
    expect(result.boundary!.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.boundary!.timestamp).toBeLessThanOrEqual(after);
  });
});
