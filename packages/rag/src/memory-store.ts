/**
 * 内存向量存储（一期替代LanceDB）
 * 使用内存数组存储向量，余弦相似度进行检索
 * 支持持久化到JSON文件，启动时自动加载
 */

import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { RetrievedChunk, SearchOptions } from '@workagent/shared';

import type { KnowledgeIndex, VectorChunk, IndexStats } from './knowledge-index.js';

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const mkdir = promisify(fs.mkdir);

/** 内存中的向量条目 */
interface VectorEntry {
  /** 文档块ID */
  chunkId: string;
  /** 文档块内容 */
  content: string;
  /** 来源文件 */
  sourceFile: string;
  /** 来源类型 */
  sourceType: string;
  /** 定位信息 */
  locator: string;
  /** 向量数据 */
  vector: number[];
}

/**
 * 内存向量存储
 * 一期使用内存数组+余弦相似度实现，替代LanceDB
 * 支持将数据持久化到JSON文件，下次启动时自动加载
 */
export class MemoryVectorStore implements KnowledgeIndex {
  /** 向量条目列表 */
  private entries: VectorEntry[] = [];

  /** 持久化文件路径 */
  private persistencePath: string | null;

  /** 向量维度 */
  private dimensions: number = 0;

  /** 是否已修改（需要持久化） */
  private dirty: boolean = false;

  /**
   * 创建内存向量存储
   * @param persistenceDir - 持久化目录路径，不传则不持久化
   */
  constructor(persistenceDir?: string) {
    this.persistencePath = persistenceDir
      ? path.join(persistenceDir, 'memory-vectors.json')
      : null;
  }

  /**
   * 初始化存储，加载持久化数据
   * 应在创建实例后调用
   */
  async initialize(): Promise<void> {
    if (this.persistencePath) {
      await this.loadFromDisk();
    }
  }

  /**
   * 插入或更新文档块向量
   * 如果chunkId已存在则更新，否则新增
   * @param chunks - 带向量的文档块列表
   */
  async upsert(chunks: VectorChunk[]): Promise<void> {
    for (const chunk of chunks) {
      // 更新向量维度
      if (chunk.vector.length > 0 && this.dimensions === 0) {
        this.dimensions = chunk.vector.length;
      }

      // 检查是否已存在（按chunkId去重）
      const existingIndex = this.entries.findIndex((e) => e.chunkId === chunk.chunkId);
      const entry: VectorEntry = {
        chunkId: chunk.chunkId,
        content: chunk.content,
        sourceFile: chunk.metadata.sourceFile,
        sourceType: chunk.metadata.sourceType,
        locator: chunk.metadata.chunkIndex.toString(),
        vector: chunk.vector,
      };

      if (existingIndex >= 0) {
        this.entries[existingIndex] = entry;
      } else {
        this.entries.push(entry);
      }
    }

    this.dirty = true;

    // 自动持久化
    if (this.persistencePath) {
      await this.saveToDisk();
    }
  }

  /**
   * 向量相似度搜索
   * 使用余弦相似度计算查询向量与所有存储向量的相似度
   * @param queryVector - 查询向量
   * @param options - 搜索选项
   * @returns 按相似度降序排列的检索结果
   */
  async search(queryVector: number[], options?: SearchOptions): Promise<RetrievedChunk[]> {
    const topK = options?.topK ?? 5;
    const minScore = options?.minScore ?? 0.0;

    // 计算所有向量的余弦相似度
    const scored: Array<{ entry: VectorEntry; score: number }> = [];
    for (const entry of this.entries) {
      const score = this.cosineSimilarity(queryVector, entry.vector);
      if (score >= minScore) {
        scored.push({ entry, score });
      }
    }

    // 按分数降序排序，取topK
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, topK);

    return results.map(({ entry, score }) => ({
      content: entry.content,
      sourceFile: entry.sourceFile,
      sourceType: entry.sourceType,
      locator: entry.locator,
      score,
      chunkId: entry.chunkId,
    }));
  }

  /**
   * 删除指定来源文件的所有文档块
   * @param sourceFile - 来源文件路径
   */
  async remove(sourceFile: string): Promise<void> {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.sourceFile !== sourceFile);
    const removed = before - this.entries.length;

    if (removed > 0) {
      this.dirty = true;
      if (this.persistencePath) {
        await this.saveToDisk();
      }
    }
  }

  /**
   * 重建索引（内存实现无需操作）
   */
  async reindex(): Promise<void> {
    // 内存实现不需要重建索引
  }

  /**
   * 根据块ID获取文档块
   * @param chunkId - 文档块ID
   * @returns 检索到的文档块，不存在时返回null
   */
  async getByChunkId(chunkId: string): Promise<RetrievedChunk | null> {
    const entry = this.entries.find((e) => e.chunkId === chunkId);
    if (!entry) {
      return null;
    }

    return {
      content: entry.content,
      sourceFile: entry.sourceFile,
      sourceType: entry.sourceType,
      locator: entry.locator,
      score: 1.0, // 精确匹配给满分
      chunkId: entry.chunkId,
    };
  }

  /**
   * 获取索引统计信息
   * @returns 索引统计数据
   */
  async stats(): Promise<IndexStats> {
    const uniqueSources = new Set(this.entries.map((e) => e.sourceFile));

    return {
      totalChunks: this.entries.length,
      uniqueSources: uniqueSources.size,
      dimensions: this.dimensions,
      backend: 'memory',
    };
  }

  /**
   * 计算两个向量的余弦相似度
   * @param a - 向量A
   * @param b - 向量B
   * @returns 余弦相似度，范围[-1, 1]
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  /**
   * 将向量数据持久化到JSON文件
   */
  private async saveToDisk(): Promise<void> {
    if (!this.persistencePath) {
      return;
    }

    try {
      const dir = path.dirname(this.persistencePath);
      await mkdir(dir, { recursive: true });

      const data = {
        version: 1,
        dimensions: this.dimensions,
        entries: this.entries,
      };

      await writeFile(this.persistencePath, JSON.stringify(data), 'utf-8');
      this.dirty = false;
    } catch {
      // 持久化失败不影响内存操作
    }
  }

  /**
   * 从JSON文件加载持久化的向量数据
   */
  private async loadFromDisk(): Promise<void> {
    if (!this.persistencePath) {
      return;
    }

    try {
      const raw = await readFile(this.persistencePath, 'utf-8');
      const data = JSON.parse(raw);

      if (data.version === 1 && Array.isArray(data.entries)) {
        this.entries = data.entries;
        this.dimensions = data.dimensions ?? 0;
      }
    } catch {
      // 文件不存在或格式错误，使用空数据
      this.entries = [];
    }
  }
}
