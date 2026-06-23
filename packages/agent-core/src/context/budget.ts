/**
 * 预算式上下文分配 - 根据模式分配上下文窗口的各部分预算
 * chat模式：system(500) + history(60%) + rag(25%) + tool(15%) + completion(4096)
 * plan模式：system(500) + history(40%) + rag(45%) + tool(15%) + completion(4096)
 * execute模式：system(500) + history(55%) + rag(25%) + tool(20%) + completion(4096)
 */

import type { ContextBudget, AgentMode } from '@workagent/shared';
import { DEFAULT_CONTEXT_LENGTH, countTokens } from '@workagent/shared';

// ============================================================
// 预算分配常量
// ============================================================

/** 系统提示固定token数 */
const SYSTEM_PROMPT_TOKENS = 500;

/** 最大补全token数 */
const MAX_COMPLETION_TOKENS = 4096;

/** chat模式各部分占比 */
const CHAT_RATIOS = {
  conversationHistory: 0.60,
  ragResults: 0.25,
  toolResults: 0.15,
};

/** plan模式各部分占比 */
const PLAN_RATIOS = {
  conversationHistory: 0.40,
  ragResults: 0.45,
  toolResults: 0.15,
};

/** execute模式各部分占比 — 执行模式需要更多工具空间 */
const EXECUTE_RATIOS = {
  conversationHistory: 0.55,
  ragResults: 0.25,
  toolResults: 0.20,
};

/** 预算分配优先级：system > compact_summary > plan > memory > RAG > tool_replay > history > completion */
export const BUDGET_PRIORITY = [
  'system',
  'compact_summary',
  'plan',
  'memory',
  'rag',
  'tool_replay',
  'history',
  'completion',
] as const;

/** 预算优先级类型 */
export type BudgetPriorityItem = typeof BUDGET_PRIORITY[number];

// ============================================================
// 预算分配函数
// ============================================================

/**
 * 根据上下文长度和模式分配预算
 * @param contextLength - 模型上下文窗口大小
 * @param mode - Agent运行模式
 * @returns 上下文预算分配方案
 */
export function allocateBudget(
  contextLength: number = DEFAULT_CONTEXT_LENGTH,
  mode: AgentMode,
): ContextBudget {
  // 可用上下文 = 总上下文 - 系统提示 - 补全预留
  const availableTokens = contextLength - SYSTEM_PROMPT_TOKENS - MAX_COMPLETION_TOKENS;

  // 安全检查：确保可用token为正数
  const safeAvailable = Math.max(availableTokens, contextLength * 0.2);

  const ratios = mode === 'plan' ? PLAN_RATIOS : mode === 'execute' ? EXECUTE_RATIOS : CHAT_RATIOS;

  const conversationHistory = Math.floor(safeAvailable * ratios.conversationHistory);
  const ragResults = Math.floor(safeAvailable * ratios.ragResults);
  const toolResults = Math.floor(safeAvailable * ratios.toolResults);

  // 确保总和不超过可用token数
  const allocated = conversationHistory + ragResults + toolResults;
  const adjustment = allocated > safeAvailable ? allocated - safeAvailable : 0;

  return {
    systemPrompt: SYSTEM_PROMPT_TOKENS,
    conversationHistory: conversationHistory - Math.ceil(adjustment * ratios.conversationHistory),
    ragResults: ragResults - Math.ceil(adjustment * ratios.ragResults),
    toolResults: toolResults - Math.ceil(adjustment * ratios.toolResults),
    maxCompletionTokens: MAX_COMPLETION_TOKENS,
    total: contextLength,
  };
}

// ============================================================
// BudgetManager 动态化
// ============================================================

/**
 * 动态预算管理器 - 运行时按优先级动态调整各部分预算
 * 保留 allocateBudget() 纯函数作为默认实现，BudgetManager 在其基础上支持运行时动态借用
 */
export class BudgetManager {
  /** 模型上下文长度 */
  private contextLength: number;
  /** Agent运行模式 */
  private mode: AgentMode;
  /** 当前分配的预算 */
  private allocated: ContextBudget;
  /** 各优先级实际使用量 */
  private usage: Record<BudgetPriorityItem, number>;

  /**
   * 创建动态预算管理器
   * @param contextLength - 模型上下文长度
   * @param mode - Agent运行模式
   */
  constructor(contextLength: number, mode: AgentMode) {
    this.contextLength = contextLength;
    this.mode = mode;
    this.allocated = allocateBudget(contextLength, mode);
    this.usage = {
      system: 0,
      compact_summary: 0,
      plan: 0,
      memory: 0,
      rag: 0,
      tool_replay: 0,
      history: 0,
      completion: 0,
    };
  }

  /**
   * 预留系统 prompt token — 从 history 借用
   * @param tokens - 实际系统 prompt 占用 token 数
   * @returns 调整后的预算
   */
  reserveSystem(tokens: number): ContextBudget {
    const diff = tokens - this.allocated.systemPrompt;
    if (diff > 0) {
      // 系统提示超出默认值，从 history 借用
      this.allocated = {
        ...this.allocated,
        systemPrompt: tokens,
        conversationHistory: Math.max(0, this.allocated.conversationHistory - diff),
      };
    }
    this.usage.system = tokens;
    return { ...this.allocated };
  }

