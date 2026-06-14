/**
 * AgentEvent CRUD - Agent 事件记录数据存取
 * 每个 run 产生的事件流逐条写入 agent_events，用于恢复和诊断
 */

import type { Database } from './database.js';

// ============================================================
// 类型定义
// ============================================================

/** Agent 事件记录 */
export interface AgentEventRecord {
  id: number;
  runId: string;
  sequence: number;
  type: string;
  data: string;
  promptTokens: number;
  completionTokens: number;
  toolName?: string;
  isError: boolean;
  createdAt: string;
}

/** 创建事件参数 */
export interface CreateAgentEventParams {
  runId: string;
  sequence: number;
  type: string;
  data: string;
  promptTokens?: number;
  completionTokens?: number;
  toolName?: string;
  isError?: boolean;
}

// ============================================================
// CRUD 函数
// ============================================================

/**
 * 创建单条 agent event
 * @param db - 数据库实例
 * @param params - 事件参数
 * @returns 新记录的 ID
 */
export function createAgentEvent(db: Database, params: CreateAgentEventParams): number {
  const result = db.prepare(
    `INSERT INTO agent_events (run_id, sequence, type, data, prompt_tokens, completion_tokens, tool_name, is_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    params.runId,
    params.sequence,
    params.type,
    params.data,
    params.promptTokens ?? 0,
    params.completionTokens ?? 0,
    params.toolName ?? null,
    params.isError ? 1 : 0,
  );
  return result.changes;
}

/**
 * 批量创建 agent events
 * @param db - 数据库实例
 * @param events - 事件参数列表
 */
export function createAgentEventsBatch(db: Database, events: CreateAgentEventParams[]): void {
  const stmt = db.prepare(
    `INSERT INTO agent_events (run_id, sequence, type, data, prompt_tokens, completion_tokens, tool_name, is_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  );

  const transaction = db.transaction(() => {
    for (const event of events) {
      stmt.run(
        event.runId,
        event.sequence,
        event.type,
        event.data,
        event.promptTokens ?? 0,
        event.completionTokens ?? 0,
        event.toolName ?? null,
        event.isError ? 1 : 0,
      );
    }
  });

  transaction();
}

/**
 * 列出 run 的所有事件
 * @param db - 数据库实例
 * @param runId - run ID
 * @returns 事件列表（按 sequence 排序）
 */
export function listAgentEventsByRun(db: Database, runId: string): AgentEventRecord[] {
  return db.prepare(
    `SELECT id, run_id as runId, sequence, type, data,
            prompt_tokens as promptTokens, completion_tokens as completionTokens,
            tool_name as toolName, is_error as isError, created_at as createdAt
     FROM agent_events WHERE run_id = ? ORDER BY sequence ASC`
  ).all(runId) as unknown as AgentEventRecord[];
}

/**
 * 获取 run 的最新事件
 * @param db - 数据库实例
 * @param runId - run ID
 * @returns 最新事件记录
 */
export function getLatestAgentEvent(db: Database, runId: string): AgentEventRecord | undefined {
  return db.prepare(
    `SELECT id, run_id as runId, sequence, type, data,
            prompt_tokens as promptTokens, completion_tokens as completionTokens,
            tool_name as toolName, is_error as isError, created_at as createdAt
     FROM agent_events WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`
  ).get(runId) as unknown as AgentEventRecord | undefined;
}

/**
 * 获取 run 的最新 sequence 号
 * @param db - 数据库实例
 * @param runId - run ID
 * @returns 最新 sequence，没有事件返回 0
 */
export function getLatestSequence(db: Database, runId: string): number {
  const result = db.prepare(
    'SELECT MAX(sequence) as maxSeq FROM agent_events WHERE run_id = ?'
  ).get(runId) as { maxSeq: number | null } | undefined;
  return result?.maxSeq ?? 0;
}
