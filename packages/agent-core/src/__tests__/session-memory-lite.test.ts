/**
 * Session Memory Lite 测试
 * 验证：
 * 1. 每 5 轮触发摘要
 * 2. token 增量达 4000 触发摘要
 * 3. 未达阈值时不触发
 * 4. summarize 生成摘要
 * 5. getSummary 返回摘要
 * 6. formatSummaryForInjection 格式化
 * 7. updateBaseline 更新基准
 */

import { describe, it, expect, vi } from 'vitest';
import { SessionMemoryLite } from '../context/session-memory.js';
import type { Message } from '@workagent/shared';
import type { ModelProvider } from '@workagent/model-provider';

// ============================================================
// Mock 工具函数
// ============================================================

/** 创建消息列表 */
function createMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `这是第${i + 1}条消息内容`,
    tokenCount: 100,
    timestamp: Date.now() - (count - i) * 1000,
  }));
}

/** 创建 mock provider */
function createMockProvider(summary: string = '## 用户目标\n起草通知\n## 当前进展\n已读取参考文档'): ModelProvider {
  return {
    chat: vi.fn().mockImplementation(async function* () {
      yield { type: 'token', data: summary };
      yield { type: 'done' };
    }),
  } as unknown as ModelProvider;
}

/** 创建失败 provider */
function createFailingProvider(): ModelProvider {
  return {
    chat: vi.fn().mockImplementation(async function* () {
      throw new Error('模型服务不可用');
    }),
  } as unknown as ModelProvider;
}

// ============================================================
// 测试
// ============================================================

describe('Session Memory Lite', () => {
  it('每 5 轮触发摘要', () => {
    const memory = new SessionMemoryLite(5, 4000);

    expect(memory.shouldSummarize(4, 0)).toBe(false);
    expect(memory.shouldSummarize(5, 0)).toBe(true);
    expect(memory.shouldSummarize(10, 0)).toBe(true);
  });

  it('token 增量达 4000 触发摘要', () => {
    const memory = new SessionMemoryLite(5, 4000);

    expect(memory.shouldSummarize(0, 3000)).toBe(false);
    expect(memory.shouldSummarize(0, 4001)).toBe(true);
  });

  it('未达阈值时不触发', () => {
    const memory = new SessionMemoryLite(5, 4000);

    expect(memory.shouldSummarize(2, 2000)).toBe(false);
    expect(memory.shouldSummarize(3, 1000)).toBe(false);
  });

  it('summarize 生成摘要', async () => {
    const memory = new SessionMemoryLite();
    const messages = createMessages(10);
    const provider = createMockProvider();

    const result = await memory.summarize(messages, provider);

    expect(result).toBeTruthy();
    expect(result).toContain('用户目标');
  });

  it('summarize 失败时返回空字符串或当前摘要', async () => {
    const memory = new SessionMemoryLite();
    const messages = createMessages(10);
    const failingProvider = createFailingProvider();

    const result = await memory.summarize(messages, failingProvider);

    // 失败不应抛出异常
    expect(result).toBe('');
  });

  it('getSummary 返回摘要', async () => {
    const memory = new SessionMemoryLite();
    const messages = createMessages(10);
    const provider = createMockProvider();

    expect(memory.getSummary()).toBeNull();

    await memory.summarize(messages, provider);

    expect(memory.getSummary()).toBeTruthy();
    expect(memory.getSummary()).toContain('用户目标');
  });

  it('formatSummaryForInjection 格式化', async () => {
    const memory = new SessionMemoryLite();
    const messages = createMessages(10);
    const provider = createMockProvider();

    expect(memory.formatSummaryForInjection()).toBeNull();

    await memory.summarize(messages, provider);
    const formatted = memory.formatSummaryForInjection();

    expect(formatted).toBeTruthy();
    expect(formatted).toContain('会话摘要');
  });

  it('updateBaseline 更新基准', () => {
    const memory = new SessionMemoryLite(5, 4000);

    memory.updateBaseline(5, 3000);

    // 更新后，5 轮内不再触发
    expect(memory.shouldSummarize(7, 3000)).toBe(false);
    // 到达 10 轮再次触发
    expect(memory.shouldSummarize(10, 3000)).toBe(true);
  });

  it('getSummaryTokenEstimate 返回估算 token', async () => {
    const memory = new SessionMemoryLite();
    const messages = createMessages(10);
    const provider = createMockProvider();

    expect(memory.getSummaryTokenEstimate()).toBe(0);

    await memory.summarize(messages, provider);

    expect(memory.getSummaryTokenEstimate()).toBeGreaterThan(0);
  });
});
