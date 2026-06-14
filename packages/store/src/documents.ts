/**
 * 文档索引CRUD操作
 * 管理已导入的文档元信息和索引状态
 */

import type { Database } from './database.js';

/** 文档记录 */
export interface DocumentRecord {
  id: string;
  path: string;
  fileName: string;
  fileType: string;
  sha256: string;
  status: string;
  error: string | null;
  fileSize: number;
  chunkCount: number;
  embeddingModel: string | null;
  sourceWorkspaceId: string | null;
  createdAt: number;
  indexedAt: number | null;
}

/** 创建文档参数 */
export interface CreateDocumentParams {
  id: string;
  path: string;
  fileName: string;
  fileType: string;
  sha256: string;
  fileSize?: number;
  embeddingModel?: string;
  sourceWorkspaceId?: string | null;
}

/**
 * 创建文档记录
 * @param db - 数据库实例
 * @param params - 创建参数
 * @returns 创建的文档记录
 */
export function createDocument(db: Database, params: CreateDocumentParams): DocumentRecord {
  const now = Date.now();
  db.prepare(
    'INSERT INTO documents (id, path, file_name, file_type, sha256, status, error, file_size, chunk_count, embedding_model, source_workspace_id, created_at, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(params.id, params.path, params.fileName, params.fileType, params.sha256, 'queued', null, params.fileSize ?? 0, 0, params.embeddingModel ?? null, params.sourceWorkspaceId ?? null, now, null);

  return {
    id: params.id,
    path: params.path,
    fileName: params.fileName,
    fileType: params.fileType,
    sha256: params.sha256,
    status: 'queued',
    error: null,
    fileSize: params.fileSize ?? 0,
    chunkCount: 0,
    embeddingModel: params.embeddingModel ?? null,
    sourceWorkspaceId: params.sourceWorkspaceId ?? null,
    createdAt: now,
    indexedAt: null,
  };
}

/**
 * 根据路径获取文档
 * @param db - 数据库实例
 * @param filePath - 文件路径
 * @returns 文档记录或undefined
 */
export function getDocumentByPath(db: Database, filePath: string): DocumentRecord | undefined {
  const row = db.prepare(
    'SELECT id, path, file_name as fileName, file_type as fileType, sha256, status, error, file_size as fileSize, chunk_count as chunkCount, embedding_model as embeddingModel, source_workspace_id as sourceWorkspaceId, created_at as createdAt, indexed_at as indexedAt FROM documents WHERE path = ?',
  ).get(filePath);
  return row as unknown as DocumentRecord | undefined;
}

/**
 * 根据ID获取文档
 * @param db - 数据库实例
 * @param docId - 文档ID
 * @returns 文档记录或undefined
 */
export function getDocument(db: Database, docId: string): DocumentRecord | undefined {
  const row = db.prepare(
    'SELECT id, path, file_name as fileName, file_type as fileType, sha256, status, error, file_size as fileSize, chunk_count as chunkCount, embedding_model as embeddingModel, source_workspace_id as sourceWorkspaceId, created_at as createdAt, indexed_at as indexedAt FROM documents WHERE id = ?',
  ).get(docId);
  return row as unknown as DocumentRecord | undefined;
}

/**
 * 更新文档状态
 * @param db - 数据库实例
 * @param docId - 文档ID
 * @param updates - 更新字段
 */
export function updateDocument(
  db: Database,
  docId: string,
  updates: Partial<Pick<DocumentRecord, 'status' | 'error' | 'chunkCount' | 'embeddingModel' | 'sourceWorkspaceId' | 'indexedAt'>>,
): void {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { setClauses.push('status = ?'); values.push(updates.status); }
  if (updates.error !== undefined) { setClauses.push('error = ?'); values.push(updates.error); }
  if (updates.chunkCount !== undefined) { setClauses.push('chunk_count = ?'); values.push(updates.chunkCount); }
  if (updates.embeddingModel !== undefined) { setClauses.push('embedding_model = ?'); values.push(updates.embeddingModel); }
  if (updates.sourceWorkspaceId !== undefined) { setClauses.push('source_workspace_id = ?'); values.push(updates.sourceWorkspaceId); }
  if (updates.indexedAt !== undefined) { setClauses.push('indexed_at = ?'); values.push(updates.indexedAt); }

  if (setClauses.length === 0) return;
  values.push(docId);
  db.prepare(`UPDATE documents SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * 列出所有文档
 * @param db - 数据库实例
 * @param limit - 返回数量限制
 * @param offset - 偏移量
 * @returns 文档记录列表
 */
export function listDocuments(db: Database, limit = 100, offset = 0): DocumentRecord[] {
  return db.prepare(
    'SELECT id, path, file_name as fileName, file_type as fileType, sha256, status, error, file_size as fileSize, chunk_count as chunkCount, embedding_model as embeddingModel, source_workspace_id as sourceWorkspaceId, created_at as createdAt, indexed_at as indexedAt FROM documents ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ).all(limit, offset) as unknown as DocumentRecord[];
}

/**
 * 按工作区列出文档。
 * @param db - 数据库实例
 * @param workspaceId - 工作区ID
 * @param limit - 返回数量限制
 * @param offset - 偏移量
 * @returns 文档记录列表
 */
export function listDocumentsByWorkspace(
  db: Database,
  workspaceId: string,
  limit = 100,
  offset = 0,
): DocumentRecord[] {
  return db.prepare(
    'SELECT id, path, file_name as fileName, file_type as fileType, sha256, status, error, file_size as fileSize, chunk_count as chunkCount, embedding_model as embeddingModel, source_workspace_id as sourceWorkspaceId, created_at as createdAt, indexed_at as indexedAt FROM documents WHERE source_workspace_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ).all(workspaceId, limit, offset) as unknown as DocumentRecord[];
}

/**
 * 删除文档
 * @param db - 数据库实例
 * @param docId - 文档ID
 */
export function deleteDocument(db: Database, docId: string): void {
  db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
}
