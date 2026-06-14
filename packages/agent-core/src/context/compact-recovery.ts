/**
 * Post-Compact Recovery - 上下文压缩后的恢复机制
 * 参考 Claude Code 的 post-compact reinjection：
 * 压缩后第一轮自动注入记忆、RAG 引用重水合、活跃计划摘要
 * 确保压缩不丢失关键上下文信息
 */

import type {
  Message,
  Memory,
  Plan,
  RetrievedChunk,
} from '@workagent/shared';
import type { QueryLoopState } from '../query-state.js';
import type { RAGSearchProvider } from '@workagent/tools';
import { citationRehydrate } from './citationRehydrate.js';
import { estimateTokens } from './budget.js';

// ============================================================
// 恢复配置
// ============================================================

/** 恢复配置 */
export interface RecoveryConfig {
  /** 恢复预算上限（token），默认 50000 */
  fileAttachmentBudget?: number;
  /** 最大文件附件数，默认 10 */
  maxFileAttachments?: number;
  /** 单个文件最大 token 数，默认 5000 */
  maxFileTokens?: number;
}

// ============================================================
// 恢复结果
// ============================================================

/** 恢复结果 */
export interface RecoveryResult {
  /** 更新后的状态 */
  state: QueryLoopState;
  /** 是否执行了记忆注入 */
  memoryInjected: boolean;
  /** 是否执行了 RAG 重水合 */
  ragRehydrated: boolean;
  /** 是否执行了计划摘要注入 */
  planInjected: boolean;
  /** 恢复使用的总 token 数 */
  totalRecoveryTokens: number;
}

// ============================================================
// 格式化辅助函数
// ============================================================

/**
 * 格式化记忆为注入文本
 * @param memories - 记忆列表
 * @returns 格式化后的文本
 */
function formatMemoriesForRecovery(memories: Memory[]): string {
  const enabledMemories = memories.filter(m => m.enabled);
  if (enabledMemories.length === 0) return '';

  const parts = enabledMemories.map(m => {
    const typeLabel = {
      user_requirement: '用户要求',
      style_preference: '风格偏好',
      format_constraint: '格式约束',
      banned_expression: '禁用表达',
      custom_terminology: '自定义术语',
    }[m.type];
    return `- [${typeLabel}] ${m.content}`;
  });

  return `## 用户偏好和约束（压缩后恢复）\n\n${parts.join('\n')}`;
}

/**
 * 格式化 RAG 片段为注入消息
 * @param chunks - RAG 片段列表
 * @returns 注入消息
 */
function formatChunksAsMessage(chunks: RetrievedChunk[]): Message | null {
  if (chunks.length === 0) return null;

  const parts = chunks.map((chunk, i) => {
    return `[ref_${i + 1}] 来源: ${chunk.sourceFile}${chunk.locator ? ` (${chunk.locator})` : ''}\n${chunk.content}`;
  });

  const content = `## 参考资料（压缩后恢复）\n\n请在回答时引用上述材料，使用 [ref_N] 标注来源。\n\n${parts.join('\n\n---\n\n')}`;

  return {
    id: `recovery-rag-${Date.now()}`,
    role: 'system',
    content,
    eventType: 'summary',
    tokenCount: estimateTokens(content),
    timestamp: Date.now(),
  };
}

/**
 * 格式化活跃计划为摘要注入文本
 * @param plan - 活跃计划
 * @returns 格式化后的文本
 */
function formatPlanSummary(plan: Plan): string {
  const lines: string[] = [];

  lines.push(`## 当前计划摘要（压缩后恢复）`);
  lines.push(`- 标题: ${plan.title}`);
  lines.push(`- 目标: ${plan.goal}`);
  lines.push(`- 状态: ${plan.status}`);

  if (plan.outline) {
    lines.push(`- 结构提纲:`);
    for (const step of plan.outline.structure) {
      const statusMark = step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '→' : '○';
      lines.push(`  ${statusMark} ${step.description}`);
    }

    if (plan.outline.materialBasis) {
      lines.push(`- 材料依据: ${plan.outline.materialBasis}`);
    }

    if (plan.outline.expectedOutput) {
      lines.push(`- 预期输出: ${plan.outline.expectedOutput}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// 恢复主函数
// ============================================================

/**
 * Post-compact 恢复 - 压缩后第一轮自动注入关键上下文
 * 参考 Claude Code 的 post-compact reinjection 机制
 *
 * 恢复优先级：
 * 1. 记忆重新注入（用户偏好和约束）
 * 2. RAG 引用重水合（活跃计划引用的材料片段）
 * 3. 活跃计划摘要注入（当前工作计划的关键信息）
 *
 * @param state - 当前查询循环状态
 * ragSearchProvider - RAG 搜索提供者（可选，用于重水合）
 * config - 恢复配置
 * @returns 恢复结果
 */
export async function recoverFromCompact(
  state: QueryLoopState,
  ragSearchProvider?: RAGSearchProvider | null,
  config?: RecoveryConfig,
): Promise<RecoveryResult> {
  const messages = [...state.messages];
  const maxBudget = config?.fileAttachmentBudget ?? 50000;
  let budgetUsed = 0;

  let memoryInjected = false;
  let ragRehydrated = false;
  let planInjected = false;

  // 1. 记忆重新注入
  const memoryText = formatMemoriesForRecovery(state.memories);
  if (memoryText) {
    const tokens = estimateTokens(memoryText);
    if (budgetUsed + tokens < maxBudget) {
      messages.push({
        id: `recovery-memory-${Date.now()}`,
        role: 'system',
        content: memoryText,
        eventType: 'summary',
        tokenCount: tokens,
        timestamp: Date.now(),
      });
      budgetUsed += tokens;
      memoryInjected = true;
    }
  }

  // 2. RAG 引用重水合（使用 citationRehydrate）
  if (state.activePlan && ragSearchProvider) {
    try {
      // 使用 RAG 搜索提供者重新检索引用的材料
      const searchQuery = state.activePlan.goal || state.userInput;
      const chunks = await ragSearchProvider.search(searchQuery, {
        topK: 5,
        minScore: 0.3,
      });

      if (chunks.length > 0) {
        const ragMessage = formatChunksAsMessage(chunks);
        if (ragMessage) {
          const tokens = ragMessage.tokenCount;
          if (budgetUsed + tokens < maxBudget) {
            messages.push(ragMessage);
            budgetUsed += tokens;
            ragRehydrated = true;
          }
        }
      }
    } catch {
      // RAG 重水合失败不影响恢复流程
    }
  }

  // 3. 活跃计划摘要重新注入
  if (state.activePlan) {
    const planSummary = formatPlanSummary(state.activePlan);
    const tokens = estimateTokens(planSummary);
    if (budgetUsed + tokens < maxBudget) {
      messages.push({
        id: `recovery-plan-${Date.now()}`,
        role: 'system',
        content: planSummary,
        eventType: 'summary',
        tokenCount: tokens,
        timestamp: Date.now(),
      });
      budgetUsed += tokens;
      planInjected = true;
    }
  }

  return {
    state: { ...state, messages },
    memoryInjected,
    ragRehydrated,
    planInjected,
    totalRecoveryTokens: budgetUsed,
  };
}
