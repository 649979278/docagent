/**
 * QueryLoopState - 不可变查询循环状态
 * 参考 Claude Code 的 State 类型设计：每次迭代整体替换，不原地修改
 * 所有跨迭代状态集中在此，替代分散的 LoopState + currentTurn
 */

import type {
  AgentMode,
  Plan,
  PlanPhase,
  Message,
  Memory,
  ContextBudget,
  RetrievedChunk,
  CompactBoundary,
  PromptDiagnostics,
  RunTerminalReason,
} from '@workagent/shared';
import type { TransitionType } from './state.js';

// ============================================================
// 自动压缩追踪
// ============================================================

/** 自动压缩追踪状态 - circuit breaker 防止无限压缩 */
export interface AutoCompactTracking {
  /** 上次压缩时的消息数 */
  lastCompactedMessageCount: number;
  /** 累计压缩次数 */
  compactCount: number;
  /** 连续压缩后使用率仍超 90% 的次数 */
  consecutiveFailures: number;
  /** 是否已触发 circuit breaker */
  circuitBreakerTripped: boolean;
}

// ============================================================
// QueryLoopState
// ============================================================

/** 不可变查询循环状态 - 每次迭代整体替换 */
export interface QueryLoopState {
  /** 会话ID */
  sessionId: string;
  /** Agent Run ID（关联 agent_runs 表） */
  runId: string;
  /** 消息列表 */
  messages: Message[];
  /** 当前模式 */
  mode: AgentMode;
  /** 当前计划阶段 */
  planPhase: PlanPhase;
  /** 循环计数 */
  turnCount: number;
  /** 累计 token 使用 */
  totalTokensUsed: number;
  /** 自动压缩追踪 */
  autoCompactTracking: AutoCompactTracking;
  /** 是否已尝试 reactive 压缩 */
  hasAttemptedReactiveCompact: boolean;
  /** 是否已尝试 max_output_tokens 恢复 */
  maxOutputTokensRecoveryCount: number;
  /** 是否已尝试 drain collapse（压缩后仍超限的最终降级） */
  hasAttemptedDrainCollapse: boolean;
  /** 瞬态错误重试次数（如网络超时、模型临时不可用） */
  withheldRetryCount: number;
  /** 运行时转换 */
  transition: TransitionType;
  /** 最近一次 compact boundary ID */
  lastCompactBoundaryId: string | null;
  /** 当前活跃计划 */
  activePlan: Plan | null;
  /** compact 次数 */
  compactCount: number;
  /** 上下文预算 */
  budget: ContextBudget;
  /** 已加载的显式记忆 */
  memories: Memory[];
  /** RAG 缓存片段 */
  ragChunks: RetrievedChunk[];
  /** 诊断数据 */
  diagnostics: PromptDiagnostics;
  /** 用户输入 */
  userInput: string;
  /** 助手当前轮内容（流式累积） */
  assistantContent: string;
  /** 当前轮工具调用 */
  hasToolCalls: boolean;
  /** 当前轮是否有错误 */
  hasError: boolean;
  /** 是否已重试 */
  retried: boolean;
}

// ============================================================
// 工厂函数
// ============================================================

/** 创建初始自动压缩追踪 */
function createAutoCompactTracking(): AutoCompactTracking {
  return {
    lastCompactedMessageCount: 0,
    compactCount: 0,
    consecutiveFailures: 0,
    circuitBreakerTripped: false,
  };
}

/** 创建初始诊断数据 */
function createInitialDiagnostics(): PromptDiagnostics {
  return {
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
 * 创建初始查询循环状态
 * @param sessionId - 会话ID
 * @param mode - Agent模式
 * @param budget - 上下文预算
 * @param memories - 已加载的记忆
 * @param userInput - 用户输入
 * @returns 初始查询循环状态
 */
export function createQueryLoopState(
  sessionId: string,
  mode: AgentMode,
  budget: ContextBudget,
  memories: Memory[],
  userInput: string,
  runId?: string,
): QueryLoopState {
  return {
    sessionId,
    runId: runId ?? `run_${Date.now()}`,
    messages: [],
    mode,
    planPhase: 'PLAN_COLLECT',
    turnCount: 0,
    totalTokensUsed: 0,
    autoCompactTracking: createAutoCompactTracking(),
    hasAttemptedReactiveCompact: false,
    maxOutputTokensRecoveryCount: 0,
    hasAttemptedDrainCollapse: false,
    withheldRetryCount: 0,
    transition: 'next_turn',
    lastCompactBoundaryId: null,
    activePlan: null,
    compactCount: 0,
    budget,
    memories,
    ragChunks: [],
    diagnostics: createInitialDiagnostics(),
    userInput,
    assistantContent: '',
    hasToolCalls: false,
    hasError: false,
    retried: false,
  };
}

/**
 * 不可变更新 QueryLoopState
 * 返回新的状态对象，不修改原状态
 * @param state - 当前状态
 * @param updates - 需要更新的字段
 * @returns 新的状态对象
 */
export function updateQueryLoopState(
  state: QueryLoopState,
  updates: Partial<QueryLoopState>,
): QueryLoopState {
  return { ...state, ...updates };
}
