/**
 * 索引任务CRUD操作
 * 管理文件索引的状态机（queued→hashing→extracting→chunking→embedding→indexing→indexed/failed）
 */

import type { Database } from './database.js';
import type { IndexJobStatus } from '@workagent/shared';

/** 索引任务记录 */
export interface IndexJobRecord {
  id: string;
  documentId: string;
  status: IndexJobStatus;
  stage: string;
  progress: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 创建索引任务参数 */
export interface CreateIndexJobParams {
  id: string;
  documentId: string;
  status?: IndexJobStatus;
  stage?: string;
}

/**
 * 创建索引任务
 * @param db - 数据库实例
 * @param params - 创建参数
 * @returns 创建的索引任务记录
 */
export function createIndexJob(db: Database, params: CreateIndexJobParams): IndexJobRecord {
  const now = Date.now();
  const status = params.status ?? 'queued';
  const stage = params.stage ?? 'hashing';
  db.prepare(
    'INSERT INTO index_jobs (id, document_id, status, stage, progress, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(params.id, params.documentId, status, stage, 0, null, now, now);

  return {
    id: params.id,
    documentId: params.documentId,
    status,
    stage,
    progress: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 获取索引任务
 * @param db - 数据库实例
 * @param jobId - 任务ID
 * @returns 任务记录或undefined
 */
export function getIndexJob(db: Database, jobId: string): IndexJobRecord | undefined {
  const row = db.prepare(
    'SELECT id, document_id as documentId, status, stage, progress, error, created_at as createdAt, updated_at as updatedAt FROM index_jobs WHERE id = ?',
  ).get(jobId);
  return row as unknown as IndexJobRecord | undefined;
}

/**
 * 根据文档ID获取索引任务
 * @param db - 数据库实例
 * @param documentId - 文档ID
 * @returns 任务记录或undefined
 */
export function getIndexJobByDocument(db: Database, documentId: string): IndexJobRecord | undefined {
  const row = db.prepare(
    'SELECT id, document_id as documentId, status, stage, progress, error, created_at as createdAt, updated_at as updatedAt FROM index_jobs WHERE document_id = ? ORDER BY created_at DESC LIMIT 1',
  ).get(documentId);
  return row as unknown as IndexJobRecord | undefined;
}

/**
 * 更新索引任务状态
 * @param db - 数据库实例
 * @param jobId - 任务ID
 * @param updates - 更新字段
 */
export function updateIndexJob(
  db: Database,
  jobId: string,
  updates: Partial<Pick<IndexJobRecord, 'status' | 'stage' | 'progress' | 'error'>>,
): void {
  const setClauses: string[] = ['updated_at = ?'];
  const values: unknown[] = [Date.now()];

  if (updates.status !== undefined) { setClauses.push('status = ?'); values.push(updates.status); }
  if (updates.stage !== undefined) { setClauses.push('stage = ?'); values.push(updates.stage); }
  if (updates.progress !== undefined) { setClauses.push('progress = ?'); values.push(updates.progress); }
  if (updates.error !== undefined) { setClauses.push('error = ?'); values.push(updates.error); }

  values.push(jobId);
  db.prepare(`UPDATE index_jobs SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * 列出待处理的索引任务
 * @param db - 数据库实例
 * @param limit - 返回数量
 * @returns 任务记录列表
 */
export function listPendingIndexJobs(db: Database, limit = 20): IndexJobRecord[] {
  return db.prepare(
    'SELECT id, document_id as documentId, status, stage, progress, error, created_at as createdAt, updated_at as updatedAt FROM index_jobs WHERE status NOT IN (?, ?) ORDER BY created_at ASC LIMIT ?',
  ).all('indexed', 'failed', limit) as unknown as IndexJobRecord[];
}

/**
 * 删除索引任务
 * @param db - 数据库实例
 * @param jobId - 任务ID
 */
export function deleteIndexJob(db: Database, jobId: string): void {
  db.prepare('DELETE FROM index_jobs WHERE id = ?').run(jobId);
}
