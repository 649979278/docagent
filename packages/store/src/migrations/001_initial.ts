/**
 * SQLite Schema Migration - 001_initial
 * 创建所有一期需要的数据库表
 */

/** Migration 001 的SQL语句 */
export const migration001 = `
-- 会话表
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'chat',
  active_plan_id TEXT,
  summary TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);

-- 消息表
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  event_type TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  tool_name TEXT,
  token_count INTEGER DEFAULT 0,
  compact_boundary_id TEXT,
  created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_turn ON messages(turn_id);

-- 消息全文搜索(FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid'
);

-- 计划表
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  goal TEXT,
  outline_json TEXT NOT NULL,
  approved_at REAL,
  final_doc_path TEXT,
  created_at REAL NOT NULL
);

-- 文件索引
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  file_size INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  embedding_model TEXT,
  created_at REAL NOT NULL,
  indexed_at REAL
);

-- 文档块
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content_preview TEXT NOT NULL,
  source_locator TEXT,
  token_count INTEGER DEFAULT 0,
  vector_id TEXT,
  created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id, chunk_index);

-- 索引任务
CREATE TABLE IF NOT EXISTS index_jobs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'hashing',
  progress REAL DEFAULT 0,
  error TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);

-- 显式记忆
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  enabled INTEGER DEFAULT 1,
  created_at REAL NOT NULL
);

-- 持久化权限决策
CREATE TABLE IF NOT EXISTS permissions (
  tool_name TEXT NOT NULL,
  input_pattern TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at REAL NOT NULL,
  PRIMARY KEY (tool_name, input_pattern)
);

-- 模型配置
CREATE TABLE IF NOT EXISTS model_config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at REAL NOT NULL
);

-- Schema版本追踪
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at REAL NOT NULL
);

-- FTS5触发器：插入时同步
CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- FTS5触发器：删除时同步
CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

-- FTS5触发器：更新时同步
CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- 插入初始schema版本
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, strftime('%s','now') * 1000);
`;

/** 所有migration的有序列表 */
export const migrations: Array<{ version: number; sql: string }> = [
  { version: 1, sql: migration001 },
];
