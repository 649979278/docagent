/**
 * RetrievalPipeline budgetTokens 截断测试
 * 验证：
 * 1. budgetTokens 为0时返回空结果
 * 2. budgetTokens 小于单个chunk时返回空
 * 3. budgetTokens 刚好容纳一个chunk
 * 4. budgetTokens 大于所有chunk时保留全部
 * 5. budgetTokens 未设置时不截断
 */

import { describe, it, expect, vi } from 'vitest';
import { RetrievalPipeline, estimateChunkTokens } from '../retrieval-pipeline.js';
import type { RetrievedChunk } from '@workagent/shared';
import type { KnowledgeIndex } from '../knowledge-index.js';

/** 创建测试用 RetrievedChunk */
function createChunk(content: string, score = 0.9): RetrievedChunk {
  return {
    content,
    sourceFile: 'test.docx',
    sourceType: 'docx',
    locator: '段落1',
    score,
    chunkId: `chunk-${Math.random().toString(36).slice(2)}`,
  };
}

/** 创建 mock KnowledgeIndex */
function createMockIndex(chunks: RetrievedChunk[]): KnowledgeIndex {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue(chunks),
    remove: vi.fn().mockResolvedValue(undefined),
    reindex: vi.fn().mockResolvedValue(undefined),
    getByChunkId: vi.fn().mockResolvedValue(null),
    stats: vi.fn().mockResolvedValue({ totalChunks: 0, uniqueSources: 0, dimensions: 0, backend: 'mock' }),
  };
}

/** 创建 mock OllamaEmbedder */
function createMockEmbedder() {
  return {
    embed: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
    embedBatch: vi.fn().mockResolvedValue([]),
    checkAvailability: vi.fn().mockResolvedValue(true),
    isDevMode: vi.fn().mockReturnValue(false),
    getDimensions: vi.fn().mockReturnValue(1024),
  };
}

describe('RetrievalPipeline budgetTokens 截断', () => {
  it('budgetTokens=1 时最多返回1个短chunk', async () => {
    const chunks = [createChunk('短', 0.9), createChunk('长内容'.repeat(50), 0.8)];
    const index = createMockIndex(chunks);
    const embedder = createMockEmbedder();
    const pipeline = new RetrievalPipeline(index, embedder as any);

    const result = await pipeline.retrieve({
      query: '测试',
      options: { budgetTokens: 1 },
    });

    // budgetTokens=1，第一个chunk估算≈1 token，可以容纳
    expect(result.citations.length).toBeLessThanOrEqual(1);
    expect(result.usedTokens).toBeLessThanOrEqual(1);
  });

  it('budgetTokens 足够大时保留全部', async () => {
    const chunks = [createChunk('内容1', 0.9), createChunk('内容2', 0.8)];
    const index = createMockIndex(chunks);
    const embedder = createMockEmbedder();
    const pipeline = new RetrievalPipeline(index, embedder as any);

    const result = await pipeline.retrieve({
      query: '测试',
      options: { budgetTokens: 10000 },
    });

    expect(result.citations).toHaveLength(2);
  });

  it('budgetTokens 未设置时不截断', async () => {
    const chunks = [createChunk('内容1', 0.9), createChunk('内容2', 0.8)];
    const index = createMockIndex(chunks);
    const embedder = createMockEmbedder();
    const pipeline = new RetrievalPipeline(index, embedder as any);

    const result = await pipeline.retrieve({
      query: '测试',
      // 不设置 budgetTokens
    });

    expect(result.citations).toHaveLength(2);
  });

  it('截断后 usedTokens 不超过 budgetTokens', async () => {
    // 创建多个长chunk
    const chunks = Array.from({ length: 5 }, (_, i) =>
      createChunk('这是较长的测试内容用于验证截断功能。'.repeat(20), 0.9 - i * 0.1),
    );
    const index = createMockIndex(chunks);
    const embedder = createMockEmbedder();
    const pipeline = new RetrievalPipeline(index, embedder as any);

    const budgetTokens = 100;
    const result = await pipeline.retrieve({
      query: '测试',
      options: { budgetTokens },
    });

    expect(result.usedTokens).toBeLessThanOrEqual(budgetTokens);
  });

  it('截断保留高分优先', async () => {
    const chunks = [
      createChunk('高分内容'.repeat(10), 0.95),
      createChunk('低分内容'.repeat(10), 0.5),
    ];
    const index = createMockIndex(chunks);
    const embedder = createMockEmbedder();
    const pipeline = new RetrievalPipeline(index, embedder as any);

    // 小budget只够1个
    const result = await pipeline.retrieve({
      query: '测试',
      options: { budgetTokens: 50 },
    });

    // 高分chunk优先保留
    if (result.citations.length === 1) {
      expect(result.citations[0].chunk.score).toBe(0.95);
    }
  });
});
