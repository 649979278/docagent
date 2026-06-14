/**
 * AgentRun CRUD - Agent 运行记录数据存取
 * 每次对话生成一个 run，记录模式、状态、token 使用、诊断数据等
 */

import type { Database } from './database.js';

// ============================================================
// 类型定义
// ============================================================

/** Agent 运行记录 */
export interface AgentRunRecord {
  id: string;
  sessionId: string;
  mode: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  lastSequence: number;
  totalTokens: number;
  error?: string;
  terminalReason?: string;
  diagnosticsJson?: string;
}

/** 创建 run 参数 */
export interface CreateAgentRunParams {
  id: string;
  sessionId: string;
  mode?: string;
}

/** 更新 run 参数 */
export interface UpdateAgentRunParams {
  status?: string;
  endedAt?: string;
  lastSequence?: number;
  totalTokens?: number;
  error?: string;
  terminalReason?: string;
  diagnosticsJson?: string;
}

// ============================================================
// CRUD 函数
// ============================================================

/**
 * 创建 agent run
 * @param db - 数据库实例
 * @param params - 创建参数
 * @returns 新创建的 run 记录
 */
export function createAgentRun(db: Database, params: CreateAgentRunParams): AgentRunRecord {
  db.prepare(
    `INSERT INTO agent_runs (id, session_id, mode, status, started_at, last_sequence, total_tokens)
     VALUES (?, ?, ?, 'running', datetime('now'), 0, 0)`
  ).run(params.id, params.sessionId, params.mode ?? 'chat');

  return getAgentRun(db, params.id)!;
}

/**
 * 获取 agent run
 * @param db - 数据库实例
 * @param id - run ID
 * @returns run 记录
 */
export function getAgentRun(db: Database, id: string): AgentRunRecord | undefined {
  return db.prepare(
    `SELECT id, session_id as sessionId, mode, status, started_at as startedAt,
            ended_at as endedAt, last_sequence as lastSequence, total_tokens as totalTokens,
            error, terminal_reason as terminalReason, diagnostics_json as diagnosticsJson
     FROM agent_runs WHERE id = ?`
  ).get(id) as unknown as AgentRunRecord | undefined;
}

/**
 * 更新 agent run
 * @param db - 数据库实例
 * @param id - run ID
 * @param updates - 更新字段
 */
export function updateAgentRun(db: Database, id: string, updates: UpdateAgentRunParams): void {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { setClauses.push('status = ?'); values.push(updates.status); }
  if (updates.endedAt !== undefined) { setClauses.push('ended_at = ?'); values.push(updates.endedAt); }
  if (updates.lastSequence !== undefined) { setClauses.push('last_sequence = ?'); values.push(updates.lastSequence); }
  if (updates.totalTokens !== undefined) { setClauses.push('total_tokens = ?'); values.push(updates.totalTokens); }
  if (updates.error !== undefined) { setClauses.push('error = ?'); values.push(updates.error); }
  if (updates.terminalReason !== undefined) { setClauses.push('terminal_reason = ?'); values.push(updates.terminalReason); }
  if (updates.diagnosticsJson !== undefined) { setClauses.push('diagnostics_json = ?'); values.push(updates.diagnosticsJson); }

  if (setClauses.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE agent_runs SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * 列出会话的所有 run
 * @param db - 数据库实例
 * @param sessionId - 会话ID
 * @returns run 记录列表（按开始时间倒序）
 */
export function listAgentRunsBySession(db: Database, sessionId: string): AgentRunRecord[] {
  return db.prepare(
    `SELECT id, session_id as sessionId, mode, status, started_at as startedAt,
            ended_at as endedAt, last_sequence as lastSequence, total_tokens as totalTokens,
            error, terminal_reason as terminalReason, diagnostics_json as diagnosticsJson
     FROM agent_runs WHERE session_id = ? ORDER BY started_at DESC`
  ).all(sessionId) as unknown as AgentRunRecord[];
}

/**
 * 列出所有活跃的 run（status = running）
 * @param db - 数据库实例
 * @returns 活跃 run 列表
 */
export function listActiveAgentRuns(db: Database): AgentRunRecord[] {
  return db.prepare(
    `SELECT id, session_id as sessionId, mode, status, started_at as startedAt,
            ended_at as endedAt, last_sequence as lastSequence, total_tokens as totalTokens,
            error, terminal_reason as terminalReason, diagnostics_json as diagnosticsJson
     FROM agent_runs WHERE status = 'running' ORDER BY started_at DESC`
  ).all() as unknown as AgentRunRecord[];
}

/**
 * 结束 run（设置状态、结束时间和终止原因）
 * @param db - 数据库实例
 * @param id - run ID
 * @param status - 结束状态
 * @param terminalReason - 终止原因
 * @param totalTokens - 总 token 数
 */
export function endAgentRun(db: Database, id: string, status: string, terminalReason?: string, totalTokens?: number): void {
  const updates: UpdateAgentRunParams = {
    status,
    endedAt: new Date().toISOString(),
    terminalReason,
  };
  if (totalTokens !== undefined) updates.totalTokens = totalTokens;
  updateAgentRun(db, id, updates);
}
