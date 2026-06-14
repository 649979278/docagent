/**
 * BM25 稀疏检索
 * 基于 SQLite FTS5 的 BM25 稀疏检索，FTS5 不可用时降级为 LIKE 子串匹配。
 *
 * 设计要点：
 * - 不直接依赖 @workagent/store，通过注入的 queryFn 查询
 * - RetrievedChunk 从 @workagent/shared 导入
 * - 空查询返回空结果，避免非法 SQL
 * - FTS5 特殊字符查询失败时自动降级到 LIKE
 */

import type { RetrievedChunk } from '@workagent/shared';

/**
 * BM25 稀疏检索选项。
 */
export interface BM25SearchOptions {
  /** 返回数量上限 */
  topK?: number;
}

/**
 * 基于 SQLite FTS5 的 BM25 稀疏检索。
 * FTS5 不可用时降级为 LIKE 子串匹配。
 * 不直接依赖 @workagent/store，通过注入的 queryFn 查询。
 */
export class BM25Search {
  /** 注入的查询函数，执行 SQL 并返回行 */
  private queryFn: (sql: string, params: unknown[]) => Array<Record<string, unknown>>;

  /** FTS5 是否可用 */
  private fts5Available: boolean;

  /**
   * 创建 BM25 检索器。
   * @param queryFn - SQL 查询函数，由调用方注入。
   * @param fts5Available - FTS5 是否可用。
   */
  constructor(
    queryFn: (sql: string, params: unknown[]) => Array<Record<string, unknown>>,
    fts5Available: boolean,
  ) {
    this.queryFn = queryFn;
    this.fts5Available = fts5Available;
  }

  /**
   * 执行关键词检索。
   * @param query - 搜索查询词。空查询返回空结果，避免非法 SQL。
   * @param options - 检索选项。
   * @returns 匹配的文档块列表。
   */
  async search(query: string, options?: BM25SearchOptions): Promise<RetrievedChunk[]> {
    if (!query || !query.trim()) return [];

    const topK = options?.topK ?? 10;

    if (this.fts5Available) {
      return this.searchFTS5(query, topK);
    }
    return this.searchLIKE(query, topK);
  }

  /**
   * 使用 FTS5 BM25 进行检索。
   * 查询失败（如特殊字符）时自动降级到 LIKE。
   * @param query - 搜索查询词。
   * @param topK - 返回数量上限。
   * @returns 匹配的文档块列表。
   */
  private searchFTS5(query: string, topK: number): RetrievedChunk[] {
    try {
      const rows = this.queryFn(
        `SELECT c.id as chunk_id, c.source_file, c.content,
                bm25(chunks_fts) as rank
         FROM chunks_fts f JOIN chunks c ON f.chunk_id = c.id
         WHERE chunks_fts MATCH ?
         ORDER BY rank LIMIT ?`,
        [query, topK],
      );

      return rows.map((row) => ({
        chunkId: String(row.chunk_id),
        sourceFile: String(row.source_file ?? ''),
        sourceType: 'unknown',
        locator: '',
        content: String(row.content ?? ''),
        score: 1 / (1 + Math.abs(Number(row.rank))),
      }));
    } catch {
      // FTS5 查询失败（如特殊字符），降级到 LIKE
      return this.searchLIKE(query, topK);
    }
  }

  /**
   * 使用 LIKE 子串匹配作为降级方案。
   * 对查询词按空格分词，所有词项取 OR 匹配。
   * @param query - 搜索查询词。
   * @param topK - 返回数量上限。
   * @returns 匹配的文档块列表。
   */
  private searchLIKE(query: string, topK: number): RetrievedChunk[] {
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const likeClauses = terms.map(() => `content LIKE ?`).join(' OR ');
    const params = terms.map((t) => `%${t}%`);

    const rows = this.queryFn(
      `SELECT id as chunk_id, source_file, content
       FROM chunks WHERE content IS NOT NULL AND (${likeClauses}) LIMIT ?`,
      [...params, topK],
    );

    return rows.map((row) => ({
      chunkId: String(row.chunk_id),
      sourceFile: String(row.source_file ?? ''),
      sourceType: 'unknown',
      locator: '',
      content: String(row.content ?? ''),
      score: 0.3,
    }));
  }
}
