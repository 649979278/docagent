/**
 * 显式记忆管理 - 从SQLite加载/保存用户偏好和约束
 * 记忆类型包括：用户要求、风格偏好、格式约束、禁用表达、自定义术语
 */

import type { Database } from '@workagent/store';
import type { Memory, MemoryType } from '@workagent/shared';

// ============================================================
// 记忆管理器
// ============================================================

/**
 * 显式记忆管理器 - 管理从SQLite加载和保存的用户偏好
 * 记忆用于在上下文中注入用户的长期偏好和约束
 */
export class MemoryManager {
  /** 数据库实例 */
  private db: Database;
  /** 内存缓存 */
  private cache: Map<string, Memory> = new Map();
  /** 是否已加载 */
  private loaded = false;

  /**
   * 创建记忆管理器
   * @param db - 数据库实例
   */
  constructor(db: Database) {
    this.db = db;
  }

  /**
   * 从数据库加载所有启用的记忆
   * @returns 加载的记忆列表
   */
  loadMemories(): Memory[] {
    this.cache.clear();

    const rows = this.db.prepare(
      `SELECT id, type, content, source, enabled, created_at as createdAt
       FROM memories WHERE enabled = 1
       ORDER BY created_at ASC`,
    ).all();

    const memories: Memory[] = [];
    for (const row of rows) {
      const memory: Memory = {
        id: row.id as string,
        type: row.type as MemoryType,
        content: row.content as string,
        source: row.source as string,
        enabled: Boolean(row.enabled),
        createdAt: row.createdAt as number,
      };
      this.cache.set(memory.id, memory);
      memories.push(memory);
    }

    this.loaded = true;
    return memories;
  }

  /**
   * 保存一条记忆到数据库
   * @param memory - 记忆内容
   */
  saveMemory(memory: Memory): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO memories (id, type, content, source, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      memory.id,
      memory.type,
      memory.content,
      memory.source,
      memory.enabled ? 1 : 0,
      memory.createdAt,
    );

    this.cache.set(memory.id, memory);
  }

  /**
   * 更新记忆的启用状态
   * @param id - 记忆ID
   * @param enabled - 是否启用
   */
  setEnabled(id: string, enabled: boolean): void {
    this.db.prepare(
      'UPDATE memories SET enabled = ? WHERE id = ?',
    ).run(enabled ? 1 : 0, id);

    const memory = this.cache.get(id);
    if (memory) {
      memory.enabled = enabled;
      this.cache.set(id, memory);
    }
  }

  /**
   * 获取所有记忆（包括禁用的）
   * @returns 记忆列表
   */
  getAllMemories(): Memory[] {
    if (!this.loaded) {
      return this.loadMemories();
    }
    return Array.from(this.cache.values());
  }

  /**
   * 获取指定类型的记忆
   * @param type - 记忆类型
   * @returns 该类型的记忆列表
   */
  getMemoriesByType(type: MemoryType): Memory[] {
    if (!this.loaded) {
      this.loadMemories();
    }
    return Array.from(this.cache.values()).filter((m) => m.type === type);
  }

  /**
   * 将记忆格式化为系统提示注入文本
   * @param memories - 记忆列表
   * @returns 格式化后的提示文本
   */
  formatMemoriesForPrompt(memories?: Memory[]): string {
    const list = memories ?? this.getEnabledMemories();
    if (list.length === 0) return '';

    const parts = list.map((m) => {
      const typeLabel = {
        user_requirement: '用户要求',
        style_preference: '风格偏好',
        format_constraint: '格式约束',
        banned_expression: '禁用表达',
        custom_terminology: '自定义术语',
      }[m.type];
      return `- [${typeLabel}] ${m.content}`;
    });

    return `## 用户偏好和约束\n\n${parts.join('\n')}`;
  }

  /**
   * 获取所有启用的记忆
   * @returns 启用的记忆列表
   */
  private getEnabledMemories(): Memory[] {
    if (!this.loaded) {
      this.loadMemories();
    }
    return Array.from(this.cache.values()).filter((m) => m.enabled);
  }
}
