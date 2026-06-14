/**
 * RAG 注入测试 - 验证预算感知的 RAG 注入逻辑
 * 验证：
 * 1. 关键词触发
 * 2. plan 模式 PLAN_RESEARCH/PLAN_DRAFT 自动触发
 * 3. 预算截断
 * 4. [ref_N] 引用标签格式
 * 5. 无 searchProvider 时不触发
 * 6. 检索失败时不影响对话
 */

import { describe, it, expect, vi } from 'vitest';
import { injectRagContext } from '../context/rag-inject.js';
import type { ContextBudget, RetrievedChunk, PlanPhase } from '@workagent/shared';
import type { RAGSearchProvider } from '@workagent/tools';

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

/** 创建测试用 RAG chunk */
function createTestChunk(overrides?: Partial<RetrievedChunk>): RetrievedChunk {
  return {
    content: '这是检索到的文档内容片段',
    sourceFile: '测试文档.docx',
    sourceType: 'docx',
    locator: '第1页',
    score: 0.85,
    chunkId: `chunk-${Math.random().toString(36).slice(2, 8)}`,
    ...overrides,
  };
}

/** 创建 mock RAGSearchProvider */
function createMockSearchProvider(chunks: RetrievedChunk[]): RAGSearchProvider {
  return {
    search: vi.fn().mockResolvedValue(chunks),
  };
}

/** 创建会抛错的 mock provider */
function createErrorSearchProvider(): RAGSearchProvider {
  return {
    search: vi.fn().mockRejectedValue(new Error('检索服务不可用')),
  };
}

// ============================================================
// 触发条件测试
// ============================================================

describe('injectRagContext 触发条件', () => {
  it('chat 模式 + 无关键词 → 不触发', async () => {
    const budget = createTestBudget();
    const provider = createMockSearchProvider([createTestChunk()]);

    const result = await injectRagContext('今天天气怎么样', 'chat', null, provider, budget);

    expect(result.triggered).toBe(false);
    expect(result.triggerReason).toBe('none');
    expect(result.message).toBeNull();
  });

  it('chat 模式 + 关键词触发', async () => {
    const budget = createTestBudget();
    const provider = createMockSearchProvider([createTestChunk()]);

    const result = await injectRagContext('请帮我检索相关资料', 'chat', null, provider, budget);

    expect(result.triggered).toBe(true);
    expect(result.triggerReason).toBe('keyword');
    expect(result.message).not.toBeNull();
  });

  it('plan 模式 + PLAN_RESEARCH 自动触发', async () => {
    const budget = createTestBudget();
    const provider = createMockSearchProvider([createTestChunk()]);

    const result = await injectRagContext('继续研究', 'plan', 'PLAN_RESEARCH', provider, budget);

    expect(result.triggered).toBe(true);
    expect(result.triggerReason).toBe('always_in_plan');
  });

  it('plan 模式 + PLAN_DRAFT 自动触发', async () => {
    const budget = createTestBudget();
    const provider = createMockSearchProvider([createTestChunk()]);

    const result = await injectRagContext('继续起草', 'plan', 'PLAN_DRAFT', provider, budget);

    expect(result.triggered).toBe(true);
    expect(result.triggerReason).toBe('always_in_plan');
  });

  it('plan 模式 + PLAN_COLLECT 不自动触发（无关键词）', async () => {
    const budget = createTestBudget();
    const provider = createMockSearchProvider([createTestChunk()]);

    const result = await injectRagContext('继续收集', 'plan', 'PLAN_COLLECT', provider, budget);

    expect(result.triggered).toBe(false);
    expect(result.triggerReason).toBe('none');
  });

  it('无 searchProvider → 不触发', async () => {
    const budget = createTestBudget();

    const result = await injectRagContext('请帮我检索相关资料', 'chat', null, undefined, budget);

    expect(result.triggered).toBe(false);
    expect(result.message).toBeNull();
  });

  it('检索结果为空 → 不注入', async () => {
    const budget = createTestBudget();
    const provider = createMockSearchProvider([]);

    const result = await injectRagContext('请帮我检索相关资料', 'chat', null, provider, budget);

    expect(result.triggered).toBe(true);
    expect(result.message).toBeNull();
    expect(result.injectedChunks).toHaveLength(0);
  });

  it('检索失败 → 不影响对话', async () => {
    const budget = createTestBudget();
    const provider = createErrorSearchProvider();

    const result = await injectRagContext('请帮我检索相关资料', 'chat', null, provider, budget);

    expect(result.triggered).toBe(true);
    expect(result.message).toBeNull();
  });
});

