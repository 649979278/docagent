/**
 * Drain Collapse - 上下文溢出的最终降级策略
 *
 * 当 reactive compact 和 auto compact 均无法释放足够空间时，
 * 执行 drain collapse：保留最近 N 条消息 + 系统提示 + 计划摘要，
 * 其余全部丢弃。这是一种破坏性操作，会丢失历史上下文。
 *
 * 恢复链（对齐 Claude Code）：
 * 1. reactive compact → LLM 摘要压缩（尝试保留关键信息）
 * 2. drain collapse → 仅保留最近 N 条（破坏性，丢失大量历史）
 * 3. graceful stop → 停止当前 run，请求用户干预
 */

import type { Message, Memory, Plan } from '@workagent/shared';
import { estimateTokens } from './budget.js';

/** Drain collapse 保留的最近消息条数 */
const DRAIN_COLLAPSE_KEEP_RECENT = 4;

/** Drain collapse 结果 */
export interface DrainCollapseResult {
  /** 压缩后的消息列表 */
  messages: Message[];
  /** 释放的 token 数 */
  freedTokens: number;
  /** 是否执行了 drain collapse */
  didDrain: boolean;
}

/**
 * 执行 drain collapse。
 * 仅保留系统提示 + 会话摘要 + 最近 N 条消息 + 计划摘要。
 * 其余历史全部丢弃。
 *
 * @param messages - 当前消息列表。
 * @param memories - 显式记忆（用于生成计划摘要）。
 * @param activePlan - 当前活跃计划（如有）。
 * @returns Drain collapse 结果。
 */
export function drainCollapse(
  messages: Message[],
  memories: Memory[],
  activePlan: Plan | null,
): DrainCollapseResult {
  const beforeTokens = estimateMessagesTokens(messages);

  // 分离系统消息和普通消息
  const systemMessages: Message[] = [];
  const regularMessages: Message[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessages.push(msg);
    } else {
      regularMessages.push(msg);
    }
  }

  // 保留最近 N 条普通消息
  const kept = regularMessages.slice(-DRAIN_COLLAPSE_KEEP_RECENT);

  // 构造 drain 通知消息
  const drainNotice: Message = {
    id: `drain_${Date.now()}`,
    role: 'system',
    content: buildDrainNotice(kept.length, activePlan),
    eventType: 'summary',
    tokenCount: estimateTokens(buildDrainNotice(kept.length, activePlan)),
    timestamp: Date.now(),
    compactBoundaryId: `drain_${Date.now()}`,
  };

  const result = [...systemMessages, drainNotice, ...kept];
  const afterTokens = estimateMessagesTokens(result);
  const freedTokens = Math.max(0, beforeTokens - afterTokens);

  return {
    messages: result,
    freedTokens,
    didDrain: true,
  };
}

/**
 * 构建 drain collapse 通知文本。
 * @param keptCount - 保留的消息条数。
 * @param activePlan - 当前活跃计划。
 * @returns 通知文本。
 */
function buildDrainNotice(keptCount: number, activePlan: Plan | null): string {
  let notice = `[上下文紧急压缩] 由于对话过长，早期历史已被丢弃。仅保留最近 ${keptCount} 条消息。`;

  if (activePlan) {
    notice += `\n\n当前计划：${activePlan.goal}`;
    if (activePlan.outline?.structure?.length) {
      const steps = activePlan.outline.structure
        .map((s, i) => `${i + 1}. [${s.status}] ${s.description}`)
        .join('\n');
      notice += `\n\n执行进度：\n${steps}`;
    }
  }

  return notice;
}

/**
 * 估算消息列表的总 token 数。
 * @param messages - 消息列表。
 * @returns 估算的 token 数。
 */
function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce(
    (sum, msg) => sum + (msg.tokenCount || estimateTokens(msg.content)),
    0,
  );
}
