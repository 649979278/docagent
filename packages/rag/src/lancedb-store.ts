/**
 * LanceDB向量存储实现
 * 使用@lancedb/lancedb Node SDK提供高性能的嵌入式向量存储和检索
 * 支持自动创建索引、批量插入/更新、向量搜索、条件删除
 * 数据持久化在本地LanceDB目录中，支持跨进程共享
 */

import * as lancedb from '@lancedb/lancedb';

import type { RetrievedChunk, SearchOptions } from '@workagent/shared';

import type { KnowledgeIndex, VectorChunk, IndexStats } from './knowledge-index.js';

/** LanceDB中存储的记录结构 */
interface LanceRecord {
  /** 文档块ID（主键） */
  chunkId: string;
  /** 文档块内容 */
  content: string;
  /** 来源文件路径 */
  sourceFile: string;
  /** 来源类型（docx/pptx/pdf/txt/md） */
  sourceType: string;
  /** 定位信息（页码/幻灯片/段落索引） */
  locator: string;
  /** 向量数据 */
  vector: number[];
}

/** 索引创建阈值：当记录数超过此值时自动创建IVF_PQ索引加速查询 */
const INDEX_CREATION_THRESHOLD = 256;

/**
 * LanceDB向量存储
 * 使用LanceDB嵌入式数据库实现KnowledgeIndex接口
 *
 * 特性：
 * - 数据持久化到本地LanceDB目录
 * - 自动创建IVF_PQ向量索引（记录数超过阈值后）
 * - 支持mergeInsert实现upsert语义
 * - 支持条件删除（按sourceFile）
 * - 支持向量搜索和精确查询
 */
export class LanceDBVectorStore implements KnowledgeIndex {
  /** LanceDB连接实例 */
  private db: lancedb.Connection | null = null;

  /** LanceDB表实例 */
  private table: lancedb.Table | null = null;

  /** 数据库存储目录 */
  private dbPath: string;

  /** 表名 */
  private tableName: string;

  /** 向量维度（从第一条插入数据推断） */
  private dimensions: number = 0;

  /** 索引是否已创建 */
  private indexCreated: boolean = false;

  /**
   * 创建LanceDB向量存储
   * @param dbPath - LanceDB数据目录路径（如 ~/WorkAgent/vectors）
   * @param tableName - 表名（默认 'knowledge_chunks'）
   */
  constructor(dbPath: string, tableName: string = 'knowledge_chunks') {
    this.dbPath = dbPath;
    this.tableName = tableName;
  }

  /**
   * 初始化LanceDB连接和表
   * 必须在使用其他方法前调用
   */
  async initialize(): Promise<void> {
    // 连接到LanceDB（目录不存在会自动创建）
    this.db = await lancedb.connect(this.dbPath);

    // 尝试打开已有表
    const existingTables = await this.db.tableNames();
    if (existingTables.includes(this.tableName)) {
      this.table = await this.db.openTable(this.tableName);
      // 从已有数据推断维度
      const count = await this.table.countRows();
      if (count > 0) {
        const sample = await this.table.query().limit(1).toArray();
        if (sample.length > 0 && Array.isArray((sample[0] as Record<string, unknown>).vector)) {
          this.dimensions = ((sample[0] as Record<string, unknown>).vector as number[]).length;
        }
      }
    }
  }

