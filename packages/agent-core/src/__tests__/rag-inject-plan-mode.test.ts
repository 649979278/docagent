/**
 * RAG 注入 plan 模式触发测试
 * 验证：
 * 1. plan 模式 PLAN_RESEARCH 阶段自动触发
 * 2. plan 模式 PLAN_DRAFT 阶段自动触发
 * 3. plan 模式其他阶段不自动触发
 * 4. chat 模式不自动触发
 * 5. chat 模式关键词触发
 * 6. 无 searchProvider 时不触发
 */

import { describe, it, expect, vi } from 'vitest';
import { injectRagContext } from '../context/rag-inject.js';
import type { ContextBudget, RetrievedChunk, PlanPhase } from '@workagent/shared';
import type { RAGSearchProvider } from '@workagent/tools';

// ============================================================
// Mock 工具函数
// ============================================================

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

/** 创建 mock RAG 搜索提供者 */
function createMockSearchProvider(): RAGSearchProvider {
  return {
    search: vi.fn().mockResolvedValue([
      {
        content: '测试内容',
        sourceFile: 'test.docx',
        sourceType: 'docx',
        locator: '段落1',
        score: 0.9,
        chunkId: 'chunk_1',
      } as RetrievedChunk,
    ]),
  };
}

// ============================================================
// 测试
// ============================================================

describe('RAG 注入 plan 模式触发', () => {
  it('plan 模式 PLAN_RESEARCH 阶段自动触发', async () => {
    const provider = createMockSearchProvider();
    const result = await injectRagContext(
      '分析需求',
      'plan',
      'PLAN_RESEARCH' as PlanPhase,
      provider,
      createTestBudget(),
    );

    expect(result.triggered).toBe(true);
    expect(result.triggerReason).toBe('always_in_plan');
  });

  it('plan 模式 PLAN_DRAFT 阶段自动触发', async () => {
    const provider = createMockSearchProvider();
    const result = await injectRagContext(
      '生成提纲',
      'plan',
      'PLAN_DRAFT' as PlanPhase,
      provider,
      createTestBudget(),
    );

    expect(result.triggered).toBe(true);
    expect(result.triggerReason).toBe('always_in_plan');
  });

  it('plan 模式其他阶段不自动触发（无关键词时）', async () => {
    const provider = createMockSearchProvider();
    const result = await injectRagContext(
      '执行步骤',
      'plan',
      'EXECUTE_DRAFT' as PlanPhase,
      provider,
      createTestBudget(),
    );

    expect(result.triggered).toBe(false);
    expect(result.triggerReason).toBe('none');
  });

  it('chat 模式不自动触发（无关键词时）', async () => {
    const provider = createMockSearchProvider();
    const result = await injectRagContext(
      '你好',
      'chat',
      null,
      provider,
      createTestBudget(),
    );

    expect(result.triggered).toBe(false);
    expect(result.triggerReason).toBe('none');
  });

  it('chat 模式关键词触发', async () => {
    const provider = createMockSearchProvider();
    const result = await injectRagContext(
      '请检索知识库中的相关资料',
      'chat',
      null,
      provider,
      createTestBudget(),
    );

    expect(result.triggered).toBe(true);
    expect(result.triggerReason).toBe('keyword');
  });

  it('无 searchProvider 时不触发', async () => {
    const result = await injectRagContext(
      '请检索知识库',
      'chat',
      null,
      undefined,
      createTestBudget(),
    );

    expect(result.triggered).toBe(false);
    expect(result.message).toBeNull();
  });

  it('plan 模式 EXECUTE_DRAFT 阶段 + 关键词仍可触发', async () => {
    const provider = createMockSearchProvider();
    const result = await injectRagContext(
      '请参考文档执行',
      'plan',
      'EXECUTE_DRAFT' as PlanPhase,
      provider,
      createTestBudget(),
    );

    expect(result.triggered).toBe(true);
    expect(result.triggerReason).toBe('keyword');
  });
});
