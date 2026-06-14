/**
 * 检索引擎
 * 组合KnowledgeIndex和Embedder，提供完整的RAG能力
 * 支持文档索引（分块+向量化+存储）和检索（查询向量化+向量搜索）
 */

import type { ExtractedDocument, RetrievedChunk, SearchOptions } from '@workagent/shared';

import type { KnowledgeIndex } from './knowledge-index.js';
import { DocumentChunker } from './chunker.js';
import type { DocumentChunk } from './chunker.js';
import { OllamaEmbedder } from './embedder.js';
import type { VectorChunk } from './knowledge-index.js';

/**
 * RAG检索引擎
 * 组合KnowledgeIndex（向量存储）和OllamaEmbedder（向量化），
 * 提供文档索引和检索的完整流程
 */
export class RAGEngine {
  /** 知识索引（向量存储） */
  private index: KnowledgeIndex;

  /** 向量化器 */
  private embedder: OllamaEmbedder;

  /** 文档分块器 */
  private chunker: DocumentChunker;

  /**
   * 创建RAG检索引擎
   * @param index - 知识索引实例
   * @param embedder - 向量化器实例
   * @param chunker - 文档分块器（可选，使用默认配置）
   */
  constructor(index: KnowledgeIndex, embedder: OllamaEmbedder, chunker?: DocumentChunker) {
    this.index = index;
    this.embedder = embedder;
    this.chunker = chunker ?? new DocumentChunker();
  }

  /**
   * 索引文档：分块 + 向量化 + 存储
   * @param document - 提取后的文档
   * @param onProgress - 进度回调（0-100）
   * @returns 生成的文档块列表
   */
  async indexDocument(
    document: ExtractedDocument,
    onProgress?: (progress: number) => void,
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

    onProgress?.(100);
    return chunks;
  }

  /**
   * 检索相关文档块：查询向量化 + 向量搜索
   * @param query - 查询文本
   * @param options - 搜索选项
   * @returns 检索结果列表，按相似度降序排列
   */
  async search(query: string, options?: SearchOptions): Promise<RetrievedChunk[]> {
    // 查询向量化
    const queryVector = await this.embedder.embed(query);

    // 向量搜索
    const results = await this.index.search(queryVector, options);

    return results;
  }

  /**
   * 删除指定文档的所有索引数据
   * @param sourceFile - 来源文件路径
   */
  async removeDocument(sourceFile: string): Promise<void> {
    await this.index.remove(sourceFile);
  }

  /**
   * 获取引擎统计信息
   * @returns 索引统计
   */
  async getStats() {
    return this.index.stats();
  }
}
