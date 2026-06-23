import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RetrievedChunk } from '@workagent/shared';
import { BGEReranker } from '../reranker.js';

/**
 * 创建测试检索块。
 * @param id - 块 ID。
 * @param score - 初始分数。
 * @returns 检索块。
 */
function chunk(id: string, score: number): RetrievedChunk {
  return {
    chunkId: id,
    content: `内容 ${id}`,
    sourceFile: 'policy.txt',
    sourceType: 'txt',
    locator: '段落1',
    score,
  };
}

describe('BGEReranker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses Ollama /api/rerank results when available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { index: 1, relevance_score: 0.95 },
          { index: 0, relevance_score: 0.4 },
        ],
      }),
    }));

    const reranker = new BGEReranker('http://localhost:11434', 'bge-reranker-v2-m3');
    const result = await reranker.rerank([chunk('a', 0.1), chunk('b', 0.2)], '政策');

    expect(result.map((item) => item.chunkId)).toEqual(['b', 'a']);
    expect(result[0].score).toBe(0.95);
    expect(reranker.getDiagnostics().fallback).toBe(false);
  });

  it('disables after repeated rerank failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const reranker = new BGEReranker('http://localhost:99999', 'missing');
    const input = [chunk('a', 0.1)];
    await reranker.rerank(input, '政策');
    await reranker.rerank(input, '政策');
    await reranker.rerank(input, '政策');

    expect(reranker.isDisabled()).toBe(true);
    expect(reranker.getDiagnostics().fallback).toBe(true);
  });
});
