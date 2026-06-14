/**
 * RAG 注入引用标签测试
 * 验证：
 * 1. 输出包含 [ref_N] 引用标签
 * 2. 每个 chunk 的来源信息正确
 * 3. locator 信息包含在引用中
 * 4. 多个 chunk 的引用序号递增
 */

import { describe, it, expect, vi } from 'vitest';
import { injectRagContext } from '../context/rag-inject.js';
import type { ContextBudget, RetrievedChunk } from '@workagent/shared';
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
function createMockSearchProvider(chunks: RetrievedChunk[]): RAGSearchProvider {
  return {
    search: vi.fn().mockResolvedValue(chunks),
  };
}

// ============================================================
// 测试
// ============================================================

describe('RAG 注入引用标签格式', () => {
  it('输出包含 [ref_1] 引用标签', async () => {
    const chunks: RetrievedChunk[] = [
      {
        content: '这是第一段参考内容',
        sourceFile: '报告.docx',
        sourceType: 'docx',
        locator: '段落3',
        score: 0.9,
        chunkId: 'chunk_1',
      },
    ];
    const provider = createMockSearchProvider(chunks);

    const result = await injectRagContext(
      '请检索知识库',
      'chat',
      null,
      provider,
      createTestBudget(),
    );

    expect(result.message).not.toBeNull();
    expect(result.message!.content).toContain('[ref_1]');
    expect(result.message!.content).toContain('报告.docx');
    expect(result.message!.content).toContain('段落3');
  });

  it('多个 chunk 的引用序号递增', async () => {
    const chunks: RetrievedChunk[] = [
      {
        content: '第一段内容',
        sourceFile: 'a.docx',
        sourceType: 'docx',
        locator: '段落1',
        score: 0.9,
        chunkId: 'c1',
      },
      {
        content: '第二段内容',
        sourceFile: 'b.pptx',
        sourceType: 'pptx',
        locator: '幻灯片2',
        score: 0.8,
        chunkId: 'c2',
      },
      {
        content: '第三段内容',
        sourceFile: 'c.pdf',
        sourceType: 'pdf',
        locator: '第5页',
        score: 0.7,
        chunkId: 'c3',
      },
    ];
    const provider = createMockSearchProvider(chunks);

    const result = await injectRagContext(
      '请检索知识库',
      'chat',
      null,
      provider,
      createTestBudget(),
    );

    expect(result.message).not.toBeNull();
    expect(result.message!.content).toContain('[ref_1]');
    expect(result.message!.content).toContain('[ref_2]');
    expect(result.message!.content).toContain('[ref_3]');
  });

  it('locator 为空时不显示括号', async () => {
    const chunks: RetrievedChunk[] = [
      {
        content: '无定位信息的内容',
        sourceFile: 'no-loc.docx',
        sourceType: 'docx',
        locator: '',
        score: 0.9,
        chunkId: 'c1',
      },
    ];
    const provider = createMockSearchProvider(chunks);

    const result = await injectRagContext(
      '请检索知识库',
      'chat',
      null,
      provider,
      createTestBudget(),
    );

    expect(result.message).not.toBeNull();
    // locator 为空，不应出现 " ()"
    expect(result.message!.content).toContain('no-loc.docx');
    expect(result.message!.content).not.toContain('no-loc.docx ()');
  });

  it('消息角色为 system', async () => {
    const chunks: RetrievedChunk[] = [
      {
        content: '测试内容',
        sourceFile: 'test.docx',
        sourceType: 'docx',
        locator: '段落1',
        score: 0.9,
        chunkId: 'c1',
      },
    ];
    const provider = createMockSearchProvider(chunks);

    const result = await injectRagContext(
      '请检索知识库',
      'chat',
      null,
      provider,
      createTestBudget(),
    );

    expect(result.message).not.toBeNull();
    expect(result.message!.role).toBe('system');
  });

  it('消息包含引用说明', async () => {
    const chunks: RetrievedChunk[] = [
      {
        content: '测试内容',
        sourceFile: 'test.docx',
        sourceType: 'docx',
        locator: '段落1',
        score: 0.9,
        chunkId: 'c1',
      },
    ];
    const provider = createMockSearchProvider(chunks);

    const result = await injectRagContext(
      '请检索知识库',
      'chat',
      null,
      provider,
      createTestBudget(),
    );

    expect(result.message).not.toBeNull();
    // 应包含引用说明文字
    expect(result.message!.content).toContain('参考资料');
    expect(result.message!.content).toContain('[ref_N]');
  });
});
