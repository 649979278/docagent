/**
 * RRF (Reciprocal Rank Fusion) 混合融合
 * 将 dense 和 sparse 两路检索结果融合为统一排序。
 *
 * RRF 公式：score(d) = Σ 1/(k + rank_i(d))
 * - k 为平滑常数，默认 60（原论文推荐值）
 * - rank 从 1 开始
 * - 两路中都出现的 chunk 分数更高
 */

import type { RetrievedChunk } from '@workagent/shared';

/**
 * RRF 融合选项。
 */
export interface RRFFusionOptions {
  /** 平滑常数 k，默认 60 */
  k?: number;
  /** 返回数量上限 */
  topK?: number;
}

/** 默认 RRF 平滑常数 */
const DEFAULT_RRF_K = 60;

/**
 * 使用 RRF (Reciprocal Rank Fusion) 融合多路检索结果。
 * 同时出现在 dense 和 sparse 中的 chunk 会获得更高分数。
 *
 * @param denseChunks - 密集检索（向量）结果。
 * @param sparseChunks - 稀疏检索（BM25）结果。
 * @param options - 融合选项。
 * @returns 融合后的检索结果，按 RRF 分数降序排列。
 */
export function rrfFuse(
  denseChunks: RetrievedChunk[],
  sparseChunks: RetrievedChunk[],
  options?: RRFFusionOptions,
): RetrievedChunk[] {
  const k = options?.k ?? DEFAULT_RRF_K;
  const topK = options?.topK ?? 10;

  const scoreMap = new Map<string, { chunk: RetrievedChunk; score: number }>();

  // Dense 路贡献
  for (let i = 0; i < denseChunks.length; i++) {
    const chunk = denseChunks[i];
    const rrfScore = 1 / (k + (i + 1));
    const existing = scoreMap.get(chunk.chunkId);
    if (existing) {
      existing.score += rrfScore;
      // 保留原始向量分数（用于展示）
    } else {
      scoreMap.set(chunk.chunkId, {
        chunk: { ...chunk, score: rrfScore },
        score: rrfScore,
      });
    }
  }

  // Sparse 路贡献
  for (let i = 0; i < sparseChunks.length; i++) {
    const chunk = sparseChunks[i];
    const rrfScore = 1 / (k + (i + 1));
    const existing = scoreMap.get(chunk.chunkId);
    if (existing) {
      existing.score += rrfScore;
      // 两路都出现，分数叠加
      existing.chunk = { ...existing.chunk, score: existing.score };
    } else {
      scoreMap.set(chunk.chunkId, {
        chunk: { ...chunk, score: rrfScore },
        score: rrfScore,
      });
    }
  }

  // 按 RRF 分数降序排列
  return [...scoreMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((entry) => entry.chunk);
}
