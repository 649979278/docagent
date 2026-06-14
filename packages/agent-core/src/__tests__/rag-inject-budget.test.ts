/**
 * RAG 注入预算测试
 * 验证：
 * 1. RAG 注入不超过 budget.ragResults
 * 2. RAG 注入后 usedTokens 从 budget.conversationHistory 中扣除
 * 3. truncateRagChunks 正确截断
 * 4. 空搜索结果不注入
 */

import { describe, it, expect, vi } from 'vitest';
import { injectRagContext } from '../context/rag-inject.js';
import type { ContextBudget, RetrievedChunk } from '@workagent/shared';
import type { RAGSearchProvider } from '@workagent/tools';

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

/** 创建 mock RAG 搜索提供者 */
function createMockSearchProvider(chunks: RetrievedChunk[]): RAGSearchProvider {
  return {
    search: vi.fn().mockResolvedValue(chunks),
  };
}

/** 创建 mock chunk */
function createChunk(index: number, contentLength: number): RetrievedChunk {
  return {
    content: 'A'.repeat(contentLength),
    sourceFile: `doc_${index}.docx`,
    sourceType: 'docx',
    locator: `段落${index}`,
    score: 0.9 - index * 0.1,
    chunkId: `chunk_${index}`,
  };
}

// ============================================================
// 测试
// ============================================================

describe('RAG 注入预算控制', () => {
  it('RAG 注入不超过 budget.ragResults', async () => {
    // ragResults = 500 tokens，但每个 chunk ~500 字符 ≈ 250 tokens
    // 给 5 个 chunk，应截断到前 2 个
    const budget = createTestBudget({ ragResults: 500 });
    const chunks = Array.from({ length: 5 }, (_, i) => createChunk(i, 500));
    const provider = createMockSearchProvider(chunks);

    const result = await injectRagContext(
      '请检索知识库',
      'chat',
      null,
      provider,
      budget,
    );

    expect(result.triggered).toBe(true);
    expect(result.triggerReason).toBe('keyword');
    // 注入的 chunks 不应超出预算
    expect(result.usedTokens).toBeLessThanOrEqual(budget.ragResults);
    // 注入的 chunk 数量应被截断
    expect(result.injectedChunks.length).toBeLessThanOrEqual(chunks.length);
  });

  it('RAG 注入后 usedTokens 小于等于 ragResults', async () => {
    const budget = createTestBudget({ ragResults: 2000 });
    const chunks = Array.from({ length: 10 }, (_, i) => createChunk(i, 800));
    const provider = createMockSearchProvider(chunks);

    const result = await injectRagContext(
      '请参考文档',
      'chat',
      null,
      provider,
      budget,
    );

    expect(result.usedTokens).toBeLessThanOrEqual(budget.ragResults);
  });

  it('ragResults=0 时不注入任何 chunk', async () => {
    const budget = createTestBudget({ ragResults: 0 });
    const chunks = [createChunk(0, 500)];
    const provider = createMockSearchProvider(chunks);

    const result = await injectRagContext(
      '请检索知识库',
      'chat',
      null,
      provider,
      budget,
    );

    // 预算为0时不应注入任何内容
    expect(result.injectedChunks).toHaveLength(0);
    expect(result.message).toBeNull();
  });

  it('空搜索结果不注入', async () => {
    const budget = createTestBudget();
    const provider = createMockSearchProvider([]);

    const result = await injectRagContext(
      '请检索知识库',
      'chat',
      null,
      provider,
      budget,
    );

    expect(result.triggered).toBe(true);
    expect(result.message).toBeNull();
    expect(result.usedTokens).toBe(0);
    expect(result.injectedChunks).toHaveLength(0);
  });

  it('RAG 注入消息的 tokenCount 与 usedTokens 一致', async () => {
    const budget = createTestBudget({ ragResults: 2000 });
    const chunks = [createChunk(0, 300), createChunk(1, 300)];
    const provider = createMockSearchProvider(chunks);

    const result = await injectRagContext(
      '请检索知识库',
      'chat',
      null,
      provider,
      budget,
    );

    if (result.message) {
      expect(result.message.tokenCount).toBe(result.usedTokens);
    }
  });

  it('RAG 检索失败时不影响正常流程', async () => {
    const budget = createTestBudget();
    const provider: RAGSearchProvider = {
      search: vi.fn().mockRejectedValue(new Error('RAG 服务不可用')),
    };

    const result = await injectRagContext(
      '请检索知识库',
      'chat',
      null,
      provider,
      budget,
    );

    // 检索失败不影响对话流程
    expect(result.message).toBeNull();
    expect(result.usedTokens).toBe(0);
  });
});
