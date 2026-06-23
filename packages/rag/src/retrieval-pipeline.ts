/**
 * 检索管道（迭代6新增，三期重构为可插拔组件）
 * 参考 Haystack 的可组合管道模式，实现结构化检索流程
 * 流程: normalize -> rewrite -> dense -> sparse -> fusion -> rerank -> grade
 *       -> truncate -> pack
 *
 * 三期重构要点：
 * - sparse 阶段使用注入的 BM25Search
 * - fusion 阶段使用 RRF 融合替代简单去重
 * - rewrite/rerank/grade 阶段使用可插拔组件
 */

import type { RetrievedChunk, SearchOptions } from '@workagent/shared';
import { countTokens } from '@workagent/shared';

import type { KnowledgeIndex } from './knowledge-index.js';
import type { OllamaEmbedder } from './embedder.js';
import type { RetrievalComponents } from './components.js';
import { rrfFuse } from './hybrid-fusion.js';

// ============================================================
// 类型定义
// ============================================================

/** 检索管道输入 */
export interface RetrievalInput {
  /** 查询文本 */
  query: string;
  /** 搜索选项 */
  options?: SearchOptions;
}

/** 检索管道输出 */
export interface RetrievalOutput {
  /** 带引用标签的上下文文本 */
  context: string;
  /** 引用块列表（带 [ref_N] 标签） */
  citations: CitatedChunk[];
  /** 检索使用的总 token 数估算 */
  usedTokens: number;
  /** 原始检索结果（未截断） */
  rawChunks: RetrievedChunk[];
  /** 管道各阶段耗时（毫秒） */
  stageTimings: StageTiming[];
}

/** 带 [ref_N] 标签的引用块 */
export interface CitatedChunk {
  /** 引用编号（从1开始） */
  refNumber: number;
  /** 引用标签，如 [ref_1] */
  refLabel: string;
  /** 原始检索结果 */
  chunk: RetrievedChunk;
}

/** 管道阶段耗时 */
export interface StageTiming {
  /** 阶段名称 */
  stage: string;
  /** 耗时（毫秒） */
  durationMs: number;
}

/** 检索事件回调 */
export interface RetrievalEventCallback {
  /** 检索开始 */
  onStart?(input: RetrievalInput): void;
  /** 检索完成 */
  onComplete?(output: RetrievalOutput): void;
  /** 检索错误 */
  onError?(error: Error): void;
}

// ============================================================
// 查询预处理
// ============================================================

/**
 * 查询文本归一化
 * 全角字符转半角、去除首尾空白、合并多余空格
 * @param query - 原始查询文本
 * @returns 归一化后的查询文本
 */
