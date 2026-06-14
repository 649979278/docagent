/**
 * 模型配置CRUD操作
 * 管理模型选择、温度、最大token等配置项
 */

import type { Database } from './database.js';

/** 配置记录 */
export interface SettingRecord {
  key: string;
  valueJson: string;
  updatedAt: number;
}

/**
 * 获取配置项
 * @param db - 数据库实例
 * @param key - 配置键
 * @param defaultValue - 默认值（配置不存在时返回）
 * @returns 配置值
 */
export function getSetting<T = unknown>(db: Database, key: string, defaultValue?: T): T {
  const row = db.prepare(
    'SELECT value_json as valueJson FROM model_config WHERE key = ?',
  ).get(key) as unknown as { valueJson: string } | undefined;

  if (!row) {
    return defaultValue as T;
  }

  try {
    return JSON.parse(row.valueJson) as T;
  } catch {
    return defaultValue as T;
  }
}

/**
 * 设置配置项
 * @param db - 数据库实例
 * @param key - 配置键
 * @param value - 配置值（将序列化为JSON）
 */
export function setSetting(db: Database, key: string, value: unknown): void {
  const now = Date.now();
  const valueJson = JSON.stringify(value);
  db.prepare(
    'INSERT OR REPLACE INTO model_config (key, value_json, updated_at) VALUES (?, ?, ?)',
  ).run(key, valueJson, now);
}

/**
 * 获取所有配置
 * @param db - 数据库实例
 * @returns 配置记录列表
 */
export function listSettings(db: Database): SettingRecord[] {
  return db.prepare(
    'SELECT key, value_json as valueJson, updated_at as updatedAt FROM model_config ORDER BY key',
  ).all() as unknown as SettingRecord[];
}

/**
 * 删除配置项
 * @param db - 数据库实例
 * @param key - 配置键
 */
export function deleteSetting(db: Database, key: string): void {
  db.prepare('DELETE FROM model_config WHERE key = ?').run(key);
}