  /**
   * 预留 RAG 注入 token — 从 history 借用
   * @param tokens - RAG 实际注入 token 数
   * @returns 调整后的预算
   */
  reserveRag(tokens: number): ContextBudget {
    const diff = tokens - this.allocated.ragResults;
    if (diff > 0) {
      // RAG 注入超出默认分配，从 history 借用
      this.allocated = {
        ...this.allocated,
        ragResults: tokens,
        conversationHistory: Math.max(0, this.allocated.conversationHistory - diff),
      };
    }
    this.usage.rag = tokens;
    return { ...this.allocated };
  }

  /**
   * 预留工具回放 token — 从 history 借用
   * @param tokens - 工具结果实际占用 token 数
   * @returns 调整后的预算
   */
  reserveToolReplay(tokens: number): ContextBudget {
    const diff = tokens - this.allocated.toolResults;
    if (diff > 0) {
      // 工具结果超出默认分配，从 history 借用
      this.allocated = {
        ...this.allocated,
        toolResults: tokens,
        conversationHistory: Math.max(0, this.allocated.conversationHistory - diff),
      };
    }
    this.usage.tool_replay = tokens;
    return { ...this.allocated };
  }

  /**
   * 预留补全 token — 固定保留
   * @param tokens - 需要预留的补全 token 数
   * @returns 调整后的预算
   */
  reserveCompletion(tokens: number): ContextBudget {
    const diff = tokens - this.allocated.maxCompletionTokens;
    if (diff > 0) {
      // 补全需要更多，从 history 借用
      this.allocated = {
        ...this.allocated,
        maxCompletionTokens: tokens,
        conversationHistory: Math.max(0, this.allocated.conversationHistory - diff),
      };
    }
    this.usage.completion = tokens;
    return { ...this.allocated };
  }

  /**
   * 按优先级一次性分配 — 高优先级优先满足，低优先级使用剩余
   * 优先级：system > rag > tool > history
   * @param system - 系统 prompt 实际占用
   * @param rag - RAG 注入实际占用
   * @param tool - 工具结果实际占用
   * @returns 最终预算分配
   */
  allocateWithPriority(system: number, rag: number, tool: number): ContextBudget {
    let remaining = this.contextLength - MAX_COMPLETION_TOKENS;

    // 按 priority 顺序分配
    const s = Math.min(system, remaining);
    remaining -= s;

    const r = Math.min(rag, remaining);
    remaining -= r;

    const t = Math.min(tool, remaining);
    remaining -= t;

    // history 使用剩余
    const h = Math.max(0, remaining);

    this.allocated = {
      systemPrompt: s,
      conversationHistory: h,
      ragResults: r,
      toolResults: t,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
      total: this.contextLength,
    };

    this.usage.system = s;
    this.usage.rag = r;
    this.usage.tool_replay = t;
    this.usage.history = h;

    return { ...this.allocated };
  }

  /**
   * 获取当前预算分配
   * @returns 当前上下文预算
   */
  getBudget(): ContextBudget {
    return { ...this.allocated };
  }

  /**
   * 获取各优先级实际使用量
   * @returns 优先级使用量映射
   */
  getUsage(): Record<BudgetPriorityItem, number> {
    return { ...this.usage };
  }

  /**
   * 计算剩余可用的 conversationHistory token
   * @returns 剩余可用 history token 数
   */
  getRemainingHistoryTokens(): number {
    return this.allocated.conversationHistory - this.usage.history;
  }
}

/**
 * 计算当前消息列表占用的token数估算
 * @param messages - 消息内容列表
 * @returns 估算的token数
 */
export function estimateTokens(content: string): number {
  return countTokens(content);
}

/**
 * 检查上下文使用率是否超过阈值
 * @param usedTokens - 已使用的token数
 * @param totalTokens - 总可用token数
 * @param threshold - 阈值（0-1），默认0.75
 * @returns 是否超过阈值
 */
export function isOverThreshold(
  usedTokens: number,
  totalTokens: number,
  threshold: number = 0.75,
): boolean {
  return usedTokens / totalTokens > threshold;
}

/**
 * 根据预算截断RAG片段列表
 * @param chunks - RAG片段内容列表
 * @param budgetTokens - RAG预算token数
 * @returns 截断后的片段列表和使用的token数
 */
export function truncateRagChunks(
  chunks: Array<{ content: string }>,
  budgetTokens: number,
): { chunks: Array<{ content: string }>; usedTokens: number } {
  let usedTokens = 0;
  const result: Array<{ content: string }> = [];

  for (const chunk of chunks) {
    const tokens = estimateTokens(chunk.content);
    if (usedTokens + tokens > budgetTokens) {
      break;
    }
    usedTokens += tokens;
    result.push(chunk);
  }

  return { chunks: result, usedTokens };
}
