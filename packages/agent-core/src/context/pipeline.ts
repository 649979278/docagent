/**
 * Pipeline 辅助函数 - 对齐 Claude Code 的 per-iteration pipeline 步骤
 * 包含：compact boundary 切片、工具结果预算、上下文折叠、token 预算检查
 */

import type { Message, ContextBudget } from '@workagent/shared';
import type { QueryLoopState } from '../query-state.js';
import { estimateTokens } from './budget.js';

// ============================================================
// Compact Boundary 切片
// ============================================================

/**
 * 获取 compact boundary 之后的消息
 * 参考 Claude Code 的 getMessagesAfterCompactBoundary
 * @param state - 当前查询循环状态
 * @returns boundary 之后的消息列表
 */
export function getMessagesAfterCompactBoundary(state: QueryLoopState): Message[] {
  if (!state.lastCompactBoundaryId) return state.messages;

  const idx = state.messages.findIndex(
    m => m.compactBoundaryId === state.lastCompactBoundaryId,
  );

  return idx >= 0 ? state.messages.slice(idx + 1) : state.messages;
}

// ============================================================
// 工具结果预算
// ============================================================

/**
 * 应用工具结果预算 - 截断超出预算的工具输出
 * 参考 Claude Code 的 applyToolResultBudget
 * @param messages - 消息列表
 * @param budget - 上下文预算
 * @returns 处理后的消息列表（工具输出可能被截断）
 */
export function applyToolResultBudget(
  messages: Message[],
  budget: ContextBudget,
): Message[] {
  let toolTokensUsed = 0;

  return messages.map(msg => {
    if (msg.role === 'tool') {
      if (toolTokensUsed + msg.tokenCount > budget.toolResults) {
        // 截断此工具输出
        return {
          ...msg,
          content: `[结果已压缩: ${msg.toolCallId ?? msg.toolName ?? 'unknown'}]`,
          tokenCount: estimateTokens(`[结果已压缩: ${msg.toolCallId ?? msg.toolName ?? 'unknown'}]`),
        };
      }
      toolTokensUsed += msg.tokenCount;
    }
    return msg;
  });
}

// ============================================================
// 上下文折叠
// ============================================================

/**
 * 上下文折叠 - 合并连续的 assistant 消息（无工具调用的）
 * 参考 Claude Code 的 contextCollapse
 * @param messages - 消息列表
 * @returns 折叠后的消息列表
 */
export function contextCollapse(messages: Message[]): Message[] {
  const result: Message[] = [];

  for (const msg of messages) {
    const last = result[result.length - 1];

    if (
      last &&
      last.role === 'assistant' &&
      msg.role === 'assistant' &&
      !msg.toolCalls?.length &&
      !last.toolCalls?.length
    ) {
      // 合并连续的纯文本 assistant 消息（两侧均无 toolCalls）
      // 对齐 Claude Code：有 toolCalls 的 assistant 消息是工具调用边界，不可折叠
      result[result.length - 1] = {
        ...last,
        content: last.content + '\n' + msg.content,
        tokenCount: last.tokenCount + msg.tokenCount,
      };
    } else {
      result.push({ ...msg });
    }
  }

  return result;
}

// ============================================================
// Token 预算检查
// ============================================================

/** Token 预算检查结果 */
export interface TokenBudgetCheckResult {
  /** 是否应该停止 */
  shouldStop: boolean;
  /** 停止原因 */
  reason: string;
  /** 是否检测到收益递减 */
  diminishingReturns: boolean;
}

/**
 * 检查 token 预算 - 收益递减检测
 * 参考 Claude Code 的 checkTokenBudget
 * @param state - 当前查询循环状态
 * @param completionTokens - 本轮补全 token 数
 * @returns 预算检查结果
 */
export function checkTokenBudget(
  state: QueryLoopState,
  completionTokens: number,
): TokenBudgetCheckResult {
  // 收益递减检测：3+ 轮 + 最近两轮补全都很短
  const DIMINISHING_THRESHOLD = 500;
  const MIN_TURNS_FOR_DIMINISHING = 3;

  if (
    state.turnCount >= MIN_TURNS_FOR_DIMINISHING &&
    completionTokens < DIMINISHING_THRESHOLD
  ) {
    return {
      shouldStop: true,
      reason: `收益递减：连续 ${state.turnCount} 轮补全不足 ${DIMINISHING_THRESHOLD} tokens`,
      diminishingReturns: true,
    };
  }

  return {
    shouldStop: false,
    reason: '',
    diminishingReturns: false,
  };
}

// ============================================================
// 消息 token 估算
// ============================================================

/**
 * 估算消息列表的总 token 数
 * @param messages - 消息列表
 * @returns 估算的 token 数
 */
export function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce(
    (sum, msg) => sum + (msg.tokenCount || estimateTokens(msg.content)),
    0,
  );
}
