/**
 * Budget 集成测试 — BudgetManager 与 RAG 注入协同
 * 验证：
 * 1. BudgetManager 与 allocateBudget 默认值一致
 * 2. RAG 注入后 BudgetManager 动态调整
 * 3. 多次预留后 getBudget 正确
 * 4. getRemainingHistoryTokens 返回剩余
 * 5. 全流程：allocateWithPriority 后 RAG 注入不超限
 */

import { describe, it, expect } from 'vitest';
import { BudgetManager, allocateBudget } from '../context/budget.js';
import { injectRagContext } from '../context/rag-inject.js';
import type { RetrievedChunk } from '@workagent/shared';
import type { RAGSearchProvider } from '@workagent/tools';
import { vi } from 'vitest';

// ============================================================
// Mock 工具函数
// ============================================================

/** 创建 mock RAG 搜索提供者 */
function createMockRagProvider(chunks: RetrievedChunk[]): RAGSearchProvider {
  return {
    search: vi.fn().mockResolvedValue(chunks),
  };
}

/** 创建测试用 RAG 片段 */
function createTestChunks(): RetrievedChunk[] {
  return Array.from({ length: 5 }, (_, i) => ({
    content: `测试内容片段${i + 1}，包含一些实际内容用于测试RAG注入的预算控制功能。`.repeat(10),
    sourceFile: `文档${i + 1}.docx`,
    sourceType: 'docx',
    locator: `段落${i + 1}`,
    score: 0.9 - i * 0.1,
    chunkId: `chunk-${i + 1}`,
  }));
}

// ============================================================
// 测试
// ============================================================

describe('Budget 集成测试', () => {
  it('BudgetManager 初始与 allocateBudget 默认值一致', () => {
    const manager = new BudgetManager(32768, 'chat');
    const fromFunction = allocateBudget(32768, 'chat');
    const fromManager = manager.getBudget();

    expect(fromManager.systemPrompt).toBe(fromFunction.systemPrompt);
    expect(fromManager.maxCompletionTokens).toBe(fromFunction.maxCompletionTokens);
    expect(fromManager.total).toBe(fromFunction.total);
  });

  it('RAG 注入后 BudgetManager 动态调整 history', async () => {
    const manager = new BudgetManager(32768, 'chat');
    const initialBudget = manager.getBudget();

    // 模拟 RAG 注入需要 10000 token
    const adjustedBudget = manager.reserveRag(10000);

    expect(adjustedBudget.ragResults).toBe(10000);
    expect(adjustedBudget.conversationHistory).toBeLessThan(initialBudget.conversationHistory);
  });

  it('多次预留后 getBudget 正确', () => {
    const manager = new BudgetManager(32768, 'chat');

    manager.reserveSystem(1500);
    manager.reserveRag(8000);
    manager.reserveToolReplay(5000);

    const budget = manager.getBudget();

    expect(budget.systemPrompt).toBe(1500);
    expect(budget.ragResults).toBe(8000);
    expect(budget.toolResults).toBe(5000);
    expect(budget.conversationHistory).toBeGreaterThanOrEqual(0);
  });

  it('getRemainingHistoryTokens 返回剩余', () => {
    const manager = new BudgetManager(32768, 'chat');
    const initialHistory = manager.getBudget().conversationHistory;

    // 没有使用 history 时剩余等于分配
    expect(manager.getRemainingHistoryTokens()).toBe(initialHistory);
  });

  it('allocateWithPriority 后 RAG 注入不超限', async () => {
    const contextLength = 16384; // 较小上下文
    const manager = new BudgetManager(contextLength, 'chat');

    // 按优先级分配
    const budget = manager.allocateWithPriority(1000, 3000, 2000);

    // 使用 injectRagContext 模拟注入（plan mode 自动触发）
    const ragProvider = createMockRagProvider(createTestChunks());
    const result = await injectRagContext(
      '请参考文档起草通知',
      'plan',
      'PLAN_DRAFT',
      ragProvider,
      budget,
    );

    // RAG 注入不应超过 ragResults 预算
    if (result.usedTokens > 0) {
      expect(result.usedTokens).toBeLessThanOrEqual(budget.ragResults + 500); // 允许少量估算误差
    }
  });
});
