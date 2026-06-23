import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { closeDatabase, initDatabase } from '../database.js';

/**
 * 创建临时数据库路径。
 * @returns 临时数据库路径。
 */
function createDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workagent-store-db-'));
  return path.join(dir, 'test.db');
}

describe('better-sqlite3 database wrapper', () => {
  it('persists rows without explicit save', () => {
    const dbPath = createDbPath();
    const db = initDatabase({ dbPath });

    db.prepare('INSERT INTO sessions (id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('s1', '测试会话', 'chat', Date.now(), Date.now());
    closeDatabase(db);

    const reopened = initDatabase({ dbPath });
    const row = reopened.prepare('SELECT id, title FROM sessions WHERE id = ?').get('s1') as { id: string; title: string } | undefined;

    expect(row?.id).toBe('s1');
    expect(row?.title).toBe('测试会话');
    closeDatabase(reopened);
  });

  it('rolls back failed transactions', () => {
    const db = initDatabase({ dbPath: createDbPath() });
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO sessions (id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('s-tx', '事务会话', 'chat', Date.now(), Date.now());
      throw new Error('boom');
    });

    expect(() => tx()).toThrow('boom');
    const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get('s-tx');

    expect(row).toBeUndefined();
    closeDatabase(db);
  });

  it('applies chunks FTS migration when available', () => {
    const db = initDatabase({ dbPath: createDbPath() });
    const columns = db.prepare('PRAGMA table_info(chunks)').all() as Array<{ name: string }>;
    const ftsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'").get();

    expect(columns.some((column) => column.name === 'content')).toBe(true);
    expect(columns.some((column) => column.name === 'source_file')).toBe(true);
    expect(ftsTable).toBeTruthy();
    closeDatabase(db);
  });
});
