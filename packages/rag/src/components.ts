/**
 * 可插拔检索组件定义
 * 定义检索管道中各阶段的可替换组件接口。
 * RAG 包不硬绑定任何具体实现，调用方通过 options 注入。
 */

import type { RetrievedChunk } from '@workagent/shared';

import type { BM25Search } from './bm25-search.js';
import type { QueryRewriter } from './query-rewriter.js';
import type { Reranker } from './reranker.js';
import type { RelevanceGrader } from './relevance-grader.js';

/**
 * 可插拔检索组件集合。
 * 每个组件都是可选的，缺失时使用内置默认行为。
 */
export interface RetrievalComponents {
  /** 稀疏检索器（BM25/FTS5），缺失时 sparse 阶段返回空结果 */
  sparseSearcher?: BM25Search;

  /** 查询重写器，缺失时使用原始查询 */
  queryRewriter?: QueryRewriter;

  /** 重排器，缺失时直接透传 */
  reranker?: Reranker;

  /** 相关性评分器，缺失时仅按 minScore 过滤 */
  relevanceGrader?: RelevanceGrader;
}

/**
 * 块元数据存储接口。
 * 由调用方注入具体实现，避免 RAG 包硬绑定 @workagent/store。
 * 用于 BM25 检索的全文写入和删除。
 */
export interface ChunkMetadataStore {
  /**
   * 批量写入块元数据（全文 + 来源文件路径）。
   * @param chunks - 块元数据列表。
   */
  upsertChunkMetadata(chunks: Array<{
    /** 块 ID */
    chunkId: string;
    /** 来源文件路径 */
    sourceFile: string;
    /** 块全文内容 */
    content: string;
    /** 文档 ID（可选，由调用方从外部上下文提供） */
    documentId?: string;
  }>): void;

  /**
   * 删除指定文档的所有块元数据。
   * @param documentId - 文档 ID。
   */
  deleteChunkMetadata(documentId: string): void;
}
