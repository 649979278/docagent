/**
 * Zustand全局状态管理
 * 管理会话、消息、上下文指标、模型状态等
 */

import { create } from 'zustand';

/** 消息类型 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** 工具调用信息 */
  toolCalls?: ToolCallInfo[];
  /** token数量 */
  tokenCount?: number;
}

/** 工具调用信息 */
export interface ToolCallInfo {
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
}

/** 会话类型 */
export interface Session {
  id: string;
  title: string;
  mode: 'chat' | 'plan' | 'execute';
  updatedAt: number;
}

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

/** 应用状态 */
export interface AppState {
  // 会话
  sessions: Session[];
  currentSessionId: string | null;
  messages: ChatMessage[];

  // 状态
  isLoading: boolean;
  mode: 'chat' | 'plan' | 'execute';
  planPhase: string;

  // 上下文指标
  contextMetrics: ContextMetrics;

  // Ollama
  ollamaStatus: 'checking' | 'running' | 'not_installed' | 'start_failed';
  ollamaModel: string;

  // 操作
  setCurrentSession: (id: string | null) => void;
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  setLoading: (loading: boolean) => void;
  setMode: (mode: 'chat' | 'plan' | 'execute') => void;
  setPlanPhase: (phase: string) => void;
  setContextMetrics: (metrics: Partial<ContextMetrics>) => void;
  setOllamaStatus: (status: AppState['ollamaStatus']) => void;
  setOllamaModel: (model: string) => void;
  clearMessages: () => void;
}

/** 默认上下文指标 */
const defaultMetrics: ContextMetrics = {
  contextLength: 32768,
  usedTokens: 0,
  usedPercentage: 0,
  lastCompactFreed: 0,
  compactCount: 0,
};

/**
 * 全局状态store
 */
export const useAppStore = create<AppState>((set) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  isLoading: false,
  mode: 'chat',
  planPhase: 'PLAN_COLLECT',
  contextMetrics: defaultMetrics,
  ollamaStatus: 'checking',
  ollamaModel: '',

  setCurrentSession: (id) => set({ currentSessionId: id }),
  setSessions: (sessions) => set({ sessions }),
  addSession: (session) => set((s) => ({ sessions: [session, ...s.sessions] })),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  updateMessage: (id, updates) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),
  setLoading: (loading) => set({ isLoading: loading }),
  setMode: (mode) => set({ mode }),
  setPlanPhase: (phase) => set({ planPhase: phase }),
  setContextMetrics: (metrics) =>
    set((s) => ({
      contextMetrics: { ...s.contextMetrics, ...metrics },
    })),
  setOllamaStatus: (status) => set({ ollamaStatus: status }),
  setOllamaModel: (model) => set({ ollamaModel: model }),
  clearMessages: () => set({ messages: [] }),
}));
