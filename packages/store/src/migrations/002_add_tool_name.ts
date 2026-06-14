/**
 * SQLite Schema Migration - 002_add_tool_name
 * 为已有数据库的messages表添加tool_name列
 * （新建数据库的001迁移已包含此列，此迁移仅修复旧数据库）
 *
 * 使用函数型迁移而非纯SQL，因为 ALTER TABLE ADD COLUMN
 * 在列已存在时会报错，需要安全地忽略该错误
 */

import type { Database } from '../database.js';

/**
 * 应用迁移002：添加tool_name列
 * 安全处理列已存在的情况（新建数据库的001已包含此列）
 * @param db - 数据库实例
 * @param log - 日志函数
 */
export function applyMigration002(db: Database, log: (msg: string) => void): void {
  // 检查tool_name列是否已存在
  const tableInfo = db.pragma('table_info(messages)');
  // sql.js的pragma返回行可能格式不同，用prepare查询更可靠
  let hasToolName = false;
  try {
    const columns = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
    hasToolName = columns.some(col => col.name === 'tool_name');
  } catch {
    hasToolName = false;
  }

  if (!hasToolName) {
    log('Adding tool_name column to messages table...');
    db.exec('ALTER TABLE messages ADD COLUMN tool_name TEXT');
  } else {
    log('tool_name column already exists, skipping ALTER TABLE');
  }

  // 记录schema版本
  db.exec("INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (2, strftime('%s','now') * 1000)");
}
