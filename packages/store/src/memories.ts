/**
 * 显式记忆CRUD操作
 * 管理用户偏好、格式约束、禁用表达等持久化记忆
 */

import type { Database } from './database.js';
import type { MemoryType } from '@workagent/shared';

/** 记忆记录 */
export interface MemoryRecord {
  id: string;
  type: MemoryType;
  content: string;
  source: string | null;
  enabled: boolean;
  createdAt: number;
}

/** 创建记忆参数 */
export interface CreateMemoryParams {
  id: string;
  type: MemoryType;
  content: string;
  source?: string;
  enabled?: boolean;
}

/**
 * 创建记忆
 * @param db - 数据库实例
 * @param params - 创建参数
 * @returns 创建的记忆记录
 */
export function createMemory(db: Database, params: CreateMemoryParams): MemoryRecord {
  const now = Date.now();
  const enabled = params.enabled ?? true;
  db.prepare(
    'INSERT INTO memories (id, type, content, source, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(params.id, params.type, params.content, params.source ?? null, enabled ? 1 : 0, now);

  return {
    id: params.id,
    type: params.type,
    content: params.content,
    source: params.source ?? null,
    enabled,
    createdAt: now,
  };
}

/**
 * 获取所有启用的记忆
 * @param db - 数据库实例
 * @returns 记忆记录列表
 */
export function getEnabledMemories(db: Database): MemoryRecord[] {
  return db.prepare(
    'SELECT id, type, content, source, enabled, created_at as createdAt FROM memories WHERE enabled = 1 ORDER BY created_at DESC',
  ).all() as unknown as MemoryRecord[];
}

/**
 * 获取所有记忆（包括禁用的）
 * @param db - 数据库实例
 * @returns 记忆记录列表
 */
export function listMemories(db: Database): MemoryRecord[] {
  return db.prepare(
    'SELECT id, type, content, source, enabled, created_at as createdAt FROM memories ORDER BY created_at DESC',
  ).all() as unknown as MemoryRecord[];
}

/**
 * 更新记忆
 * @param db - 数据库实例
 * @param memoryId - 记忆ID
 * @param updates - 更新字段
 */
export function updateMemory(
  db: Database,
  memoryId: string,
  updates: Partial<Pick<MemoryRecord, 'content' | 'enabled'>>,
): void {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.content !== undefined) { setClauses.push('content = ?'); values.push(updates.content); }
  if (updates.enabled !== undefined) { setClauses.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }

  if (setClauses.length === 0) return;
  values.push(memoryId);
  db.prepare(`UPDATE memories SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * 删除记忆
 * @param db - 数据库实例
 * @param memoryId - 记忆ID
 */
export function deleteMemory(db: Database, memoryId: string): void {
  db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId);
}
