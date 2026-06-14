/**
 * Diagnostics 收集器 - 每轮记录 prompt 诊断数据
 * 对齐 Claude Code 的 per-turn diagnostics 模式
 * 在 runTurn 开头创建，pipeline 各步骤调用 record*()，runTurn 结束时调用 persist()
 */

import type { PromptDiagnostics, RunTerminalReason } from '@workagent/shared';
import type { Database } from '@workagent/store';

// ============================================================
// DiagnosticsCollector
// ============================================================

/**
 * Prompt 诊断收集器
 * 职责：
 * 1. 在 pipeline 各步骤中记录关键诊断数据
 * 2. 在 runTurn 结束时将诊断数据持久化到 agent_runs.diagnostics_json
 * 3. 提供实时诊断数据查询
 */
export class DiagnosticsCollector {
  /** 诊断数据 */
  private data: PromptDiagnostics;

  /** 构造函数 — 初始化所有字段为零值/空值 */
  constructor() {
    this.data = {
      triggeredSections: [],
      historyTokens: 0,
      ragTokens: 0,
      toolTokens: 0,
      completionTokens: 0,
      hadToolCall: false,
      toolParseFailed: false,
      compactOccurred: false,
      compactFreedTokens: 0,
      terminalReason: null,
      planTransition: null,
      ragHitCount: 0,
      ragInjectedTokens: 0,
    };
  }

  /**
   * 记录触发的 prompt section
   * @param section - 触发的 section 名称
   */
  recordSection(section: string): void {
    if (!this.data.triggeredSections.includes(section)) {
      this.data.triggeredSections.push(section);
    }
  }

  /**
   * 记录各段 token 占用
   * @param history - 历史 token 数
   * @param rag - RAG token 数
   * @param tool - 工具 token 数
   * @param completion - 补全 token 数
   */
  recordTokenUsage(history: number, rag: number, tool: number, completion: number): void {
    this.data.historyTokens += history;
    this.data.ragTokens += rag;
    this.data.toolTokens += tool;
    this.data.completionTokens += completion;
  }

  /**
   * 记录工具调用
   * @param hadCall - 是否有工具调用
   * @param parseFailed - 工具调用解析是否失败
   */
  recordToolCall(hadCall: boolean, parseFailed: boolean): void {
    this.data.hadToolCall = hadCall || this.data.hadToolCall;
    this.data.toolParseFailed = parseFailed || this.data.toolParseFailed;
  }

  /**
   * 记录压缩
   * @param occurred - 是否发生压缩
   * @param freedTokens - 释放的 token 数
   */
  recordCompact(occurred: boolean, freedTokens: number): void {
    if (occurred) {
      this.data.compactOccurred = true;
      this.data.compactFreedTokens += freedTokens;
    }
  }

  /**
   * 记录终止原因
   * @param reason - 运行终止原因
   */
  recordTerminal(reason: RunTerminalReason): void {
    this.data.terminalReason = reason;
  }

  /**
   * 记录计划转换
   * @param transition - 计划阶段转换描述
   */
  recordPlanTransition(transition: string): void {
    this.data.planTransition = transition;
  }

  /**
   * 记录 RAG 注入
   * @param hitCount - 命中的片段数
   * @param injectedTokens - 注入的 token 数
   */
  recordRag(hitCount: number, injectedTokens: number): void {
    this.data.ragHitCount += hitCount;
    this.data.ragInjectedTokens += injectedTokens;
  }

  /**
   * 获取诊断数据（不可变副本）
   * @returns 当前诊断数据的深拷贝
   */
  getData(): PromptDiagnostics {
    return {
      ...this.data,
      triggeredSections: [...this.data.triggeredSections],
    };
  }

  /**
   * 持久化诊断数据到 DB
   * 在 runTurn 结束时调用
   * @param db - 数据库实例
   * @param runId - Agent Run ID
   */
  persist(db: Database, runId: string): void {
    try {
      const stmt = db.prepare(
        'UPDATE agent_runs SET diagnostics_json = ? WHERE id = ?',
      );
      stmt.run(JSON.stringify(this.data), runId);
    } catch {
      // 持久化失败不应阻塞主流程
    }
  }

  /**
   * 重置诊断数据（新轮次开始时）
   */
  reset(): void {
    this.data = {
      triggeredSections: [],
      historyTokens: 0,
      ragTokens: 0,
      toolTokens: 0,
      completionTokens: 0,
      hadToolCall: false,
      toolParseFailed: false,
      compactOccurred: false,
      compactFreedTokens: 0,
      terminalReason: null,
      planTransition: null,
      ragHitCount: 0,
      ragInjectedTokens: 0,
    };
  }
}
