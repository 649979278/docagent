/**
 * SQLite 数据库初始化和连接管理。
 * 底层使用 better-sqlite3，保留项目内既有同步包装 API。
 */

import BetterSqlite3 from 'better-sqlite3';
import { migrations as migrations001 } from './migrations/001_initial.js';
import { applyMigration002 } from './migrations/002_add_tool_name.js';
import { applyMigration003, MIGRATION_003_VERSION } from './migrations/003_workspaces_runs.js';
import { applyMigration004, MIGRATION_004_VERSION } from './migrations/004_chunks_fts.js';
import { DB_FILENAME, APP_DATA_RELATIVE_PATH } from '@workagent/shared';
import path from 'path';
import fs from 'fs';
import os from 'os';

/** SQL 字符串型迁移。 */
interface SqlMigration {
  version: number;
  sql: string;
}

/** 函数型迁移。 */
interface FnMigration {
  version: number;
  fn: (db: Database, log: (msg: string) => void, fts5Available: boolean) => void;
}

/** 迁移项。 */
type MigrationItem = SqlMigration | FnMigration;

/** 所有 migration 的有序列表。 */
const migrations: MigrationItem[] = [
  ...migrations001.map(m => ({ version: m.version, sql: m.sql } as SqlMigration)),
  { version: 2, fn: applyMigration002 } as FnMigration,
  { version: MIGRATION_003_VERSION, fn: applyMigration003 } as FnMigration,
  { version: MIGRATION_004_VERSION, fn: applyMigration004 } as FnMigration,
];

/** 数据库配置。 */
export interface DatabaseConfig {
  /** 数据库文件路径。 */
  dbPath?: string;
  /** 日志函数。 */
  log?: (message: string) => void;
}

/** 包装后的数据库实例，提供项目内统一的同步 API。 */
export class Database {
  private readonly db: BetterSqlite3.Database;
  readonly dbPath: string;

  /**
   * 创建数据库包装实例。
   * @param db - better-sqlite3 数据库实例。
   * @param dbPath - 数据库文件路径。
   */
  constructor(db: BetterSqlite3.Database, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  /**
   * 执行 SQL 语句，支持多条语句。
   * @param sql - SQL 文本。
   */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * 创建预编译语句。
   * @param sql - SQL 文本。
   * @returns 语句包装对象。
   */
  prepare(sql: string): Statement {
    return new Statement(this.db.prepare(sql));
  }

  /**
   * 创建事务函数。
   * @param fn - 事务内执行的函数。
   * @returns 可调用事务函数。
   */
  transaction(fn: () => void): () => void {
    return this.db.transaction(fn);
  }

  /**
   * 执行 PRAGMA 并返回结果。
   * @param pragma - PRAGMA 表达式，不包含 PRAGMA 关键字。
   * @returns PRAGMA 返回值。
   */
  pragma(pragma: string): unknown {
    return this.db.pragma(pragma);
  }

  /**
   * 获取底层 better-sqlite3 实例。
   * @returns 原始数据库实例。
   */
  getNativeDb(): BetterSqlite3.Database {
    return this.db;
  }

  /**
   * 关闭数据库连接。
   */
  close(): void {
    this.db.close();
  }
}

/** 预编译语句包装。 */
export class Statement {
  private readonly stmt: BetterSqlite3.Statement;

  /**
   * 创建语句包装对象。
   * @param stmt - better-sqlite3 语句。
   */
  constructor(stmt: BetterSqlite3.Statement) {
    this.stmt = stmt;
  }

  /**
   * 执行并返回所有行。
   * @param params - SQL 参数。
   * @returns 行数组。
   */
  all(...params: unknown[]): Record<string, unknown>[] {
    return this.stmt.all(...(params as never[])) as Record<string, unknown>[];
  }

  /**
   * 执行并返回第一行。
   * @param params - SQL 参数。
   * @returns 第一行或 undefined。
   */
  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this.stmt.get(...(params as never[])) as Record<string, unknown> | undefined;
  }

  /**
   * 执行写入语句并返回变更行数。
   * @param params - SQL 参数。
   * @returns 变更行数。
   */
  run(...params: unknown[]): { changes: number } {
    const info = this.stmt.run(...(params as never[]));
    return { changes: info.changes };
  }
}

/**
 * 获取默认数据库路径。
 * @returns Windows 用户目录下的 WorkAgent 数据库路径。
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
 * 初始化 SQLite 数据库连接并执行 migration。
 * @param config - 数据库配置。
 * @returns 数据库实例。
 */
export function initDatabase(config: DatabaseConfig = {}): Database {
  const dbPath = config.dbPath ?? getDefaultDbPath();
  const log = config.log ?? ((_msg: string) => { /* silent */ });

  log(`Initializing database at: ${dbPath}`);

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const nativeDb = new BetterSqlite3(dbPath);
  nativeDb.pragma('foreign_keys = ON');

  const wrappedDb = new Database(nativeDb, dbPath);
  const fts5Available = detectFts5(wrappedDb, log);

  runMigrations(wrappedDb, log, fts5Available);

  log('Database initialized successfully');
  return wrappedDb;
}

/**
 * 检测当前 SQLite 构建是否支持 FTS5。
 * @param db - 数据库实例。
 * @param log - 日志函数。
 * @returns 是否支持 FTS5。
 */
function detectFts5(db: Database, log: (msg: string) => void): boolean {
  try {
    db.exec('CREATE VIRTUAL TABLE _fts5_check USING fts5(x)');
    db.exec('DROP TABLE _fts5_check');
    return true;
  } catch {
    log('FTS5 not available, full-text search will use LIKE fallback');
    return false;
  }
}

/**
 * 执行数据库 migration。
 * @param db - 数据库实例。
 * @param log - 日志函数。
 * @param fts5Available - FTS5 是否可用。
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
      } else {
        migration.fn(db, log, fts5Available);
      }

      log(`Migration ${migration.version} applied successfully`);
    }
  }
}

/**
 * 从 SQL 中移除 FTS5 相关的完整语句块。
 * @param sql - 原始 SQL。
 * @returns 移除 FTS5 语句后的 SQL。
 */
function removeFts5Statements(sql: string): string {
  let result = sql.replace(/CREATE\s+VIRTUAL\s+TABLE[\s\S]*?USING\s+fts5[\s\S]*?\);/gi, '');
  result = result.replace(/CREATE\s+TRIGGER[\s\S]*?messages_fts[\s\S]*?END;/gi, '');
  return result;
}

/**
 * 关闭数据库连接。
 * @param db - 数据库实例。
 */
export function closeDatabase(db: Database): void {
  db.close();
}
