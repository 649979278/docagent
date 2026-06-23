/**
 * @workagent/rag - RAG引擎模块入口
 * 导出知识索引接口、检索引擎、分块器、向量存储、检索管道和可插拔组件
 */

// 知识索引抽象接口与类型
export type { KnowledgeIndex, VectorChunk, IndexStats } from './knowledge-index.js';

// 检索引擎
export { RAGEngine } from './engine.js';
export type { RAGEngineOptions } from './engine.js';

// 文档分块器
export { DocumentChunker } from './chunker.js';
export type { DocumentChunk } from './chunker.js';

// Embedding封装
export { OllamaEmbedder } from './embedder.js';

// 内存向量存储（轻量方案）
export { MemoryVectorStore } from './memory-store.js';

// LanceDB存储（高性能方案）
export { LanceDBVectorStore } from './lancedb-store.js';

// 检索管道
export { RetrievalPipeline, normalizeQuery, packCitations, truncateByBudget, estimateChunkTokens } from './retrieval-pipeline.js';
export type { RetrievalInput, RetrievalOutput, CitatedChunk, StageTiming, RetrievalEventCallback } from './retrieval-pipeline.js';

// 可插拔组件接口
export type { RetrievalComponents } from './components.js';

// BM25 稀疏检索
export { BM25Search } from './bm25-search.js';
export type { BM25SearchOptions } from './bm25-search.js';

// RRF 混合融合
export { rrfFuse } from './hybrid-fusion.js';
export type { RRFFusionOptions } from './hybrid-fusion.js';

// 查询重写器
export { RuleBasedQueryRewriter, OllamaQueryRewriter } from './query-rewriter.js';
export type { QueryRewriter } from './query-rewriter.js';

// 重排器
export { PassThroughReranker, BGEReranker } from './reranker.js';
export type { Reranker } from './reranker.js';

// 相关性评分器
export { ScoreAndKeywordGrader } from './relevance-grader.js';
export type { RelevanceGrader } from './relevance-grader.js';
