/**
 * 计划CRUD操作
 * 管理公文写作的计划（draft/approved/executing/completed/cancelled）
 */

import type { Database } from './database.js';
import type { PlanStatus } from '@workagent/shared';

/** 计划记录 */
export interface PlanRecord {
  id: string;
  sessionId: string;
  status: PlanStatus;
  title: string;
  goal: string | null;
  outlineJson: string;
  approvedAt: number | null;
  finalDocPath: string | null;
  createdAt: number;
}

/** 创建计划参数 */
export interface CreatePlanParams {
  id: string;
  sessionId: string;
  title: string;
  goal?: string;
  outlineJson: string;
  status?: PlanStatus;
}

/**
 * 创建新计划
 * @param db - 数据库实例
 * @param params - 创建参数
 * @returns 创建的计划记录
 */
export function createPlan(db: Database, params: CreatePlanParams): PlanRecord {
  const now = Date.now();
  const status = params.status ?? 'draft';
  db.prepare(
    'INSERT INTO plans (id, session_id, status, title, goal, outline_json, approved_at, final_doc_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(params.id, params.sessionId, status, params.title, params.goal ?? null, params.outlineJson, null, null, now);

  return {
    id: params.id,
    sessionId: params.sessionId,
    status,
    title: params.title,
    goal: params.goal ?? null,
    outlineJson: params.outlineJson,
    approvedAt: null,
    finalDocPath: null,
    createdAt: now,
  };
}

/**
 * 获取计划
 * @param db - 数据库实例
 * @param planId - 计划ID
 * @returns 计划记录或undefined
 */
export function getPlan(db: Database, planId: string): PlanRecord | undefined {
  const row = db.prepare(
    'SELECT id, session_id as sessionId, status, title, goal, outline_json as outlineJson, approved_at as approvedAt, final_doc_path as finalDocPath, created_at as createdAt FROM plans WHERE id = ?',
  ).get(planId);
  return row as unknown as PlanRecord | undefined;
}

/**
 * 获取会话的活跃计划
 * @param db - 数据库实例
 * @param sessionId - 会话ID
 * @returns 最新的计划记录或undefined
 */
export function getActivePlanBySession(db: Database, sessionId: string): PlanRecord | undefined {
  const row = db.prepare(
    'SELECT id, session_id as sessionId, status, title, goal, outline_json as outlineJson, approved_at as approvedAt, final_doc_path as finalDocPath, created_at as createdAt FROM plans WHERE session_id = ? AND status NOT IN (?, ?) ORDER BY created_at DESC LIMIT 1',
  ).get(sessionId, 'completed', 'cancelled');
  return row as unknown as PlanRecord | undefined;
}

/**
 * 更新计划状态
 * @param db - 数据库实例
 * @param planId - 计划ID
 * @param updates - 更新字段
 */
export function updatePlan(
  db: Database,
  planId: string,
  updates: Partial<Pick<PlanRecord, 'status' | 'title' | 'goal' | 'outlineJson' | 'approvedAt' | 'finalDocPath'>>,
): void {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { setClauses.push('status = ?'); values.push(updates.status); }
  if (updates.title !== undefined) { setClauses.push('title = ?'); values.push(updates.title); }
  if (updates.goal !== undefined) { setClauses.push('goal = ?'); values.push(updates.goal); }
  if (updates.outlineJson !== undefined) { setClauses.push('outline_json = ?'); values.push(updates.outlineJson); }
  if (updates.approvedAt !== undefined) { setClauses.push('approved_at = ?'); values.push(updates.approvedAt); }
  if (updates.finalDocPath !== undefined) { setClauses.push('final_doc_path = ?'); values.push(updates.finalDocPath); }

  if (setClauses.length === 0) return;
  values.push(planId);
  db.prepare(`UPDATE plans SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * 批准计划
 * @param db - 数据库实例
 * @param planId - 计划ID
 * @param updatedOutlineJson - 用户修改后的提纲（可选）
 */
export function approvePlan(db: Database, planId: string, updatedOutlineJson?: string): void {
  const now = Date.now();
  if (updatedOutlineJson) {
    db.prepare('UPDATE plans SET status = ?, approved_at = ?, outline_json = ? WHERE id = ?')
      .run('approved', now, updatedOutlineJson, planId);
  } else {
    db.prepare('UPDATE plans SET status = ?, approved_at = ? WHERE id = ?')
      .run('approved', now, planId);
  }
}

/**
 * 列出会话的所有计划
 * @param db - 数据库实例
 * @param sessionId - 会话ID
 * @returns 计划记录列表
 */
export function listPlansBySession(db: Database, sessionId: string): PlanRecord[] {
  return db.prepare(
    'SELECT id, session_id as sessionId, status, title, goal, outline_json as outlineJson, approved_at as approvedAt, final_doc_path as finalDocPath, created_at as createdAt FROM plans WHERE session_id = ? ORDER BY created_at DESC',
  ).all(sessionId) as unknown as PlanRecord[];
}
