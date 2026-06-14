/**
 * 预算感知的 RAG 注入 - 替代 runtime.ts 中的 enrichWithRAG
 * 核心改动：
 * 1. 注入计入 budget.ragResults，不超出预算
 * 2. plan 模式 PLAN_RESEARCH/PLAN_DRAFT 自动触发，关键词降级为后备
 * 3. 输出 [ref_N] 引用标签格式
 */

import type { AgentMode, PlanPhase, RetrievedChunk, ContextBudget, Message } from '@workagent/shared';
import type { RAGSearchProvider } from '@workagent/tools';
import { estimateTokens, truncateRagChunks } from './budget.js';

// ============================================================
// RAG 触发关键词
// ============================================================

/** RAG 自动检索触发关键词 */
const RAG_TRIGGER_KEYWORDS = [
  '参考', '检索', '搜索', '查找', '知识库', '资料', '素材',
  '查询', '寻找', '文库', '文档库', '相关内容', '相关文档',
  '参考文档', '参考文献', '参考资料', '查找资料',
];

// ============================================================
// RAG 注入结果
// ============================================================

/** RAG 注入结果 */
export interface RagInjectResult {
  /** RAG 注入消息（可能为 null 表示未触发） */
  message: Message | null;
  /** 使用的 token 数 */
  usedTokens: number;
  /** 注入的 chunk 列表 */
  injectedChunks: RetrievedChunk[];
  /** 是否触发 */
  triggered: boolean;
  /** 触发原因 */
  triggerReason: 'keyword' | 'always_in_plan' | 'none';
}

// ============================================================
// 核心注入函数
// ============================================================

/**
 * 预算感知的 RAG 注入 - Pipeline 内部调用
 * 替代 runtime.ts 中的 enrichWithRAG
 * @param userInput - 用户输入文本
 * @param mode - 当前 Agent 模式
 * @param planPhase - 当前计划阶段
 * @param searchProvider - RAG 搜索提供者
 * @param budget - 上下文预算
 * @returns RAG 注入结果
 */
export async function injectRagContext(
  userInput: string,
  mode: AgentMode,
  planPhase: PlanPhase | null,
  searchProvider: RAGSearchProvider | undefined,
  budget: ContextBudget,
): Promise<RagInjectResult> {
  // 1. 判断触发条件
  const triggerResult = shouldTriggerRagInjection(userInput, mode, planPhase);

  if (!triggerResult.triggered || !searchProvider) {
    return {
      message: null,
      usedTokens: 0,
      injectedChunks: [],
      triggered: false,
      triggerReason: triggerResult.reason,
    };
  }

  // 2. 执行检索
  let chunks: RetrievedChunk[];
  try {
    chunks = await searchProvider.search(userInput, {
      topK: 5,
      minScore: 0.3,
    });
  } catch {
    // RAG 检索失败时不影响正常对话流程
    return {
      message: null,
      usedTokens: 0,
      injectedChunks: [],
      triggered: true,
      triggerReason: triggerResult.reason,
    };
  }

  if (chunks.length === 0) {
    return {
      message: null,
      usedTokens: 0,
      injectedChunks: [],
      triggered: true,
      triggerReason: triggerResult.reason,
    };
  }

  // 3. 按 budget.ragResults 截断（关键：计入预算）
  const { chunks: budgetedChunks, usedTokens } = truncateRagChunks(
    chunks as Array<{ content: string }>,
    budget.ragResults,
  ) as { chunks: RetrievedChunk[]; usedTokens: number };

  if (budgetedChunks.length === 0) {
    return {
      message: null,
      usedTokens: 0,
      injectedChunks: [],
      triggered: true,
      triggerReason: triggerResult.reason,
    };
  }

  // 4. 格式化为 [ref_N] 引用标签格式
  const content = formatRagWithContext(budgetedChunks);
  const message: Message = {
    id: `rag-inject-${Date.now()}`,
    role: 'system',
    content,
    eventType: 'summary',
    tokenCount: usedTokens,
    timestamp: Date.now(),
  };

  return {
    message,
    usedTokens,
    injectedChunks: budgetedChunks,
    triggered: true,
    triggerReason: triggerResult.reason,
  };
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 判断是否应触发 RAG 注入
 * plan 模式 PLAN_RESEARCH/PLAN_DRAFT 自动触发，关键词降级为后备
 * @param userInput - 用户输入
 * @param mode - Agent 模式
 * @param planPhase - 计划阶段
 * @returns 触发结果
 */
function shouldTriggerRagInjection(
  userInput: string,
  mode: AgentMode,
  planPhase: PlanPhase | null,
): { triggered: boolean; reason: RagInjectResult['triggerReason'] } {
  // plan 模式 PLAN_RESEARCH / PLAN_DRAFT 阶段自动触发
  if (mode === 'plan' && (planPhase === 'PLAN_RESEARCH' || planPhase === 'PLAN_DRAFT')) {
    return { triggered: true, reason: 'always_in_plan' };
  }

  // 关键词触发（保留作为降级）
  if (RAG_TRIGGER_KEYWORDS.some(k => userInput.includes(k))) {
    return { triggered: true, reason: 'keyword' };
  }

  return { triggered: false, reason: 'none' };
}

/**
 * 格式化为 [ref_N] 引用标签格式
 * @param chunks - RAG 检索片段
 * @returns 格式化后的上下文文本
 */
function formatRagWithContext(chunks: RetrievedChunk[]): string {
  const parts = chunks.map((chunk, i) => {
    return `[ref_${i + 1}] 来源: ${chunk.sourceFile}${chunk.locator ? ` (${chunk.locator})` : ''}\n${chunk.content}`;
  });
  return `## 参考资料\n\n请在回答时引用上述材料，使用 [ref_N] 标注来源。\n\n${parts.join('\n\n---\n\n')}`;
}
