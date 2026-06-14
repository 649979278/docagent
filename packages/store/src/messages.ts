/**
 * 消息CRUD操作（含FTS5全文搜索）
 */

import type { Database } from './database.js';
import type { MessageRole, MessageEventType, ToolCall } from '@workagent/shared';

/** 消息记录 */
export interface MessageRecord {
  id: string;
  sessionId: string;
  turnId: string;
  sequence: number;
  role: MessageRole;
  content: string;
  eventType: MessageEventType | null;
  toolCalls: ToolCall[] | null;
  toolCallId: string | null;
  toolName: string | null;
  tokenCount: number;
  compactBoundaryId: string | null;
  createdAt: number;
}

/** 创建消息参数 */
export interface CreateMessageParams {
  id: string;
  sessionId: string;
  turnId: string;
  sequence: number;
  role: MessageRole;
  content: string;
  eventType?: MessageEventType;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  tokenCount?: number;
  compactBoundaryId?: string;
}

/** 反序列化消息行 */
function deserializeMessage(row: Record<string, unknown>): MessageRecord {
  return {
    id: row.id as string,
    sessionId: row.sessionId as string,
    turnId: row.turnId as string,
    sequence: row.sequence as number,
    role: row.role as MessageRole,
    content: row.content as string,
    eventType: row.eventType as MessageEventType | null,
    toolCalls: row.toolCalls ? JSON.parse(row.toolCalls as string) : null,
    toolCallId: row.toolCallId as string | null,
    toolName: row.toolName as string | null,
    tokenCount: row.tokenCount as number,
    compactBoundaryId: row.compactBoundaryId as string | null,
    createdAt: row.createdAt as number,
  };
}

/**
 * 创建消息
 */
export function createMessage(db: Database, params: CreateMessageParams): MessageRecord {
  const now = Date.now();
  db.prepare(`
    INSERT INTO messages (id, session_id, turn_id, sequence, role, content, event_type, tool_calls, tool_call_id, tool_name, token_count, compact_boundary_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id, params.sessionId, params.turnId, params.sequence,
    params.role, params.content, params.eventType ?? null,
    params.toolCalls ? JSON.stringify(params.toolCalls) : null,
    params.toolCallId ?? null, params.toolName ?? null,
    params.tokenCount ?? 0,
    params.compactBoundaryId ?? null, now,
  );
  return { id: params.id, sessionId: params.sessionId, turnId: params.turnId, sequence: params.sequence, role: params.role, content: params.content, eventType: params.eventType ?? null, toolCalls: params.toolCalls ?? null, toolCallId: params.toolCallId ?? null, toolName: params.toolName ?? null, tokenCount: params.tokenCount ?? 0, compactBoundaryId: params.compactBoundaryId ?? null, createdAt: now };
}

/**
 * 批量创建消息
 */
export function createMessagesBatch(db: Database, messages: CreateMessageParams[]): void {
  const transaction = db.transaction(() => {
    for (const params of messages) {
      createMessage(db, params);
    }
  });
  transaction();
}

/**
 * 获取会话的消息列表
 */
export function getSessionMessages(db: Database, sessionId: string, limit = 100): MessageRecord[] {
  return db.prepare(
    `SELECT id, session_id as sessionId, turn_id as turnId, sequence, role, content,
     event_type as eventType, tool_calls as toolCalls, tool_call_id as toolCallId,
     tool_name as toolName, token_count as tokenCount, compact_boundary_id as compactBoundaryId, created_at as createdAt
     FROM messages WHERE session_id = ? ORDER BY sequence ASC LIMIT ?`,
  ).all(sessionId, limit).map(deserializeMessage);
}

/**
 * 获取会话最近的N条消息
 */
export function getRecentMessages(db: Database, sessionId: string, count = 20): MessageRecord[] {
  return db.prepare(
    `SELECT id, session_id as sessionId, turn_id as turnId, sequence, role, content,
     event_type as eventType, tool_calls as toolCalls, tool_call_id as toolCallId,
     tool_name as toolName, token_count as tokenCount, compact_boundary_id as compactBoundaryId, created_at as createdAt
     FROM (SELECT * FROM messages WHERE session_id = ? ORDER BY sequence DESC LIMIT ?) ORDER BY sequence ASC`,
  ).all(sessionId, count).map(deserializeMessage);
}

/**
 * 删除压缩边界之前的消息
 */
export function deleteMessagesBeforeCompactBoundary(db: Database, sessionId: string, compactBoundaryId: string): number {
  const boundary = db.prepare('SELECT sequence FROM messages WHERE id = ? AND session_id = ?').get(compactBoundaryId, sessionId) as { sequence: number } | undefined;
  if (!boundary) return 0;
  return db.prepare('DELETE FROM messages WHERE session_id = ? AND sequence < ?').run(sessionId, boundary.sequence).changes;
}

/**
 * 全文搜索消息
 * 优先使用FTS5，不可用时回退到LIKE
 */
export function searchMessages(db: Database, query: string, limit = 20): MessageRecord[] {
  // 尝试FTS5搜索
  try {
    return db.prepare(
      `SELECT m.id, m.session_id as sessionId, m.turn_id as turnId, m.sequence, m.role, m.content,
       m.event_type as eventType, m.tool_calls as toolCalls, m.tool_call_id as toolCallId,
       m.tool_name as toolName, m.token_count as tokenCount, m.compact_boundary_id as compactBoundaryId, m.created_at as createdAt
       FROM messages_fts fts JOIN messages m ON m.rowid = fts.rowid
       WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?`,
    ).all(query, limit).map(deserializeMessage);
  } catch {
    // FTS5不可用，回退到LIKE搜索
    return db.prepare(
      `SELECT id, session_id as sessionId, turn_id as turnId, sequence, role, content,
       event_type as eventType, tool_calls as toolCalls, tool_call_id as toolCallId,
       tool_name as toolName, token_count as tokenCount, compact_boundary_id as compactBoundaryId, created_at as createdAt
       FROM messages WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?`,
    ).all(`%${query}%`, limit).map(deserializeMessage);
  }
}

/**
 * 获取会话消息总数
 */
export function getMessageCount(db: Database, sessionId: string): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?').get(sessionId) as { count: number };
  return row.count;
}
