/**
 * Migration 004 - chunks 表增加全文列 + FTS5 虚拟表
 * 幂等迁移：addColumnIfNotExists + 条件创建 FTS5 + 回填已有数据
 *
 * 新增列：
 * - content (TEXT): 块全文内容（原有 content_preview 只是前100字预览）
 * - source_file (TEXT): 来源文件路径（冗余存储，便于 FTS5 检索）
 *
 * FTS5 虚拟表 chunks_fts：
 * - 字段：chunk_id, source_file, content
 * - 同步触发器：INSERT/DELETE/UPDATE 自动同步
 * - 回填：创建后从 chunks + documents 关联回填
 */

import type { Database } from '../database.js';

/** Migration 004 版本号 */
export const MIGRATION_004_VERSION = 4;

/**
 * 应用 Migration 004
 * @param db - 数据库实例
 * @param log - 日志回调
 * @param fts5Available - FTS5 是否可用
 */
export function applyMigration004(
  db: Database,
  log: (msg: string) => void,
  fts5Available: boolean,
): void {
  // 1. 幂等增加列
  addColumnIfNotExists(db, 'chunks', 'content', 'TEXT');
  addColumnIfNotExists(db, 'chunks', 'source_file', 'TEXT');
  log('[Migration 004] Added content, source_file columns to chunks');

  // FTS5 不可用时跳过虚拟表和触发器（BM25Search 降级到 LIKE）
  if (!fts5Available) {
    log('[Migration 004] FTS5 not available, skipping FTS virtual table');
    // 仍然记录版本号
    insertSchemaVersion(db, MIGRATION_004_VERSION);
    return;
  }

  // 2. 创建 FTS5 虚拟表（幂等）
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      chunk_id,
      source_file,
      content
    );
  `);

  // 3. 同步触发器（幂等 — IF NOT EXISTS）
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, chunk_id, source_file, content)
      VALUES (new.rowid, new.id, new.source_file, new.content);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, chunk_id, source_file, content)
      VALUES ('delete', old.rowid, old.id, old.source_file, old.content);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, chunk_id, source_file, content)
      VALUES ('delete', old.rowid, old.id, old.source_file, old.content);
      INSERT INTO chunks_fts(rowid, chunk_id, source_file, content)
      VALUES (new.rowid, new.id, new.source_file, new.content);
    END;
  `);

  // 4. 回填已有 chunks（content 从 documents.path 关联）
  // 只回填 content 非空且尚未入库 FTS 的记录
  db.exec(`
    INSERT OR IGNORE INTO chunks_fts(rowid, chunk_id, source_file, content)
    SELECT c.rowid, c.id, c.source_file, c.content
    FROM chunks c
    WHERE c.content IS NOT NULL AND c.content != '';
  `);

  log('[Migration 004] Created chunks_fts, triggers, and backfilled existing data');
  insertSchemaVersion(db, MIGRATION_004_VERSION);
}

/**
 * 幂等添加列。如果列已存在则跳过。
 * @param db - 数据库实例
 * @param table - 表名
 * @param column - 列名
 * @param type - 列类型定义
 */
function addColumnIfNotExists(db: Database, table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/**
 * 记录迁移版本号。
 * @param db - 数据库实例
 * @param version - 版本号
 */
function insertSchemaVersion(db: Database, version: number): void {
  db.exec(
    `INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (${version}, strftime('%s','now') * 1000)`,
  );
}
