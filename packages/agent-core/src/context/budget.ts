/**
 * 预算式上下文分配 - 根据模式分配上下文窗口的各部分预算
 * chat模式：system(500) + history(60%) + rag(25%) + tool(15%) + completion(4096)
 * plan模式：system(500) + history(40%) + rag(45%) + tool(15%) + completion(4096)
 */

import type { ContextBudget, AgentMode } from '@workagent/shared';
import { DEFAULT_CONTEXT_LENGTH } from '@workagent/shared';

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

  const ratios = mode === 'plan' ? PLAN_RATIOS : CHAT_RATIOS;

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

/**
 * 计算当前消息列表占用的token数估算
 * @param messages - 消息内容列表
 * @returns 估算的token数
 */
export function estimateTokens(content: string): number {
  // 粗略估算：中文约1.5字/token，英文约4字/token
  // 混合文本取平均约2字/token
  return Math.ceil(content.length / 2);
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
