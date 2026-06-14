/**
 * 检索引擎
 * 组合KnowledgeIndex、Embedder、可插拔检索组件，提供完整的RAG能力
 * 支持文档索引（分块+向量化+存储+元数据写入）和检索（pipeline检索）
 *
 * 三期重构要点：
 * - 构造函数改为 options object 模式
 * - 支持注入 ChunkMetadataStore（BM25 全文写入）
 * - 支持注入 RetrievalComponents（sparse/rewrite/rerank/grade）
 * - indexDocument 时同步写入 metadataStore
 * - search 时使用 RetrievalPipeline 完整流程
 */

import type { ExtractedDocument, RetrievedChunk, SearchOptions } from '@workagent/shared';

import type { KnowledgeIndex } from './knowledge-index.js';
import { DocumentChunker } from './chunker.js';
import type { DocumentChunk } from './chunker.js';
import { OllamaEmbedder } from './embedder.js';
import type { VectorChunk } from './knowledge-index.js';
import { RetrievalPipeline } from './retrieval-pipeline.js';
import type { RetrievalOutput, RetrievalInput } from './retrieval-pipeline.js';
import type { ChunkMetadataStore, RetrievalComponents } from './components.js';

/**
 * RAG 引擎配置。
 */
export interface RAGEngineOptions {
  /** 向量存储后端 */
  index: KnowledgeIndex;
  /** 嵌入服务 */
  embedder: OllamaEmbedder;
  /** 文档分块器（可选，默认 DocumentChunker） */
  chunker?: DocumentChunker;
  /** 块元数据存储（可选，用于 BM25 检索的全文写入） */
  metadataStore?: ChunkMetadataStore;
  /** 可插拔检索组件（可选，用于 hybrid/rerank/rewrite） */
  components?: RetrievalComponents;
}

/**
 * RAG检索引擎
 * 组合KnowledgeIndex（向量存储）、OllamaEmbedder（向量化）、
 * 可插拔检索组件，提供文档索引和检索的完整流程
 */
export class RAGEngine {
  /** 知识索引（向量存储） */
  private index: KnowledgeIndex;

  /** 向量化器 */
  private embedder: OllamaEmbedder;

  /** 文档分块器 */
  private chunker: DocumentChunker;

  /** 块元数据存储 */
  private metadataStore?: ChunkMetadataStore;

  /** 检索管道 */
  private pipeline: RetrievalPipeline;

  /**
   * 创建RAG检索引擎
   * @param options - 引擎配置选项
   */
  constructor(options: RAGEngineOptions) {
    this.index = options.index;
    this.embedder = options.embedder;
    this.chunker = options.chunker ?? new DocumentChunker();
    this.metadataStore = options.metadataStore;

    // 构建检索管道
    this.pipeline = new RetrievalPipeline(
      this.index,
      this.embedder,
      options.components,
    );
  }

  /**
   * 索引文档：分块 + 向量化 + 存储 + 元数据写入
   * @param document - 提取后的文档
   * @param onProgress - 进度回调（0-100）
   * @param documentId - 文档 ID（可选，用于 metadataStore 关联 chunks 到 documents）
   * @returns 生成的文档块列表
   */
  async indexDocument(
    document: ExtractedDocument,
    onProgress?: (progress: number) => void,
    documentId?: string,
  ): Promise<DocumentChunk[]> {
    // 第1步：分块
    onProgress?.(10);
    const chunks = this.chunker.chunk(document);
    if (chunks.length === 0) {
      return [];
    }

    // 第2步：批量向量化
    onProgress?.(30);
    const texts = chunks.map((c) => c.content);
    const vectors = await this.embedder.embedBatch(texts);

    // 第3步：组装VectorChunk并存储
    onProgress?.(70);
    const vectorChunks: VectorChunk[] = chunks.map((chunk, i) => ({
      chunkId: chunk.chunkId,
      content: chunk.content,
      metadata: chunk.metadata,
      vector: vectors[i],
    }));

    await this.index.upsert(vectorChunks);

    // 第4步：同步写入元数据存储（BM25 全文检索）
    if (this.metadataStore) {
      this.metadataStore.upsertChunkMetadata(
        chunks.map((chunk) => ({
          chunkId: chunk.chunkId,
          sourceFile: document.filePath,
          content: chunk.content,
          documentId,
        })),
      );
    }

    onProgress?.(100);
    return chunks;
  }

  /**
   * 检索相关文档块：通过检索管道完整流程
   * @param query - 查询文本
   * @param options - 搜索选项
   * @returns 检索结果列表，按相似度降序排列
   */
  async search(query: string, options?: SearchOptions): Promise<RetrievedChunk[]> {
    const input: RetrievalInput = { query, options };
    const output: RetrievalOutput = await this.pipeline.retrieve(input);
    return output.rawChunks;
  }

  /**
   * 执行完整的检索管道，返回带引用标签的上下文
   * @param query - 查询文本
   * @param options - 搜索选项
   * @returns 检索管道输出
   */
  async retrieve(query: string, options?: SearchOptions): Promise<RetrievalOutput> {
    const input: RetrievalInput = { query, options };
    return this.pipeline.retrieve(input);
  }

  /**
   * 删除指定文档的所有索引数据
   * 同时清理向量存储和元数据存储
   * @param sourceFile - 来源文件路径
   */
  async removeDocument(sourceFile: string): Promise<void> {
    await this.index.remove(sourceFile);

    // 注意：metadataStore.deleteChunkMetadata 需要 documentId，
    // 但此接口只接收 sourceFile。调用方（如 ipc handler）
    // 需要在调用 removeDocument 前自行清理 chunks 表。
    // 此处不调用 metadataStore.deleteChunkMetadata，
    // 因为 sourceFile 无法直接映射到 documentId。
  }

  /**
   * 获取引擎统计信息
   * @returns 索引统计
   */
  async getStats() {
    return this.index.stats();
  }
}