// ============================================================
// 预算感知测试
// ============================================================

describe('injectRagContext 预算感知', () => {
  it('RAG 注入不超过 budget.ragResults', async () => {
    // 设置极小的 RAG 预算
    const budget = createTestBudget({ ragResults: 10 });
    const longChunk = createTestChunk({ content: '这是一段非常长的文档内容'.repeat(20) });
    const provider = createMockSearchProvider([longChunk]);

    const result = await injectRagContext('请帮我检索资料', 'chat', null, provider, budget);

    // 预算太小，可能无法注入任何 chunk
    // usedTokens 不应超过 ragResults
    expect(result.usedTokens).toBeLessThanOrEqual(budget.ragResults);
  });

  it('RAG 注入使用的 token 正确记录', async () => {
    const budget = createTestBudget({ ragResults: 8000 });
    const chunks = [
      createTestChunk({ content: '短内容1' }),
      createTestChunk({ content: '短内容2' }),
    ];
    const provider = createMockSearchProvider(chunks);

    const result = await injectRagContext('请帮我检索资料', 'chat', null, provider, budget);

    expect(result.usedTokens).toBeGreaterThan(0);
    expect(result.injectedChunks.length).toBeGreaterThan(0);
  });

  it('多个 chunk 超预算时截断', async () => {
    const budget = createTestBudget({ ragResults: 30 });
    const chunks = [
      createTestChunk({ content: 'A'.repeat(20) }),
      createTestChunk({ content: 'B'.repeat(20) }),
      createTestChunk({ content: 'C'.repeat(20) }),
      createTestChunk({ content: 'D'.repeat(20) }),
      createTestChunk({ content: 'E'.repeat(20) }),
    ];
    const provider = createMockSearchProvider(chunks);

    const result = await injectRagContext('检索', 'chat', null, provider, budget);

    // 注入的 chunk 数应少于总数
    expect(result.injectedChunks.length).toBeLessThan(5);
    expect(result.usedTokens).toBeLessThanOrEqual(budget.ragResults);
  });
});

// ============================================================
// 引用标签测试
// ============================================================

describe('injectRagContext 引用标签', () => {
  it('输出包含 [ref_N] 引用标签', async () => {
    const budget = createTestBudget();
    const chunks = [
      createTestChunk({ content: '内容1', sourceFile: '文档A.docx', locator: '第1页' }),
      createTestChunk({ content: '内容2', sourceFile: '文档B.pdf', locator: '第3页' }),
    ];
    const provider = createMockSearchProvider(chunks);

    const result = await injectRagContext('检索', 'chat', null, provider, budget);

    expect(result.message).not.toBeNull();
    expect(result.message!.content).toContain('[ref_1]');
    expect(result.message!.content).toContain('[ref_2]');
    expect(result.message!.content).toContain('文档A.docx');
    expect(result.message!.content).toContain('文档B.pdf');
    expect(result.message!.content).toContain('第1页');
    expect(result.message!.content).toContain('第3页');
  });

  it('消息 role 为 system', async () => {
    const budget = createTestBudget();
    const provider = createMockSearchProvider([createTestChunk()]);

    const result = await injectRagContext('检索', 'chat', null, provider, budget);

    expect(result.message!.role).toBe('system');
  });

  it('消息 eventType 为 summary', async () => {
    const budget = createTestBudget();
    const provider = createMockSearchProvider([createTestChunk()]);

    const result = await injectRagContext('检索', 'chat', null, provider, budget);

    expect(result.message!.eventType).toBe('summary');
  });
});
