/**
 * 知识索引抽象接口
 * 定义向量存储的统一操作契约，支持不同后端实现
 */

import type { RetrievedChunk, SearchOptions, ChunkMetadata } from '@workagent/shared';

/**
 * 带向量的文档块
 * 用于upsert操作，包含内容、元数据和对应的向量
 */
export interface VectorChunk {
  /** 文档块ID */
  chunkId: string;
  /** 文档块内容 */
  content: string;
  /** 块元数据 */
  metadata: ChunkMetadata;
  /** 向量表示 */
  vector: number[];
}

/**
 * 索引统计信息
 */
export interface IndexStats {
  /** 总文档块数 */
  totalChunks: number;
  /** 唯一来源文件数 */
  uniqueSources: number;
  /** 向量维度 */
  dimensions: number;
  /** 存储后端类型 */
  backend: string;
}

/**
 * 知识索引抽象接口
 * 定义向量存储的核心操作：插入、搜索、删除、统计
 * 不同存储后端（内存/LanceDB）实现此接口
 */
export interface KnowledgeIndex {
  /**
   * 插入或更新文档块向量
   * @param chunks - 带向量的文档块列表
   */
  upsert(chunks: VectorChunk[]): Promise<void>;

  /**
   * 向量相似度搜索
   * @param queryVector - 查询向量
   * @param options - 搜索选项（topK、最低分数等）
   * @returns 检索到的文档块列表，按相似度降序排列
   */
  search(queryVector: number[], options?: SearchOptions): Promise<RetrievedChunk[]>;

  /**
   * 删除指定文档的所有块
   * @param sourceFile - 来源文件路径
   */
  remove(sourceFile: string): Promise<void>;

  /**
   * 重建索引（全量重新加载）
   */
  reindex(): Promise<void>;

  /**
   * 根据块ID获取文档块
   * @param chunkId - 文档块ID
   * @returns 文档块，不存在时返回null
   */
  getByChunkId(chunkId: string): Promise<RetrievedChunk | null>;

  /**
   * 获取索引统计信息
   * @returns 索引统计数据
   */
  stats(): Promise<IndexStats>;
}
