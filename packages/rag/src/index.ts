/**
 * @workagent/rag - RAG引擎模块入口
 * 导出知识索引接口、检索引擎、分块器和向量存储
 */

// 知识索引抽象接口与类型
export type { KnowledgeIndex, VectorChunk, IndexStats } from './knowledge-index.js';

// 检索引擎
export { RAGEngine } from './engine.js';

// 文档分块器
export { DocumentChunker } from './chunker.js';
export type { DocumentChunk } from './chunker.js';

// Embedding封装
export { OllamaEmbedder } from './embedder.js';

// 内存向量存储（轻量方案）
export { MemoryVectorStore } from './memory-store.js';

// LanceDB存储（高性能方案）
export { LanceDBVectorStore } from './lancedb-store.js';
