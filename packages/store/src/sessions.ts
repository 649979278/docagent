/**
 * 会话CRUD操作
 */

import type { Database } from './database.js';
import type { AgentMode } from '@workagent/shared';

/** 会话记录 */
export interface SessionRecord {
  id: string;
  title: string;
  mode: AgentMode;
  activePlanId: string | null;
  summary: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 创建会话参数 */
export interface CreateSessionParams {
  id: string;
  title: string;
  mode?: AgentMode;
}

/**
 * 创建新会话
 */
export function createSession(db: Database, params: CreateSessionParams): SessionRecord {
  const now = Date.now();
  const mode = params.mode ?? 'chat';
  db.prepare(
    'INSERT INTO sessions (id, title, mode, active_plan_id, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(params.id, params.title, mode, null, null, now, now);

  return {
    id: params.id,
    title: params.title,
    mode,
    activePlanId: null,
    summary: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 获取会话
 */
export function getSession(db: Database, sessionId: string): SessionRecord | undefined {
  const row = db.prepare(
    'SELECT id, title, mode, active_plan_id as activePlanId, summary, created_at as createdAt, updated_at as updatedAt FROM sessions WHERE id = ?',
  ).get(sessionId);
  return row ? (row as unknown as SessionRecord) : undefined;
}

/**
 * 列出所有会话（按更新时间倒序）
 */
export function listSessions(db: Database, limit = 50, offset = 0): SessionRecord[] {
  return db.prepare(
    'SELECT id, title, mode, active_plan_id as activePlanId, summary, created_at as createdAt, updated_at as updatedAt FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?',
  ).all(limit, offset) as unknown as SessionRecord[];
}

/**
 * 更新会话
 */
export function updateSession(
  db: Database,
  sessionId: string,
  updates: Partial<Pick<SessionRecord, 'title' | 'mode' | 'activePlanId' | 'summary'>>,
): void {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) { setClauses.push('title = ?'); values.push(updates.title); }
  if (updates.mode !== undefined) { setClauses.push('mode = ?'); values.push(updates.mode); }
  if (updates.activePlanId !== undefined) { setClauses.push('active_plan_id = ?'); values.push(updates.activePlanId); }
  if (updates.summary !== undefined) { setClauses.push('summary = ?'); values.push(updates.summary); }

  if (setClauses.length === 0) return;
  setClauses.push('updated_at = ?');
  values.push(Date.now());
  values.push(sessionId);

  db.prepare(`UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * 删除会话（级联删除消息和计划）
 */
export function deleteSession(db: Database, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

/**
 * 搜索会话（按标题关键词）
 */
export function searchSessions(db: Database, query: string, limit = 20): SessionRecord[] {
  return db.prepare(
    'SELECT id, title, mode, active_plan_id as activePlanId, summary, created_at as createdAt, updated_at as updatedAt FROM sessions WHERE title LIKE ? ORDER BY updated_at DESC LIMIT ?',
  ).all(`%${query}%`, limit) as unknown as SessionRecord[];
}
