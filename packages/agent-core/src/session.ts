/**
 * 会话编排器 - 管理会话生命周期
 * 协调AgentRuntime和Store，处理会话的创建/加载/保存/切换
 */

import type { AgentMode, PlanPhase, ConversationContext } from '@workagent/shared';
import type { Database } from '@workagent/store';
import {
  createSession,
  getSession,
  listSessions,
  updateSession,
  deleteSession,
} from '@workagent/store';
import type { SessionRecord } from '@workagent/store';
import type { AgentRuntime } from './runtime.js';
import { PlanModeController } from './plan-controller.js';

// ============================================================
// 会话状态
// ============================================================

/** 会话运行时状态 */
export interface SessionState {
  /** 会话记录 */
  record: SessionRecord;
  /** 当前Agent运行时（如果活跃） */
  runtime: AgentRuntime | null;
  /** 是否活跃 */
  active: boolean;
}

// ============================================================
// SessionOrchestrator
// ============================================================

/**
 * 会话编排器 - 管理会话的完整生命周期
 * 协调AgentRuntime和Store的交互
 */
export class SessionOrchestrator {
  /** 数据库实例 */
  private db: Database;
  /** 活跃会话映射 */
  private sessions: Map<string, SessionState> = new Map();
  /** 当前活跃会话ID */
  private currentSessionId: string | null = null;

  /**
   * 创建会话编排器
   * @param db - 数据库实例
   */
  constructor(db: Database) {
    this.db = db;
  }

  /**
   * 创建新会话
   * @param title - 会话标题
   * @param mode - 初始模式
   * @returns 创建的会话记录
   */
  create(title: string, mode: AgentMode = 'chat'): SessionRecord {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = createSession(this.db, { id, title, mode });

    this.sessions.set(id, {
      record,
      runtime: null,
      active: false,
    });

    return record;
  }

  /**
   * 加载已有会话
   * @param sessionId - 会话ID
   * @returns 会话记录，不存在返回undefined
   */
  load(sessionId: string): SessionRecord | undefined {
    // 先检查缓存
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!.record;
    }

    // 从数据库加载
    const record = getSession(this.db, sessionId);
    if (!record) return undefined;

    this.sessions.set(sessionId, {
      record,
      runtime: null,
      active: false,
    });

    return record;
  }

  /**
   * 保存会话状态
   * @param sessionId - 会话ID
   */
  save(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    updateSession(this.db, sessionId, {
      title: state.record.title,
      mode: state.record.mode,
      activePlanId: state.record.activePlanId,
      summary: state.record.summary,
    });
  }

  /**
   * 切换到指定会话
   * @param sessionId - 目标会话ID
   * @returns 是否切换成功
   */
  switchTo(sessionId: string): boolean {
    // 先保存当前会话
    if (this.currentSessionId) {
      this.save(this.currentSessionId);
      this.deactivate(this.currentSessionId);
    }

    // 加载目标会话
    const record = this.load(sessionId);
    if (!record) return false;

    this.currentSessionId = sessionId;
    const state = this.sessions.get(sessionId)!;
    state.active = true;

    return true;
  }

  /**
   * 删除会话
   * @param sessionId - 会话ID
   */
  remove(sessionId: string): void {
    // 先停用
    this.deactivate(sessionId);

    // 从数据库删除
    deleteSession(this.db, sessionId);

    // 从缓存中移除
    this.sessions.delete(sessionId);

    // 如果是当前会话，清空
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
    }
  }

  /**
   * 列出所有会话
   * @param limit - 返回数量限制
   * @param offset - 偏移量
   * @returns 会话记录列表
   */
  list(limit = 50, offset = 0): SessionRecord[] {
    return listSessions(this.db, limit, offset);
  }

  /**
   * 获取当前活跃会话
   * @returns 当前会话状态，或null
   */
  getCurrentSession(): SessionState | null {
    if (!this.currentSessionId) return null;
    return this.sessions.get(this.currentSessionId) ?? null;
  }

  /**
   * 获取当前会话ID
   * @returns 当前会话ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 绑定Agent运行时到会话
   * @param sessionId - 会话ID
   * @param runtime - Agent运行时实例
   */
  bindRuntime(sessionId: string, runtime: AgentRuntime): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.runtime = runtime;
  }

  /**
   * 更新会话模式
   * @param sessionId - 会话ID
   * @param mode - 新的Agent模式
   */
  updateMode(sessionId: string, mode: AgentMode): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.record.mode = mode;
    updateSession(this.db, sessionId, { mode });
  }

  /**
   * 更新会话摘要
   * @param sessionId - 会话ID
   * @param summary - 摘要文本
   */
  updateSummary(sessionId: string, summary: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.record.summary = summary;
    updateSession(this.db, sessionId, { summary });
  }

  /**
   * 停用会话
   * @param sessionId - 会话ID
   */
  private deactivate(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.active = false;
    state.runtime = null;
  }
}
