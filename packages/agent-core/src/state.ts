/**
 * Agent状态管理 - LoopState、TurnContext等运行时数据模型
 * 从@workagent/shared导入基础类型，扩展运行时状态
 */

import type {
  AgentMode,
  PlanPhase,
  Plan,
  Message,
  ConversationContext,
  AgentState,
  RetrievedChunk,
  Memory,
  ContextBudget,
  ToolCall,
} from '@workagent/shared';

// ============================================================
// 循环状态
// ============================================================

/** Agent循环决策 */
export type LoopDecision = 'Continue' | 'EnterPlan' | 'WaitApproval' | 'Done';

/** 工具执行追踪记录 */
export interface ToolExecutionTrace {
  /** 工具调用信息 */
  call: ToolCall;
  /** 执行结果 */
  output: unknown;
  /** 是否出错 */
  isError: boolean;
  /** 执行耗时(ms) */
  duration: number;
}

/** 单轮对话的状态 */
export interface TurnState {
  /** 当前轮次ID */
  turnId: string;
  /** 用户输入内容 */
  userInput: string;
  /** 模型生成的文本内容 */
  assistantContent: string;
  /** 模型请求的工具调用列表 */
  toolCalls: ToolCall[];
  /** 工具执行追踪记录 */
  toolTraces: ToolExecutionTrace[];
  /** 本轮使用的token数 */
  tokensUsed: number;
  /** 本轮是否出错 */
  hasError: boolean;
  /** 错误信息 */
  errorMessage?: string;
  /** 是否已重试过 */
  retried: boolean;
}

/** Agent循环运行状态 */
export interface LoopState {
  /** 当前会话ID */
  sessionId: string;
  /** 当前Agent模式 */
  mode: AgentMode;
  /** 当前轮次序号 */
  turnIndex: number;
  /** 当前轮次状态 */
  currentTurn: TurnState | null;
  /** 循环决策 */
  decision: LoopDecision;
  /** 累计使用的token数 */
  totalTokensUsed: number;
  /** 压缩次数 */
  compactCount: number;
  /** 是否已触发reactive压缩 */
  reactiveCompactTriggered: boolean;
}

// ============================================================
// 扩展会话上下文
// ============================================================

/** 运行时会话上下文（扩展ConversationContext） */
export interface RuntimeContext extends ConversationContext {
  /** 当前激活的计划 */
  activePlan: Plan | null;
  /** 当前RAG检索到的片段缓存 */
  ragChunks: RetrievedChunk[];
  /** 加载的显式记忆 */
  memories: Memory[];
  /** 当前上下文预算 */
  budget: ContextBudget | null;
  /** 上下文压缩摘要 */
  compactSummary: string | null;
}

// ============================================================
// 压缩结果
// ============================================================

/** 上下文压缩结果 */
export interface CompactResult {
  /** 压缩级别（1=微压缩, 2=摘要压缩） */
  level: 1 | 2;
  /** 使用的压缩策略 */
  strategy: 'micro' | 'summary';
  /** 释放的token数 */
  freedTokens: number;
  /** 压缩后的消息列表 */
  messages: Message[];
  /** 压缩摘要文本（level=2时有值） */
  summary: string | null;
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建初始循环状态
 * @param sessionId - 会话ID
 * @param mode - Agent模式
 * @returns 初始循环状态
 */
export function createLoopState(sessionId: string, mode: AgentMode): LoopState {
  return {
    sessionId,
    mode,
    turnIndex: 0,
    currentTurn: null,
    decision: 'Continue',
    totalTokensUsed: 0,
    compactCount: 0,
    reactiveCompactTriggered: false,
  };
}

/**
 * 创建新的轮次状态
 * @param turnId - 轮次ID
 * @param userInput - 用户输入
 * @returns 新的轮次状态
 */
export function createTurnState(turnId: string, userInput: string): TurnState {
  return {
    turnId,
    userInput,
    assistantContent: '',
    toolCalls: [],
    toolTraces: [],
    tokensUsed: 0,
    hasError: false,
    retried: false,
  };
}

/**
 * 创建运行时上下文
 * @param base - 基础会话上下文
 * @returns 运行时上下文
 */
export function createRuntimeContext(base: ConversationContext): RuntimeContext {
  return {
    ...base,
    activePlan: null,
    ragChunks: [],
    memories: [],
    budget: null,
    compactSummary: null,
  };
}

/**
 * 将AgentState转换为运行时上下文
 * @param state - Agent状态
 * @returns 运行时上下文
 */
export function stateToRuntimeContext(state: AgentState): RuntimeContext {
  return createRuntimeContext(state.context);
}
