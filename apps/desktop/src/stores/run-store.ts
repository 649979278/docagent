/**
 * 运行状态管理 Store
 * 管理当前运行状态、活跃工具调用、上下文指标、诊断数据
 */

import { create } from 'zustand';

/** 上下文指标 */
export interface ContextMetrics {
  /** 上下文窗口总大小 */
  contextLength: number;
  /** 已使用token数 */
  usedTokens: number;
  /** 使用百分比 0-100 */
  usedPercentage: number;
  /** 上次压缩释放的token */
  lastCompactFreed: number;
  /** 压缩次数 */
  compactCount: number;
}

/** 运行诊断数据 */
export interface RunDiagnostics {
  /** 当前运行ID */
  runId: string | null;
  /** 触发的 prompt section */
  triggeredSections: string[];
  /** 各段 token 占用 */
  historyTokens: number;
  ragTokens: number;
  toolTokens: number;
  completionTokens: number;
  /** 工具调用 */
  hadToolCall: boolean;
  toolParseFailed: boolean;
  /** 压缩 */
  compactOccurred: boolean;
  compactFreedTokens: number;
  /** 终止原因 */
  terminalReason: string | null;
  /** 计划转换 */
  planTransition: string | null;
  /** RAG */
  ragHitCount: number;
  ragInjectedTokens: number;
  /** 当前运行状态 */
  runStatus?: 'running' | 'completed' | 'aborted' | 'failed';
  /** 模式建议 */
  modeSuggestion?: { suggestedMode: 'chat' | 'plan' | 'execute'; reason: string } | null;
  /** 当前计划 ID */
  activePlanId?: string | null;
  /** 恢复快照 */
  recoverySnapshot?: {
    runId: string;
    terminalStatus: string | null;
    lastAssistantContent: string;
    activePlanSnapshot: Record<string, unknown> | null;
    totalEvents: number;
    transcriptPath: string;
  } | null;
  /** RAG 检索组件诊断 */
  ragDiagnostics?: {
    queryRewriter: { name: string; fallback: boolean };
    reranker: { name: string; fallback: boolean };
    relevanceGrader: { name: string };
  } | null;
}

/** 运行状态 */
export interface RunState {
  /** 上下文指标 */
  contextMetrics: ContextMetrics;
  /** 当前模式 */
  mode: 'chat' | 'plan' | 'execute';
  /** Plan 阶段 */
  planPhase: string;
  /** 运行诊断数据 */
  diagnostics: RunDiagnostics;
  /** 模型状态 */
  ollamaStatus: 'checking' | 'running' | 'not_installed' | 'start_failed';
  /** 当前模型名称 */
  ollamaModel: string;

  /** 设置上下文指标 */
  setContextMetrics: (metrics: Partial<ContextMetrics>) => void;
  /** 设置模式 */
  setMode: (mode: 'chat' | 'plan' | 'execute') => void;
  /** 设置 Plan 阶段 */
  setPlanPhase: (phase: string) => void;
  /** 设置运行诊断数据 */
  setDiagnostics: (diagnostics: Partial<RunDiagnostics>) => void;
  /** 设置 Ollama 状态 */
  setOllamaStatus: (status: RunState['ollamaStatus']) => void;
  /** 设置 Ollama 模型 */
  setOllamaModel: (model: string) => void;
}

/** 默认上下文指标 */
const defaultMetrics: ContextMetrics = {
  contextLength: 32768,
  usedTokens: 0,
  usedPercentage: 0,
  lastCompactFreed: 0,
  compactCount: 0,
};

/** 默认诊断数据 */
const defaultDiagnostics: RunDiagnostics = {
  runId: null,
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

/**
 * 运行状态 Store
 */
export const useRunStore = create<RunState>((set) => ({
  contextMetrics: defaultMetrics,
  mode: 'chat',
  planPhase: 'PLAN_COLLECT',
  diagnostics: defaultDiagnostics,
  ollamaStatus: 'checking',
  ollamaModel: '',

  setContextMetrics: (metrics) =>
    set((s) => ({
      contextMetrics: { ...s.contextMetrics, ...metrics },
    })),
  setMode: (mode) => set({ mode }),
  setPlanPhase: (phase) => set({ planPhase: phase }),
  setDiagnostics: (diagnostics) =>
    set((s) => ({
      diagnostics: { ...s.diagnostics, ...diagnostics },
    })),
  setOllamaStatus: (status) => set({ ollamaStatus: status }),
  setOllamaModel: (model) => set({ ollamaModel: model }),
}));
