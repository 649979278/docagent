/**
 * 文档块CRUD操作
 * 管理文档分块后的chunk记录，关联向量和来源定位
 */

import type { Database } from './database.js';

/** 文档块记录 */
export interface ChunkRecord {
  id: string;
  documentId: string;
  chunkIndex: number;
  contentPreview: string;
  sourceLocator: string | null;
  tokenCount: number;
  vectorId: string | null;
  createdAt: number;
}

/** 创建文档块参数 */
export interface CreateChunkParams {
  id: string;
  documentId: string;
  chunkIndex: number;
  contentPreview: string;
  sourceLocator?: string;
  tokenCount?: number;
  vectorId?: string;
}

/**
 * 创建文档块
 * @param db - 数据库实例
 * @param params - 创建参数
 * @returns 创建的文档块记录
 */
export function createChunk(db: Database, params: CreateChunkParams): ChunkRecord {
  const now = Date.now();
  db.prepare(
    'INSERT INTO chunks (id, document_id, chunk_index, content_preview, source_locator, token_count, vector_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(params.id, params.documentId, params.chunkIndex, params.contentPreview, params.sourceLocator ?? null, params.tokenCount ?? 0, params.vectorId ?? null, now);

  return {
    id: params.id,
    documentId: params.documentId,
    chunkIndex: params.chunkIndex,
    contentPreview: params.contentPreview,
    sourceLocator: params.sourceLocator ?? null,
    tokenCount: params.tokenCount ?? 0,
    vectorId: params.vectorId ?? null,
    createdAt: now,
  };
}

/**
 * 批量创建文档块
 * @param db - 数据库实例
 * @param chunks - 文档块参数列表
 */
export function createChunksBatch(db: Database, chunks: CreateChunkParams[]): void {
  const transaction = db.transaction(() => {
    for (const params of chunks) {
      createChunk(db, params);
    }
  });
  transaction();
}

/**
 * 获取文档的所有块
 * @param db - 数据库实例
 * @param documentId - 文档ID
 * @returns 文档块列表
 */
export function getChunksByDocument(db: Database, documentId: string): ChunkRecord[] {
  return db.prepare(
    'SELECT id, document_id as documentId, chunk_index as chunkIndex, content_preview as contentPreview, source_locator as sourceLocator, token_count as tokenCount, vector_id as vectorId, created_at as createdAt FROM chunks WHERE document_id = ? ORDER BY chunk_index ASC',
  ).all(documentId) as unknown as ChunkRecord[];
}

/**
 * 根据ID获取文档块
 * @param db - 数据库实例
 * @param chunkId - 块ID
 * @returns 文档块记录或undefined
 */
export function getChunk(db: Database, chunkId: string): ChunkRecord | undefined {
  const row = db.prepare(
    'SELECT id, document_id as documentId, chunk_index as chunkIndex, content_preview as contentPreview, source_locator as sourceLocator, token_count as tokenCount, vector_id as vectorId, created_at as createdAt FROM chunks WHERE id = ?',
  ).get(chunkId);
  return row as unknown as ChunkRecord | undefined;
}

/**
 * 更新文档块的向量ID
 * @param db - 数据库实例
 * @param chunkId - 块ID
 * @param vectorId - 向量存储中的ID
 */
export function updateChunkVectorId(db: Database, chunkId: string, vectorId: string): void {
  db.prepare('UPDATE chunks SET vector_id = ? WHERE id = ?').run(vectorId, chunkId);
}

/**
 * 删除文档的所有块
 * @param db - 数据库实例
 * @param documentId - 文档ID
 * @returns 删除的块数量
 */
export function deleteChunksByDocument(db: Database, documentId: string): number {
  return db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId).changes;
}
