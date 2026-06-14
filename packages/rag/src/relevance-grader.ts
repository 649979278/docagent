/**
 * 相关性评分器
 * 对检索结果进行最终质量评估，过滤低质量结果。
 *
 * 当前实现：
 * - ScoreAndKeywordGrader: 基于 score + 关键词匹配的综合评分
 */

import type { RetrievedChunk } from '@workagent/shared';

/**
 * 相关性评分器接口。
 * 所有评分器必须实现此接口。
 */
export interface RelevanceGrader {
  /**
   * 对检索结果进行评分和过滤。
   * @param chunks - 待评分的检索结果。
   * @param query - 原始查询文本。
   * @param minScore - 最低分数阈值。
   * @returns 通过评分的检索结果。
   */
  grade(chunks: RetrievedChunk[], query: string, minScore: number): RetrievedChunk[];
}

/**
 * 基于 score + 关键词匹配的综合评分器。
 *
 * 评分逻辑：
 * 1. 低于 minScore 的直接过滤
 * 2. 查询关键词在 content 中出现时 boost 分数
 * 3. RRF 分数通常较低（1/61~2/61），所以 minScore 需要配合使用
 */
export class ScoreAndKeywordGrader implements RelevanceGrader {
  /**
   * 对检索结果进行评分和过滤。
   * @param chunks - 待评分的检索结果。
   * @param query - 原始查询文本。
   * @param minScore - 最低分数阈值。
   * @returns 通过评分的检索结果。
   */
  grade(chunks: RetrievedChunk[], query: string, minScore: number): RetrievedChunk[] {
    const queryTerms = this.extractTerms(query);

    return chunks
      .map((chunk) => {
        // 关键词匹配加分
        const keywordBoost = this.calculateKeywordBoost(chunk, queryTerms);
        const finalScore = chunk.score + keywordBoost;

        return {
          ...chunk,
          score: Math.min(finalScore, 1.0), // 上限 1.0
        };
      })
      .filter((chunk) => chunk.score >= minScore);
  }

  /**
   * 从查询文本中提取关键词。
   * @param query - 查询文本。
   * @returns 关键词列表。
   */
  private extractTerms(query: string): string[] {
    return query
      .split(/[\s,，。、；：！？]+/)
      .filter((t) => t.length >= 2); // 只保留 2 字以上的词
  }

  /**
   * 计算关键词匹配加分。
   * 每个匹配的关键词加 0.05 分，最多 0.2 分。
   * @param chunk - 检索结果。
   * @param queryTerms - 查询关键词。
   * @returns 加分值。
   */
  private calculateKeywordBoost(chunk: RetrievedChunk, queryTerms: string[]): number {
    if (queryTerms.length === 0) return 0;

    const contentLower = chunk.content.toLowerCase();
    let matchCount = 0;

    for (const term of queryTerms) {
      if (contentLower.includes(term.toLowerCase())) {
        matchCount++;
      }
    }

    // 每个匹配加 0.05，最多 0.2
    const boost = matchCount * 0.05;
    return Math.min(boost, 0.2);
  }
}