  /**
   * 插入或更新文档块向量
   * 使用mergeInsert实现upsert语义：已存在的chunkId更新，不存在则新增
   * 如果表尚未创建，则自动创建表并写入初始数据
   * @param chunks - 带向量的文档块列表
   */
  async upsert(chunks: VectorChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    // 更新向量维度
    if (this.dimensions === 0 && chunks[0].vector.length > 0) {
      this.dimensions = chunks[0].vector.length;
    }

    // 转换为LanceDB记录格式
    const records: LanceRecord[] = chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      content: chunk.content,
      sourceFile: chunk.metadata.sourceFile,
      sourceType: chunk.metadata.sourceType,
      locator: String(chunk.metadata.chunkIndex),
      vector: chunk.vector,
    }));

    const table = await this.ensureTable();

    if (!table) {
      // 表尚未创建，用第一批数据创建表
      const allRecords = [...this.pendingRecords, ...records];
      this.pendingRecords = [];
      await this.createTableWithData(allRecords);
    } else {
      // 使用mergeInsert实现upsert语义：按chunkId匹配，存在则更新，不存在则插入
      await table.mergeInsert('chunkId')
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute(records as unknown as Record<string, unknown>[]);
    }

    // 检查是否需要创建索引
    await this.maybeCreateIndex();
  }

  /**
   * 向量相似度搜索
   * 使用LanceDB的vectorSearch进行近似最近邻搜索
   * @param queryVector - 查询向量
   * @param options - 搜索选项（topK、最低分数等）
   * @returns 按相似度降序排列的检索结果
   */
  async search(queryVector: number[], options?: SearchOptions): Promise<RetrievedChunk[]> {
    const table = await this.ensureTable();
    if (!table) return [];

    const topK = options?.topK ?? 5;

    // 确保索引已创建以获得更好的查询性能
    await this.maybeCreateIndex();

    // 执行向量搜索
    const query = table.vectorSearch(queryVector).limit(topK);

    // 应用最低分数过滤（LanceDB返回的是距离，需要转换）
    const rawResults = await query.toArray();

    // 转换结果格式并计算相似度分数
    const results: RetrievedChunk[] = rawResults.map((row: Record<string, unknown>) => ({
      content: row.content as string,
      sourceFile: row.sourceFile as string,
      sourceType: row.sourceType as string,
      locator: row.locator as string,
      // LanceDB返回_distance字段，转换为0-1的相似度分数
      score: this.distanceToScore(row._distance as number),
      chunkId: row.chunkId as string,
    }));

    // 应用最低分数过滤
    const minScore = options?.minScore ?? 0.0;
    return results.filter((r) => r.score >= minScore);
  }

  /**
   * 删除指定来源文件的所有文档块
   * @param sourceFile - 来源文件路径
   */
  async remove(sourceFile: string): Promise<void> {
    const table = await this.ensureTable();
    if (!table) return;
    await table.delete(`sourceFile = '${this.escapeSql(sourceFile)}'`);
  }

  /**
   * 重建索引
   * 删除并重新创建IVF_PQ索引，用于数据大量变更后优化查询性能
   */
  async reindex(): Promise<void> {
    const table = await this.ensureTable();
    if (!table) return;

    this.indexCreated = false;

    const count = await table.countRows();
    if (count >= INDEX_CREATION_THRESHOLD) {
      await table.createIndex('vector', {
        config: lancedb.Index.ivfPq({
          numPartitions: Math.min(256, Math.max(16, Math.floor(count / 100))),
          numSubVectors: 16,
        }),
      });
      this.indexCreated = true;
    }
  }

  /**
   * 根据块ID获取文档块
   * @param chunkId - 文档块ID
   * @returns 检索到的文档块，不存在时返回null
   */
  async getByChunkId(chunkId: string): Promise<RetrievedChunk | null> {
    const table = await this.ensureTable();
    if (!table) return null;

    const results = await table.query()
      .where(`chunkId = '${this.escapeSql(chunkId)}'`)
      .limit(1)
      .toArray();

    if (results.length === 0) {
      return null;
    }

    const row = results[0] as Record<string, unknown>;
    return {
      content: row.content as string,
      sourceFile: row.sourceFile as string,
      sourceType: row.sourceType as string,
      locator: row.locator as string,
      score: 1.0, // 精确匹配给满分
      chunkId: row.chunkId as string,
    };
  }

  /**
   * 获取索引统计信息
   * @returns 索引统计数据
   */
  async stats(): Promise<IndexStats> {
    const table = await this.ensureTable();
    if (!table) {
      return { totalChunks: 0, uniqueSources: 0, dimensions: 0, backend: 'lancedb' };
    }

    const totalChunks = await table.countRows();

    // 获取唯一来源文件数
    let uniqueSources = 0;
    if (totalChunks > 0) {
      const sourceFiles = await table.query()
        .select({ sourceFile: 'sourceFile' })
        .toArray();
      const sourceSet = new Set(sourceFiles.map((r: Record<string, unknown>) => r.sourceFile as string));
      uniqueSources = sourceSet.size;
    }

    return {
      totalChunks,
      uniqueSources,
      dimensions: this.dimensions,
      backend: 'lancedb',
    };
  }

  // ============================================================
  // 私有辅助方法
  // ============================================================

  /** 待写入的缓冲数据（表尚未创建时暂存） */
  private pendingRecords: LanceRecord[] = [];

  /**
   * 确保表已创建并返回表实例
   * 如果表不存在则先缓存数据，在第一次upsert时自动创建
   * @returns LanceDB表实例，表不存在时返回null
   */
  private async ensureTable(): Promise<lancedb.Table | null> {
    if (this.table) return this.table;

    if (!this.db) {
      this.db = await lancedb.connect(this.dbPath);
    }

    const existingTables = await this.db.tableNames();
    if (existingTables.includes(this.tableName)) {
      this.table = await this.db.openTable(this.tableName);
      return this.table;
    }

    // 表尚未创建，等待第一次upsert时通过数据自动创建
    return null;
  }

  /**
   * 创建表并写入初始数据
   * LanceDB需要通过数据推断schema，因此第一次必须带数据创建
   * @param records - 初始记录列表
   */
  private async createTableWithData(records: LanceRecord[]): Promise<lancedb.Table> {
    if (!this.db) {
      this.db = await lancedb.connect(this.dbPath);
    }

    this.table = await this.db.createTable(this.tableName, records as unknown as Record<string, unknown>[]);
    return this.table;
  }

  /**
   * 根据记录数量自动决定是否创建向量索引
   * 当记录数超过阈值时自动创建IVF_PQ索引
   */
  private async maybeCreateIndex(): Promise<void> {
    if (this.indexCreated || !this.table) return;

    try {
      const count = await this.table.countRows();
      if (count >= INDEX_CREATION_THRESHOLD) {
        await this.table.createIndex('vector', {
          config: lancedb.Index.ivfPq({
            numPartitions: Math.min(256, Math.max(16, Math.floor(count / 100))),
            numSubVectors: 16,
          }),
        });
        this.indexCreated = true;
      }
    } catch {
      // 索引创建失败不影响基本功能（可降级为暴力搜索）
    }
  }

  /**
   * 将LanceDB距离值转换为0-1的相似度分数
   * LanceDB默认使用L2距离，距离越小相似度越高
   * 使用sigmoid-like变换：score = 1 / (1 + distance)
   * @param distance - LanceDB返回的距离值
   * @returns 相似度分数 [0, 1]
   */
  private distanceToScore(distance: number): number {
    if (distance === undefined || distance === null) return 0;
    // L2距离转相似度：使用反比例变换
    return 1 / (1 + distance);
  }

  /**
   * 转义SQL字符串中的特殊字符
   * 防止SQL注入（LanceDB过滤使用SQL表达式）
   * @param value - 原始字符串
   * @returns 转义后的字符串
   */
  private escapeSql(value: string): string {
    return value.replace(/'/g, "''");
  }
}
