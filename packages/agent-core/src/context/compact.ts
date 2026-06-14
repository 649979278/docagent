/**
 * 上下文压缩入口 - 协调微压缩和摘要压缩
 * Level1: microCompact (清理过时tool_result)
 * Level2: summaryCompact (LLM摘要)
 * reactiveCompact: 上下文超限时立即summaryCompact后重试
 *
 * 迭代4增强：CompactResult 增加 boundary、retainedCitationIds、
 * retainedToolSummaries、restorationHints 字段
 */

import type { Message, Memory, ContextBudget, CompactBoundary, Plan } from '@workagent/shared';
import { COMPACT_THRESHOLD } from '@workagent/shared';
import type { ModelProvider } from '@workagent/model-provider';
import type { CompactResult } from '../state.js';
import type { AutoCompactTracking } from '../query-state.js';
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
// Boundary 和恢复字段生成
// ============================================================

/**
 * 生成 CompactBoundary 记录
 * @param strategy - 压缩策略
 * @param messageCountBefore - 压缩前消息数
 * @param messageCountAfter - 压缩后消息数
 * @param freedTokens - 释放的 token 数
 * @returns CompactBoundary 实例
 */
function createCompactBoundary(
  strategy: CompactBoundary['strategy'],
  messageCountBefore: number,
  messageCountAfter: number,
  freedTokens: number,
): CompactBoundary {
  return {
    id: `compact-${strategy}-${Date.now()}`,
    strategy,
    messageCountBefore,
    messageCountAfter,
    freedTokens,
    timestamp: Date.now(),
  };
}

/**
 * 从消息列表中提取保留的引用 ID
 * 提取 [ref_N] 格式的引用标签和 rag-inject 消息中的 chunkId
 * @param messages - 压缩后保留的消息列表
 * @returns 保留的引用 ID 列表
 */
function extractRetainedCitationIds(messages: Message[]): string[] {
  const ids: string[] = [];

  for (const msg of messages) {
    // 从 RAG 注入消息中提取 chunk ID
    if (msg.role === 'system' && msg.id.startsWith('rag-inject-')) {
      // 匹配 [ref_N] 标签
      const refPattern = /\[ref_(\d+)\]/g;
      let match;
      while ((match = refPattern.exec(msg.content)) !== null) {
        ids.push(`ref_${match[1]}`);
      }
    }
    // 从包含引用标签的任何消息中提取
    const refPattern = /\[ref_(\d+)\]/g;
    let match;
    while ((match = refPattern.exec(msg.content)) !== null) {
      const refId = `ref_${match[1]}`;
      if (!ids.includes(refId)) {
        ids.push(refId);
      }
    }
  }

  return ids;
}

/**
 * 从消息列表中提取保留的工具摘要
 * @param messages - 压缩后保留的消息列表
 * @returns 保留的工具摘要列表
 */
function extractRetainedToolSummaries(messages: Message[]): string[] {
  const summaries: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool' && msg.toolCallId) {
      // 提取工具名称和调用 ID 作为摘要
      const toolName = msg.toolName ?? 'unknown';
      summaries.push(`${toolName}:${msg.toolCallId}`);
    }
  }

  return summaries;
}

/**
 * 生成恢复提示
 * @param strategy - 压缩策略
 * @param retainedCitationIds - 保留的引用 ID
 * @param retainedToolSummaries - 保留的工具摘要
 * @param activePlan - 是否有活跃计划
 * @returns 恢复提示列表
 */
function generateRestorationHints(
  strategy: CompactBoundary['strategy'],
  retainedCitationIds: string[],
  retainedToolSummaries: string[],
  activePlan: boolean,
): string[] {
  const hints: string[] = [];

  hints.push(`compact_strategy:${strategy}`);

  if (retainedCitationIds.length > 0) {
    hints.push(`retained_citations:${retainedCitationIds.length}`);
  }

  if (retainedToolSummaries.length > 0) {
    hints.push(`retained_tools:${retainedToolSummaries.length}`);
  }

  if (activePlan) {
    hints.push('active_plan_needs_reinjection');
  }

  return hints;
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
 * @param activePlan - 当前活跃计划（用于生成恢复提示）
 * @returns 压缩结果（含 boundary 和恢复字段）
 */
export async function compactContext(
  messages: Message[],
  provider: ModelProvider,
  memories: Memory[] = [],
  budget: ContextBudget | null = null,
  preferredLevel?: 1 | 2,
  activePlan: Plan | null = null,
): Promise<CompactResult> {
  const messageCountBefore = messages.length;

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
      boundary: null,
      retainedCitationIds: [],
      retainedToolSummaries: [],
      restorationHints: [],
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
      const finalFreedTokens = microResult.freedTokens + summaryResult.freedTokens;
      const finalStrategy: CompactBoundary['strategy'] = 'summary';
      const retainedCitationIds = extractRetainedCitationIds(summaryResult.messages);
      const retainedToolSummaries = extractRetainedToolSummaries(summaryResult.messages);

      return {
        level: 2,
        strategy: finalStrategy,
        freedTokens: finalFreedTokens,
        messages: summaryResult.messages,
        summary: summaryResult.summary,
        boundary: createCompactBoundary(
          finalStrategy,
          messageCountBefore,
          summaryResult.messages.length,
          finalFreedTokens,
        ),
        retainedCitationIds,
        retainedToolSummaries,
        restorationHints: generateRestorationHints(
          finalStrategy,
          retainedCitationIds,
          retainedToolSummaries,
          !!activePlan,
        ),
      };
    }

    const retainedCitationIds = extractRetainedCitationIds(microResult.messages);
    const retainedToolSummaries = extractRetainedToolSummaries(microResult.messages);

    return {
      level: 1,
      strategy: 'micro',
      freedTokens: microResult.freedTokens,
      messages: microResult.messages,
      summary: null,
      boundary: createCompactBoundary(
        'micro',
        messageCountBefore,
        microResult.messages.length,
        microResult.freedTokens,
      ),
      retainedCitationIds,
      retainedToolSummaries,
      restorationHints: generateRestorationHints(
        'micro',
        retainedCitationIds,
        retainedToolSummaries,
        !!activePlan,
      ),
    };
  }

  // Level 2: 摘要压缩
  const summaryResult = await summaryCompact(messages, provider, memories);
  const retainedCitationIds = extractRetainedCitationIds(summaryResult.messages);
  const retainedToolSummaries = extractRetainedToolSummaries(summaryResult.messages);

  return {
    level: 2,
    strategy: 'summary',
    freedTokens: summaryResult.freedTokens,
    messages: summaryResult.messages,
    summary: summaryResult.summary,
    boundary: createCompactBoundary(
      'summary',
      messageCountBefore,
      summaryResult.messages.length,
      summaryResult.freedTokens,
    ),
    retainedCitationIds,
    retainedToolSummaries,
    restorationHints: generateRestorationHints(
      'summary',
      retainedCitationIds,
      retainedToolSummaries,
      !!activePlan,
    ),
  };
}

