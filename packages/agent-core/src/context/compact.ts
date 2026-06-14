/**
 * 上下文压缩入口 - 协调微压缩和摘要压缩
 * Level1: microCompact (清理过时tool_result)
 * Level2: summaryCompact (LLM摘要)
 * reactiveCompact: 上下文超限时立即summaryCompact后重试
 */

import type { Message, Memory, ContextBudget } from '@workagent/shared';
import { COMPACT_THRESHOLD } from '@workagent/shared';
import type { ModelProvider } from '@workagent/model-provider';
import type { CompactResult } from '../state.js';
import { microCompact } from './microCompact.js';
import { summaryCompact } from './summaryCompact.js';
import { estimateTokens, isOverThreshold } from './budget.js';

// ============================================================
// 压缩决策
// ============================================================

/** 压缩需求评估结果 */
interface CompactAssessment {
  /** 是否需要压缩 */
  needed: boolean;
  /** 建议的压缩级别 */
  level: 1 | 2;
  /** 原因 */
  reason: string;
}

// ============================================================
// 压缩入口函数
// ============================================================

/**
 * 评估是否需要压缩上下文
 * @param messages - 当前消息列表
 * @param budget - 上下文预算
 * @returns 压缩评估结果
 */
export function assessCompactNeed(
  messages: Message[],
  budget: ContextBudget | null,
): CompactAssessment {
  const usedTokens = estimateMessagesTokens(messages);
  const totalBudget = budget?.total ?? 32768;

  // 检查是否超过阈值
  if (!isOverThreshold(usedTokens, totalBudget, COMPACT_THRESHOLD)) {
    return { needed: false, level: 1, reason: '上下文使用率未超过阈值' };
  }

  // 计算使用率
  const usage = usedTokens / totalBudget;

  if (usage > 0.9) {
    return {
      needed: true,
      level: 2,
      reason: `上下文使用率${(usage * 100).toFixed(1)}%，超过90%，需要摘要压缩`,
    };
  }

  if (usage > COMPACT_THRESHOLD) {
    return {
      needed: true,
      level: 1,
      reason: `上下文使用率${(usage * 100).toFixed(1)}%，超过${(COMPACT_THRESHOLD * 100).toFixed(0)}%，先尝试微压缩`,
    };
  }

  return { needed: false, level: 1, reason: '' };
}

/**
 * 执行上下文压缩
 * 根据评估结果选择压缩级别：
 * - Level 1: microCompact（清理过时tool_result，截断长输出）
 * - Level 2: summaryCompact（LLM生成结构化摘要）
 * @param messages - 当前消息列表
 * @param provider - 模型提供者
 * @param memories - 显式记忆列表
 * @param budget - 上下文预算
 * @param preferredLevel - 优先使用的压缩级别（reactive压缩时指定）
 * @returns 压缩结果
 */
export async function compactContext(
  messages: Message[],
  provider: ModelProvider,
  memories: Memory[] = [],
  budget: ContextBudget | null = null,
  preferredLevel?: 1 | 2,
): Promise<CompactResult> {
  // 如果指定了优先级别，直接使用
  const assessment = preferredLevel
    ? { needed: true, level: preferredLevel, reason: '指定压缩级别' }
    : assessCompactNeed(messages, budget);

  if (!assessment.needed) {
    return {
      level: 1,
      strategy: 'micro',
      freedTokens: 0,
      messages,
      summary: null,
    };
  }

  // Level 1: 微压缩
  if (assessment.level === 1) {
    const microResult = microCompact(messages);

    // 如果微压缩后仍然超过阈值，升级到Level 2
    const usedAfter = estimateMessagesTokens(microResult.messages);
    const totalBudget = budget?.total ?? 32768;
    if (isOverThreshold(usedAfter, totalBudget, COMPACT_THRESHOLD)) {
      const summaryResult = await summaryCompact(microResult.messages, provider, memories);
      return {
        level: 2,
        strategy: 'summary',
        freedTokens: microResult.freedTokens + summaryResult.freedTokens,
        messages: summaryResult.messages,
        summary: summaryResult.summary,
      };
    }

    return {
      level: 1,
      strategy: 'micro',
      freedTokens: microResult.freedTokens,
      messages: microResult.messages,
      summary: null,
    };
  }

  // Level 2: 摘要压缩
  const summaryResult = await summaryCompact(messages, provider, memories);
  return {
    level: 2,
    strategy: 'summary',
    freedTokens: summaryResult.freedTokens,
    messages: summaryResult.messages,
    summary: summaryResult.summary,
  };
}

/**
 * 响应式压缩 - 上下文超限时立即执行摘要压缩
 * 当模型返回上下文超限错误时调用
 * @param messages - 当前消息列表
 * @param provider - 模型提供者
 * @param memories - 显式记忆列表
 * @returns 压缩结果
 */
export async function reactiveCompact(
  messages: Message[],
  provider: ModelProvider,
  memories: Memory[] = [],
): Promise<CompactResult> {
  // 直接执行Level 2摘要压缩
  return compactContext(messages, provider, memories, null, 2);
}

/**
 * 估算消息列表的总token数
 * @param messages - 消息列表
 * @returns 估算的token数
 */
function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + (msg.tokenCount || estimateTokens(msg.content)), 0);
}
