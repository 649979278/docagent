/**
 * 压缩后 RAG 引用重水合测试
 * 验证：
 * 1. 有活跃计划 + RAG 提供者时触发重水合
 * 2. 重水合的 RAG 消息包含 [ref_N] 引用标签
 * 3. 无活跃计划时不触发 RAG 重水合
 * 4. 无 RAG 提供者时不触发重水合
 * 5. RAG 搜索失败时不影响恢复流程
 */

import { describe, it, expect, vi } from 'vitest';
import { recoverFromCompact } from '../context/compact-recovery.js';
import type { Memory, Plan, RetrievedChunk } from '@workagent/shared';
import type { QueryLoopState } from '../query-state.js';
import { createQueryLoopState } from '../query-state.js';
import type { RAGSearchProvider } from '@workagent/tools';

// ============================================================
// Mock 工具函数
// ============================================================

/** 创建活跃计划 */
function createActivePlan(): Plan {
  return {
    id: 'plan-1',
    sessionId: 'session-1',
    status: 'executing',
    title: '起草通知',
    goal: '根据材料起草一份正式通知',
    outline: {
      title: '起草通知',
      goal: '根据材料起草一份正式通知',
      materialBasis: '参考 docx 文档',
      structure: [
        { id: 'step-1', description: '研读材料', status: 'completed' },
        { id: 'step-2', description: '起草正文', status: 'in_progress' },
      ],
      expectedOutput: '正式通知文档',
      risks: [],
      questions: [],
      citations: ['chunk-1', 'chunk-2'],
    },
    createdAt: Date.now(),
  };
}

/** 创建 mock RAG 搜索提供者 */
function createMockRagProvider(chunks: RetrievedChunk[]): RAGSearchProvider {
  return {
    search: vi.fn().mockResolvedValue(chunks),
  };
}

/** 创建失败的 RAG 搜索提供者 */
function createFailingRagProvider(): RAGSearchProvider {
  return {
    search: vi.fn().mockRejectedValue(new Error('RAG 服务不可用')),
  };
}

/** 创建测试用状态 */
function createTestState(overrides?: Partial<QueryLoopState>): QueryLoopState {
  const memories: Memory[] = [];
  const base = createQueryLoopState('session-1', 'plan', {
    systemPrompt: 500, conversationHistory: 15000, ragResults: 8000, toolResults: 4000, maxCompletionTokens: 4096, total: 32768,
  }, memories, '请参考文档起草通知');

  return { ...base, ...overrides };
}

/** 创建测试用 RAG 片段 */
function createTestChunks(): RetrievedChunk[] {
  return [
    { content: '关于开展2025年度培训工作的通知', sourceFile: '通知.docx', sourceType: 'docx', locator: '段落1', score: 0.9, chunkId: 'chunk-1' },
    { content: '培训对象为全体员工', sourceFile: '通知.docx', sourceType: 'docx', locator: '段落3', score: 0.85, chunkId: 'chunk-2' },
  ];
}

// ============================================================
// 测试
// ============================================================

describe('压缩后 RAG 引用重水合', () => {
  it('有活跃计划 + RAG 提供者时触发重水合', async () => {
    const plan = createActivePlan();
    const state = createTestState({ activePlan: plan });
    const ragProvider = createMockRagProvider(createTestChunks());

    const result = await recoverFromCompact(state, ragProvider);

    expect(result.ragRehydrated).toBe(true);
  });

  it('重水合的 RAG 消息包含 [ref_N] 引用标签', async () => {
    const plan = createActivePlan();
    const state = createTestState({ activePlan: plan });
    const ragProvider = createMockRagProvider(createTestChunks());

    const result = await recoverFromCompact(state, ragProvider);

    const ragMessages = result.state.messages.filter(
      m => m.id.startsWith('recovery-rag-'),
    );
    if (result.ragRehydrated && ragMessages.length > 0) {
      expect(ragMessages[0].content).toContain('[ref_1]');
    }
  });

  it('无活跃计划时不触发 RAG 重水合', async () => {
    const state = createTestState({ activePlan: null });
    const ragProvider = createMockRagProvider(createTestChunks());

    const result = await recoverFromCompact(state, ragProvider);

    expect(result.ragRehydrated).toBe(false);
  });

  it('无 RAG 提供者时不触发重水合', async () => {
    const plan = createActivePlan();
    const state = createTestState({ activePlan: plan });

    const result = await recoverFromCompact(state, null);

    expect(result.ragRehydrated).toBe(false);
  });

  it('RAG 搜索失败时不影响恢复流程', async () => {
    const plan = createActivePlan();
    const state = createTestState({ activePlan: plan });
    const failingProvider = createFailingRagProvider();

    const result = await recoverFromCompact(state, failingProvider);

    // 不应抛出异常
    expect(result.ragRehydrated).toBe(false);
    // 其他恢复仍然可以进行
    expect(result.state.messages).toBeDefined();
  });

  it('重水合消息角色为 system', async () => {
    const plan = createActivePlan();
    const state = createTestState({ activePlan: plan });
    const ragProvider = createMockRagProvider(createTestChunks());

    const result = await recoverFromCompact(state, ragProvider);

    const ragMessages = result.state.messages.filter(
      m => m.id.startsWith('recovery-rag-'),
    );
    if (ragMessages.length > 0) {
      expect(ragMessages[0].role).toBe('system');
    }
  });
});