/**
 * 响应式压缩 - 上下文超限时立即执行摘要压缩
 * 当模型返回上下文超限错误时调用
 * @param messages - 当前消息列表
 * @param provider - 模型提供者
 * @param memories - 显式记忆列表
 * @param activePlan - 当前活跃计划（用于生成恢复提示）
 * @returns 压缩结果（strategy 为 'reactive'，boundary 记录压缩边界）
 */
export async function reactiveCompact(
  messages: Message[],
  provider: ModelProvider,
  memories: Memory[] = [],
  activePlan: Plan | null = null,
): Promise<CompactResult> {
  const messageCountBefore = messages.length;

  // 直接执行Level 2摘要压缩
  const result = await compactContext(messages, provider, memories, null, 2, activePlan);

  // 将 strategy 标记为 reactive（覆盖 compactContext 中的 'summary'）
  if (result.boundary) {
    result.boundary.strategy = 'reactive';
  }
  result.strategy = 'reactive';

  // 更新 restorationHints
  result.restorationHints = generateRestorationHints(
    'reactive',
    result.retainedCitationIds,
    result.retainedToolSummaries,
    !!activePlan,
  );

  return result;
}

// ============================================================
// 自动压缩 + Circuit Breaker
// ============================================================

/** 自动压缩结果 */
export interface AutoCompactResult {
  /** 压缩后的消息列表 */
  messages: Message[];
  /** 更新后的追踪状态 */
  tracking: AutoCompactTracking;
  /** 释放的 token 数 */
  freedTokens: number;
  /** 是否执行了压缩 */
  didCompact: boolean;
  /** 压缩边界记录 */
  boundary: CompactBoundary | null;
}

/**
 * 自动压缩 - 80% 阈值触发，带 circuit breaker
 * 参考 Claude Code 的 autoCompact + circuit breaker 机制
 * circuit breaker：连续3次压缩后使用率仍超90%时跳过，防止无限压缩
 * @param messages - 当前消息列表
 * @param provider - 模型提供者
 * @param memories - 显式记忆列表
 * @param budget - 上下文预算
 * @param tracking - 自动压缩追踪状态
 * @param activePlan - 当前活跃计划（用于生成恢复提示）
 * @returns 自动压缩结果（含 boundary）
 */
export async function autoCompactIfNeeded(
  messages: Message[],
  provider: ModelProvider,
  memories: Memory[],
  budget: ContextBudget,
  tracking: AutoCompactTracking,
  activePlan: Plan | null = null,
): Promise<AutoCompactResult> {
  // Circuit breaker：已触发则跳过
  if (tracking.circuitBreakerTripped) {
    return { messages, tracking, freedTokens: 0, didCompact: false, boundary: null };
  }

  // 检查是否超过 80% 阈值
  const usedTokens = estimateMessagesTokens(messages);
  const usage = usedTokens / budget.total;

  if (usage <= 0.8) {
    return { messages, tracking, freedTokens: 0, didCompact: false, boundary: null };
  }

  // 执行摘要压缩
  const result = await compactContext(messages, provider, memories, budget, 2, activePlan);

  // 评估压缩效果
  const postUsage = estimateMessagesTokens(result.messages) / budget.total;
  const compressionFailed = postUsage > 0.9;
  const newConsecutiveFailures = compressionFailed
    ? tracking.consecutiveFailures + 1
    : 0;

  const newTracking: AutoCompactTracking = {
    ...tracking,
    compactCount: tracking.compactCount + 1,
    consecutiveFailures: newConsecutiveFailures,
    lastCompactedMessageCount: result.messages.length,
    // 连续3次压缩无效 → 触发 circuit breaker
    circuitBreakerTripped: newConsecutiveFailures >= 3,
  };

  return {
    messages: result.messages,
    tracking: newTracking,
    freedTokens: result.freedTokens,
    didCompact: true,
    boundary: result.boundary,
  };
}

/**
 * 估算消息列表的总token数
 * @param messages - 消息列表
 * @returns 估算的token数
 */
function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + (msg.tokenCount || estimateTokens(msg.content)), 0);
}
