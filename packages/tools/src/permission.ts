/**
 * 权限代理 - 管理工具执行权限的持久化决策
 * 通过回调函数与SQLite存储交互，实现权限决策的持久化
 */

import type {
  ToolSafety,
  PermissionDecision,
  ToolContext,
} from '@workagent/shared';
import type { AgentTool } from './base.js';
import { getDefaultPermissionDecision } from './base.js';

// ============================================================
// 持久化回调类型
// ============================================================

/** 权限持久化回调 - 由外部提供SQLite交互实现 */
export interface PermissionPersistence {
  /** 保存权限决策 */
  saveDecision(toolName: string, inputPattern: string, decision: string): void;
  /** 加载权限决策列表 */
  loadDecisions(): Array<{ toolName: string; inputPattern: string; decision: string }>;
  /** 移除权限决策 */
  removeDecision(toolName: string, inputPattern: string): void;
}

// ============================================================
// 权限请求回调（用于向用户请求确认）
// ============================================================

/** 权限请求回调 - 返回用户的决策 */
export type PermissionRequestCallback = (
  toolName: string,
  input: Record<string, unknown>,
  safety: ToolSafety,
  reason: string,
) => Promise<PermissionDecision>;

// ============================================================
// PermissionBroker
// ============================================================

/**
 * 权限代理 - 管理工具权限检查和持久化
 * 自动决策规则：
 * - read_only: 自动允许
 * - write_index/write_output: 首次确认可持久化
 * - overwrite_output/command/destructive: 每次确认
 */
export class PermissionBroker {
  /** 持久化回调 */
  private persistence: PermissionPersistence;
  /** 用户确认回调 */
  private requestCallback: PermissionRequestCallback | null = null;
  /** 内存中的已缓存决策 */
  private cachedDecisions: Map<string, string> = new Map();
  /** 是否已从持久化层加载 */
  private loaded = false;

  /**
   * 创建权限代理
   * @param persistence - 持久化回调接口
   */
  constructor(persistence: PermissionPersistence) {
    this.persistence = persistence;
  }

  /**
   * 设置权限请求回调（用于向用户请求确认）
   * @param callback - 权限请求回调函数
   */
  setRequestCallback(callback: PermissionRequestCallback): void {
    this.requestCallback = callback;
  }

  /**
   * 确保已从持久化层加载决策缓存
   */
  private ensureLoaded(): void {
    if (this.loaded) return;
    const decisions = this.persistence.loadDecisions();
    for (const d of decisions) {
      this.cachedDecisions.set(`${d.toolName}:${d.inputPattern}`, d.decision);
    }
    this.loaded = true;
  }

  /**
   * 检查工具执行权限
   * @param tool - 要执行的工具
   * @param input - 工具输入参数
   * @param context - 工具执行上下文
   * @returns 权限决策结果
   */
  async check(
    tool: AgentTool,
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<PermissionDecision> {
    this.ensureLoaded();

    // 1. 先检查默认权限决策
    const defaultDecision = getDefaultPermissionDecision(
      tool.safety,
      tool.name,
      context,
    );

    // 如果默认允许，直接返回
    if (defaultDecision.allowed) {
      return defaultDecision;
    }

    // 2. 检查持久化决策缓存
    const inputPattern = this.buildInputPattern(tool.name, input);
    const cachedDecision = this.cachedDecisions.get(inputPattern);
    if (cachedDecision === 'allowed') {
      return { allowed: true, reason: '已有持久化授权' };
    }
    if (cachedDecision === 'denied') {
      return { allowed: false, reason: '已有持久化拒绝' };
    }

    // 3. 需要向用户请求确认
    if (!this.requestCallback) {
      // 无回调时，默认拒绝需要确认的操作
      return {
        allowed: false,
        reason: defaultDecision.reason ?? '无权限确认回调，默认拒绝',
      };
    }

    const userDecision = await this.requestCallback(
      tool.name,
      input,
      tool.safety,
      defaultDecision.reason ?? '',
    );

    // 4. 如果用户选择持久化决策，保存到存储
    if (userDecision.remember) {
      this.rememberDecision(
        tool.name,
        this.extractPattern(input),
        userDecision.allowed ? 'allowed' : 'denied',
      );
    }

    return userDecision;
  }

  /**
   * 持久化权限决策
   * @param toolName - 工具名称
   * @param inputPattern - 输入模式（简化的匹配键）
   * @param decision - 决策结果（'allowed' 或 'denied'）
   */
  rememberDecision(toolName: string, inputPattern: string, decision: string): void {
    const key = `${toolName}:${inputPattern}`;
    this.cachedDecisions.set(key, decision);
    this.persistence.saveDecision(toolName, inputPattern, decision);
  }

  /**
   * 获取所有已存储的权限决策
   * @returns 决策映射（toolName:inputPattern -> decision）
   */
  getStoredDecisions(): Map<string, string> {
    this.ensureLoaded();
    return new Map(this.cachedDecisions);
  }

  /**
   * 移除指定的权限决策
   * @param toolName - 工具名称
   * @param inputPattern - 输入模式
   */
  removeDecision(toolName: string, inputPattern: string): void {
    const key = `${toolName}:${inputPattern}`;
    this.cachedDecisions.delete(key);
    this.persistence.removeDecision(toolName, inputPattern);
  }

  /**
   * 构建输入模式的缓存键
   * @param toolName - 工具名称
   * @param input - 工具输入
   * @returns 缓存键
   */
  private buildInputPattern(toolName: string, input: Record<string, unknown>): string {
    return `${toolName}:${this.extractPattern(input)}`;
  }

  /**
   * 从输入中提取简化的匹配模式
   * 使用工具名称+输入的顶层键作为模式
   * @param input - 工具输入
   * @returns 模式字符串
   */
  private extractPattern(input: Record<string, unknown>): string {
    const keys = Object.keys(input).sort();
    return keys.join(',');
  }
}
