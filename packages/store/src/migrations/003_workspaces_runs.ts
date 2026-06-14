/**
 * Migration 003 - workspaces, agent_runs, agent_events 表 + sessions/documents 扩展
 * 函数型迁移：先检查列/表是否存在再执行，避免重复创建
 */

import type { Database } from '../database.js';

/** Migration 003 版本号 */
export const MIGRATION_003_VERSION = 3;

/**
 * 应用 Migration 003
 * @param db - 数据库实例
 * @param log - 日志回调
 * @param _fts5Available - FTS5 是否可用（003 不使用，保留接口一致性）
 */
export function applyMigration003(db: Database, log?: (msg: string) => void, _fts5Available?: boolean): void {
  // 1. 创建 workspaces 表
  const workspacesExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'"
  ).get();
  if (!workspacesExists) {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
    log?.('[Migration 003] Created workspaces table');
  }

  // 2. 创建 session_workspaces 关联表
  const sessionWorkspacesExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='session_workspaces'"
  ).get();
  if (!sessionWorkspacesExists) {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS session_workspaces (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        PRIMARY KEY (session_id, workspace_id)
      )
    `).run();
    log?.('[Migration 003] Created session_workspaces table');
  }

  // 3. 创建 agent_runs 表
  const agentRunsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_runs'"
  ).get();
  if (!agentRunsExists) {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        mode TEXT NOT NULL DEFAULT 'chat',
        status TEXT NOT NULL DEFAULT 'running',
        started_at TEXT DEFAULT (datetime('now')),
        ended_at TEXT,
        last_sequence INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        error TEXT,
        terminal_reason TEXT,
        diagnostics_json TEXT
      )
    `).run();
    log?.('[Migration 003] Created agent_runs table');
  }

  // 4. 创建 agent_events 表
  const agentEventsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_events'"
  ).get();
  if (!agentEventsExists) {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS agent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES agent_runs(id),
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        tool_name TEXT,
        is_error INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(run_id, sequence)
      )
    `).run();
    log?.('[Migration 003] Created agent_events table');
  }

  // 5. 扩展 sessions 表 - 增量添加列
  addColumnIfNotExists(db, 'sessions', 'workspace_id', 'TEXT');
  addColumnIfNotExists(db, 'sessions', 'summary', 'TEXT');
  addColumnIfNotExists(db, 'sessions', 'last_run_status', 'TEXT');
  log?.('[Migration 003] Extended sessions table');

  // 6. 扩展 documents 表 - 增量添加列
  addColumnIfNotExists(db, 'documents', 'chunk_count', 'INTEGER DEFAULT 0');
  addColumnIfNotExists(db, 'documents', 'last_indexed_hash', 'TEXT');
  addColumnIfNotExists(db, 'documents', 'last_error', 'TEXT');
  addColumnIfNotExists(db, 'documents', 'source_workspace_id', 'TEXT');
  log?.('[Migration 003] Extended documents table');

  // 7. 记录迁移版本
  db.prepare(
    'INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, strftime("%s","now") * 1000)'
  ).run(MIGRATION_003_VERSION);
  log?.(`[Migration 003] Applied version ${MIGRATION_003_VERSION}`);
}

/**
 * 安全地为表添加列，如果列已存在则跳过
 * @param db - 数据库实例
 * @param table - 表名
 * @param column - 列名
 * @param definition - 列定义（类型+默认值等）
 */
function addColumnIfNotExists(db: Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const exists = columns.some(col => col.name === column);
  if (!exists) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}
