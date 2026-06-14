/**
 * SQLite数据库初始化和连接管理
 * 使用sql.js（纯JS的SQLite实现，无需native编译）
 */

import initSqlJs from 'sql.js';
import { migrations as migrations001 } from './migrations/001_initial.js';
import { applyMigration002 } from './migrations/002_add_tool_name.js';
import { applyMigration003, MIGRATION_003_VERSION } from './migrations/003_workspaces_runs.js';
import { applyMigration004, MIGRATION_004_VERSION } from './migrations/004_chunks_fts.js';
import { DB_FILENAME, APP_DATA_RELATIVE_PATH } from '@workagent/shared';
import path from 'path';
import fs from 'fs';
import os from 'os';

/** SQL字符串型迁移 */
interface SqlMigration {
  version: number;
  sql: string;
}

/** 函数型迁移（需要自定义逻辑，如忽略"列已存在"错误） */
interface FnMigration {
  version: number;
  fn: (db: Database, log: (msg: string) => void, fts5Available: boolean) => void;
}

/** 迁移项 */
type MigrationItem = SqlMigration | FnMigration;

/** 所有migration的有序列表 */
const migrations: MigrationItem[] = [
  ...migrations001.map(m => ({ version: m.version, sql: m.sql } as SqlMigration)),
  { version: 2, fn: applyMigration002 } as FnMigration,
  { version: MIGRATION_003_VERSION, fn: applyMigration003 } as FnMigration,
  { version: MIGRATION_004_VERSION, fn: applyMigration004 } as FnMigration,
];

/** 数据库配置 */
export interface DatabaseConfig {
  /** 数据库文件路径 */
  dbPath?: string;
  /** 日志函数 */
  log?: (message: string) => void;
}

/** 包装后的数据库实例，提供类better-sqlite3的同步API */
export class Database {
  private db: any;
  private dbPath: string;

  constructor(db: any, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  /** 执行SQL语句（无返回值），支持多条语句 */
  exec(sql: string): void {
    // sql.js的db.exec()可以执行多条SQL语句（用分号分隔）
    // 它返回结果数组，但我们对返回值不感兴趣
    this.db.exec(sql);
  }

  /** 执行参数化查询，返回所有行 */
  prepare(sql: string): Statement {
    return new Statement(this.db, sql);
  }

  /** 执行事务 */
  transaction(fn: () => void): () => void {
    return () => {
      this.db.run('BEGIN TRANSACTION');
      try {
        fn();
        this.db.run('COMMIT');
      } catch (e) {
        try { this.db.run('ROLLBACK'); } catch { /* ignore if already rolled back */ }
        throw e;
      }
    };
  }

  /** 执行pragma */
  pragma(pragma: string): void {
    this.db.run(`PRAGMA ${pragma}`);
  }

  /** 保存数据库到磁盘 */
  save(): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  /** 关闭数据库 */
  close(): void {
    this.save();
    this.db.close();
  }

  /** 获取底层sql.js实例（高级用法） */
  getSqlJsDb(): any {
    return this.db;
  }
}

/** 预编译语句 */
export class Statement {
  private db: any;
  private sql: string;

  constructor(db: any, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  /** 执行并返回所有行 */
  all(...params: unknown[]): Record<string, unknown>[] {
    // sql.js使用bind参数
    const stmt = this.db.prepare(this.sql);
    if (params.length > 0) {
      stmt.bind(params);
    }
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  /** 执行并返回第一行 */
  get(...params: unknown[]): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(this.sql);
    if (params.length > 0) {
      stmt.bind(params);
    }
    let row: Record<string, unknown> | undefined;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();
    return row;
  }

  /** 执行并返回变更行数 */
  run(...params: unknown[]): { changes: number } {
    this.db.run(this.sql, params as string[]);
    return { changes: this.db.getRowsModified() };
  }
}

/**
 * 获取默认数据库路径
 * Windows: %USERPROFILE%/WorkAgent/workagent.db
 */
export function getDefaultDbPath(): string {
  const homeDir = os.homedir();
  const dataDir = path.join(homeDir, APP_DATA_RELATIVE_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, DB_FILENAME);
}

/**
 * 初始化SQLite数据库连接并执行migration
 */
export async function initDatabase(config: DatabaseConfig = {}): Promise<Database> {
  const dbPath = config.dbPath ?? getDefaultDbPath();
  const log = config.log ?? ((_msg: string) => { /* silent */ });

  log(`Initializing database at: ${dbPath}`);

  // 确保目录存在
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 初始化sql.js
  const SQL = await initSqlJs();

  // 如果已有数据库文件，加载它
  let db: any;
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(new Uint8Array(buffer as any));
  } else {
    db = new SQL.Database();
  }

  // 启用外键约束
  db.run('PRAGMA foreign_keys = ON');

  const wrappedDb = new Database(db, dbPath);

  // 检测FTS5是否可用
  let fts5Available = false;
  try {
    db.run('CREATE VIRTUAL TABLE _fts5_check USING fts5(x)');
    db.run('DROP TABLE _fts5_check');
    fts5Available = true;
  } catch {
    fts5Available = false;
    log('FTS5 not available, full-text search will use LIKE fallback');
  }

  // 执行migration
  runMigrations(wrappedDb, log, fts5Available);

  log('Database initialized successfully');
  return wrappedDb;
}

/**
 * 执行数据库migration
 * @param fts5Available - FTS5是否可用，不可用时跳过相关语句
 */
function runMigrations(db: Database, log: (msg: string) => void, fts5Available: boolean): void {
  let currentVersion = 0;
  try {
    const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null } | undefined;
    currentVersion = row?.version ?? 0;
  } catch {
    currentVersion = 0;
  }

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      log(`Applying migration ${migration.version}...`);

      if ('sql' in migration) {
        const sql = fts5Available ? migration.sql : removeFts5Statements(migration.sql);
        db.exec(sql);
      } else if ('fn' in migration) {
        migration.fn(db, log, fts5Available);
      }

      log(`Migration ${migration.version} applied successfully`);
    }
  }
}

/**
 * 从SQL中移除FTS5相关的完整语句块
 */
function removeFts5Statements(sql: string): string {
  // 移除CREATE VIRTUAL TABLE...USING fts5(...); 跨行
  let result = sql.replace(/CREATE\s+VIRTUAL\s+TABLE[\s\S]*?USING\s+fts5[\s\S]*?\);/gi, '');
  // 移除CREATE TRIGGER...messages_fts...END;
  result = result.replace(/CREATE\s+TRIGGER[\s\S]*?messages_fts[\s\S]*?END;/gi, '');
  return result;
}

/**
 * 关闭数据库连接
 */
export function closeDatabase(db: Database): void {
  db.close();
}