export function normalizeQuery(query: string): string {
  let normalized = query.trim();

  // 全角数字和字母转半角
  normalized = normalized.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  normalized = normalized.replace(/[Ａ-Ｚａ-ｚ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );

  // 全角空格转半角
  normalized = normalized.replace(/　/g, ' ');

  // 合并多余空格
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

// ============================================================
// 引用打包
// ============================================================

/**
 * 将检索结果打包为带 [ref_N] 标签的上下文
 * 每个chunk标注引用标签，汇总为可注入的文本
 * @param chunks - 检索结果列表
 * @returns 引用块列表和格式化上下文
 */
export function packCitations(chunks: RetrievedChunk[]): {
  citations: CitatedChunk[];
  context: string;
} {
  const citations: CitatedChunk[] = [];
  const parts: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const refNumber = i + 1;
    const refLabel = `[ref_${refNumber}]`;

    citations.push({ refNumber, refLabel, chunk });
    parts.push(`${refLabel} [${chunk.sourceFile} · ${chunk.locator}]\n${chunk.content}`);
  }

  return {
    citations,
    context: parts.join('\n\n'),
  };
}

// ============================================================
// budgetTokens 截断
// ============================================================

/**
 * 按预算截断引用块
 * 从高到低评分保留，直到总 token 估算不超过预算
 * @param citations - 引用块列表
 * @param budgetTokens - token 预算
 * @returns 截断后的引用块和使用的 token 数
 */
export function truncateByBudget(
  citations: CitatedChunk[],
  budgetTokens: number,
): { citations: CitatedChunk[]; usedTokens: number } {
  let usedTokens = 0;
  const truncated: CitatedChunk[] = [];

  for (const citation of citations) {
    const estimatedTokens = estimateChunkTokens(citation.chunk);
    if (usedTokens + estimatedTokens > budgetTokens) {
      break;
    }
    usedTokens += estimatedTokens;
    truncated.push(citation);
  }

  return { citations: truncated, usedTokens };
}

/**
 * 估算单个chunk的token数
 * 粗略估算：中文1字≈2token，英文1词≈1token，取较大值
 * @param chunk - 检索结果
 * @returns 估算的token数
 */
export function estimateChunkTokens(chunk: RetrievedChunk): number {
  return Math.max(1, countTokens(chunk.content));
}

// ============================================================
// RetrievalPipeline
// ============================================================

/**
 * 检索管道
 * 组合 KnowledgeIndex + OllamaEmbedder + 可插拔组件，提供结构化检索流程
 *
 * 流程：
 * 1. normalize: 全角转半角、去除多余空格
 * 2. rewrite: 查询重写（注入 QueryRewriter，默认直通）
 * 3. dense: 查询向量化并执行密集检索
 * 4. sparse: BM25/FTS5 稀疏检索（注入 BM25Search，默认空结果）
 * 5. fusion: RRF 融合 dense/sparse 结果
 * 6. rerank: 重排（注入 Reranker，默认直通）
 * 7. grade: 相关性评分过滤（注入 RelevanceGrader，默认按 minScore 过滤）
 * 8. truncate: budgetTokens 截断
 * 9. pack: 添加 [ref_N] 引用标签
 */
export class RetrievalPipeline {
  /** 知识索引 */
  private index: KnowledgeIndex;

  /** 向量化器 */
  private embedder: OllamaEmbedder;

  /** 可插拔检索组件 */
  private components: RetrievalComponents;

  /** 召回扩大倍数（默认2x） */
  private recallMultiplier: number;

  /** 事件回调 */
  private eventCallback?: RetrievalEventCallback;

  /**
   * 创建检索管道
   * @param index - 知识索引实例
   * @param embedder - 向量化器实例
   * @param components - 可插拔检索组件（可选）
   * @param options - 管道选项
   */
  constructor(
    index: KnowledgeIndex,
    embedder: OllamaEmbedder,
    components?: RetrievalComponents,
    options?: {
      /** 召回扩大倍数，默认2 */
      recallMultiplier?: number;
      /** 事件回调 */
      eventCallback?: RetrievalEventCallback;
    },
  ) {
    this.index = index;
    this.embedder = embedder;
    this.components = components ?? {};
    this.recallMultiplier = options?.recallMultiplier ?? 2;
    this.eventCallback = options?.eventCallback;
  }

  /**
   * 执行检索管道
   * @param input - 检索输入
   * @returns 检索输出（带引用标签的上下文）
   */
  async retrieve(input: RetrievalInput): Promise<RetrievalOutput> {
    const stageTimings: StageTiming[] = [];
    this.eventCallback?.onStart?.(input);

    try {
      // Stage 1: normalize
      const t0 = Date.now();
      const normalizedQuery = normalizeQuery(input.query);
      stageTimings.push({ stage: 'normalize', durationMs: Date.now() - t0 });

      // Stage 2: rewrite（使用注入的 QueryRewriter，默认直通）
      const t1 = Date.now();
      const rewrittenQuery = this.components.queryRewriter
        ? await this.components.queryRewriter.rewrite(normalizedQuery)
        : normalizedQuery;
      stageTimings.push({ stage: 'rewrite', durationMs: Date.now() - t1 });

      // Stage 3: dense（向量检索）
      const t2 = Date.now();
      const queryVector = await this.embedder.embed(rewrittenQuery);
      const topK = input.options?.topK ?? 5;
      const expandedTopK = topK * this.recallMultiplier;
      const searchOptions: SearchOptions = {
        ...input.options,
        topK: expandedTopK,
        minScore: 0,
      };
      const denseChunks = await this.index.search(queryVector, searchOptions);
      stageTimings.push({ stage: 'dense', durationMs: Date.now() - t2 });

      // Stage 4: sparse（BM25/FTS5 稀疏检索）
      const t3 = Date.now();
      const sparseChunks = this.components.sparseSearcher
        ? await this.components.sparseSearcher.search(rewrittenQuery, { topK: expandedTopK })
        : [] as RetrievedChunk[];
      stageTimings.push({ stage: 'sparse', durationMs: Date.now() - t3 });

      // Stage 5: fusion（RRF 融合）
      const t4 = Date.now();
      const fusedChunks = rrfFuse(denseChunks, sparseChunks, { topK: expandedTopK });
      stageTimings.push({ stage: 'fusion', durationMs: Date.now() - t4 });

      // Stage 6: rerank（使用注入的 Reranker，默认直通）
      const t5 = Date.now();
      const rerankedChunks = this.components.reranker
        ? await this.components.reranker.rerank(fusedChunks, rewrittenQuery)
        : fusedChunks;
      stageTimings.push({ stage: 'rerank', durationMs: Date.now() - t5 });

      // Stage 7: grade（使用注入的 RelevanceGrader，默认按 minScore 过滤）
      const t6 = Date.now();
      const minScore = input.options?.minScore ?? 0;
      const filteredChunks = this.components.relevanceGrader
        ? this.components.relevanceGrader.grade(rerankedChunks, rewrittenQuery, minScore)
        : rerankedChunks.filter((c) => c.score >= minScore);
      stageTimings.push({ stage: 'grade', durationMs: Date.now() - t6 });

      // Stage 8: truncate by budgetTokens
      const t7 = Date.now();
      const budgetTokens = input.options?.budgetTokens;
      let selectedChunks = filteredChunks;
      let usedTokens = filteredChunks.reduce((sum, chunk) => sum + estimateChunkTokens(chunk), 0);

      if (budgetTokens && usedTokens > budgetTokens) {
        const budgetCandidates = [...filteredChunks].sort((a, b) => b.score - a.score);
        const truncated = truncateByBudget(
          budgetCandidates.map((chunk, index) => ({
            refNumber: index + 1,
            refLabel: `[ref_${index + 1}]`,
            chunk,
          })),
          budgetTokens,
        );
        selectedChunks = truncated.citations.map((citation) => citation.chunk);
        usedTokens = truncated.usedTokens;
      }
      stageTimings.push({ stage: 'truncate', durationMs: Date.now() - t7 });

      // Stage 9: pack citations
      const t8 = Date.now();
      const { citations: finalCitations, context: finalContext } = packCitations(selectedChunks);
      stageTimings.push({ stage: 'pack', durationMs: Date.now() - t8 });

      const output: RetrievalOutput = {
        context: finalContext,
        citations: finalCitations,
        usedTokens,
        rawChunks: filteredChunks,
        stageTimings,
      };

      this.eventCallback?.onComplete?.(output);
      return output;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.eventCallback?.onError?.(err);
      throw err;
    }
  }
}
