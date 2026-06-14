/**
 * 持久化权限决策CRUD操作
 * 管理工具权限的自动决策规则（首次确认后可持久化）
 */

import type { Database } from './database.js';

/** 权限决策记录 */
export interface PermissionRecord {
  toolName: string;
  inputPattern: string;
  decision: string;
  createdAt: number;
}

/**
 * 保存权限决策
 * @param db - 数据库实例
 * @param record - 权限决策记录
 */
export function savePermissionDecision(db: Database, record: Omit<PermissionRecord, 'createdAt'>): void {
  const now = Date.now();
  db.prepare(
    'INSERT OR REPLACE INTO permissions (tool_name, input_pattern, decision, created_at) VALUES (?, ?, ?, ?)',
  ).run(record.toolName, record.inputPattern, record.decision, now);
}

/**
 * 查询权限决策
 * @param db - 数据库实例
 * @param toolName - 工具名称
 * @param inputPattern - 输入模式
 * @returns 权限决策记录或undefined
 */
export function getPermissionDecision(db: Database, toolName: string, inputPattern: string): PermissionRecord | undefined {
  const row = db.prepare(
    'SELECT tool_name as toolName, input_pattern as inputPattern, decision, created_at as createdAt FROM permissions WHERE tool_name = ? AND input_pattern = ?',
  ).get(toolName, inputPattern);
  return row as unknown as PermissionRecord | undefined;
}

/**
 * 加载所有权限决策
 * @param db - 数据库实例
 * @returns 权限决策列表
 */
export function loadAllPermissionDecisions(db: Database): PermissionRecord[] {
  return db.prepare(
    'SELECT tool_name as toolName, input_pattern as inputPattern, decision, created_at as createdAt FROM permissions ORDER BY created_at DESC',
  ).all() as unknown as PermissionRecord[];
}

/**
 * 删除权限决策
 * @param db - 数据库实例
 * @param toolName - 工具名称
 * @param inputPattern - 输入模式
 */
export function removePermissionDecision(db: Database, toolName: string, inputPattern: string): void {
  db.prepare('DELETE FROM permissions WHERE tool_name = ? AND input_pattern = ?').run(toolName, inputPattern);
}

/**
 * 检查工具是否有已保存的允许决策
 * @param db - 数据库实例
 * @param toolName - 工具名称
 * @param inputPattern - 输入模式
 * @returns 是否已持久化允许
 */
export function isPermissionPersisted(db: Database, toolName: string, inputPattern: string): boolean {
  const row = db.prepare(
    'SELECT decision FROM permissions WHERE tool_name = ? AND input_pattern = ?',
  ).get(toolName, inputPattern) as unknown as { decision: string } | undefined;
  return row?.decision === 'allowed';
}
