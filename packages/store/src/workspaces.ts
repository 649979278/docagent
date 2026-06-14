/**
 * Workspace CRUD - 工作区数据存取
 * 工作区用于按目录组织会话，支持 session-workspace 多对多关联
 */

import type { Database } from './database.js';

// ============================================================
// 类型定义
// ============================================================

/** 工作区数据库记录 */
export interface WorkspaceRecord {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

/** 创建工作区参数 */
export interface CreateWorkspaceParams {
  id: string;
  name: string;
  rootPath: string;
}

// ============================================================
// CRUD 函数
// ============================================================

/**
 * 创建工作区
 * @param db - 数据库实例
 * @param params - 创建参数
 * @returns 新创建的工作区记录
 */
export function createWorkspace(db: Database, params: CreateWorkspaceParams): WorkspaceRecord {
  db.prepare(
    `INSERT INTO workspaces (id, name, root_path, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`
  ).run(params.id, params.name, params.rootPath);

  return getWorkspace(db, params.id)!;
}

/**
 * 获取工作区
 * @param db - 数据库实例
 * @param id - 工作区ID
 * @returns 工作区记录，不存在则返回 undefined
 */
export function getWorkspace(db: Database, id: string): WorkspaceRecord | undefined {
  return db.prepare(
    `SELECT id, name, root_path as rootPath, created_at as createdAt, updated_at as updatedAt
     FROM workspaces WHERE id = ?`
  ).get(id) as unknown as WorkspaceRecord | undefined;
}

/**
 * 列出所有工作区
 * @param db - 数据库实例
 * @returns 工作区列表
 */
export function listWorkspaces(db: Database): WorkspaceRecord[] {
  return db.prepare(
    `SELECT id, name, root_path as rootPath, created_at as createdAt, updated_at as updatedAt
     FROM workspaces ORDER BY updated_at DESC`
  ).all() as unknown as WorkspaceRecord[];
}

/**
 * 更新工作区
 * @param db - 数据库实例
 * @param id - 工作区ID
 * @param updates - 更新字段
 */
export function updateWorkspace(db: Database, id: string, updates: Partial<Pick<WorkspaceRecord, 'name' | 'rootPath'>>): void {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) { setClauses.push('name = ?'); values.push(updates.name); }
  if (updates.rootPath !== undefined) { setClauses.push('root_path = ?'); values.push(updates.rootPath); }

  if (setClauses.length === 0) return;

  setClauses.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE workspaces SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * 删除工作区
 * @param db - 数据库实例
 * @param id - 工作区ID
 */
export function deleteWorkspace(db: Database, id: string): void {
  // 先删除关联
  db.prepare('DELETE FROM session_workspaces WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
}

/**
 * 绑定会话到工作区
 * @param db - 数据库实例
 * @param sessionId - 会话ID
 * @param workspaceId - 工作区ID
 */
export function bindSessionToWorkspace(db: Database, sessionId: string, workspaceId: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO session_workspaces (session_id, workspace_id) VALUES (?, ?)'
  ).run(sessionId, workspaceId);
}

/**
 * 解绑会话与工作区
 * @param db - 数据库实例
 * @param sessionId - 会话ID
 * @param workspaceId - 工作区ID
 */
export function unbindSessionFromWorkspace(db: Database, sessionId: string, workspaceId: string): void {
  db.prepare(
    'DELETE FROM session_workspaces WHERE session_id = ? AND workspace_id = ?'
  ).run(sessionId, workspaceId);
}

/**
 * 获取工作区下的所有会话ID
 * @param db - 数据库实例
 * @param workspaceId - 工作区ID
 * @returns 会话ID列表
 */
export function getWorkspaceSessionIds(db: Database, workspaceId: string): string[] {
  const rows = db.prepare(
    'SELECT session_id FROM session_workspaces WHERE workspace_id = ?'
  ).all(workspaceId) as Array<{ session_id: string }>;
  return rows.map(r => r.session_id);
}

/**
 * 获取会话所属的所有工作区
 * @param db - 数据库实例
 * @param sessionId - 会话ID
 * @returns 工作区ID列表
 */
export function getSessionWorkspaceIds(db: Database, sessionId: string): string[] {
  const rows = db.prepare(
    'SELECT workspace_id FROM session_workspaces WHERE session_id = ?'
  ).all(sessionId) as Array<{ workspace_id: string }>;
  return rows.map(r => r.workspace_id);
}
