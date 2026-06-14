/**
 * Zustand 全局状态管理 - 聚合导出
 * 7.3 Store 拆分后，此文件保留为向后兼容层
 * 新代码应直接从各子 store 导入
 *
 * 子 Store 列表：
 * - session-store: 会话列表、当前会话ID
 * - message-store: 消息列表、加载状态
 * - workspace-store: 工作区树、活跃工作区
 * - knowledge-store: 知识库条目、索引任务、搜索结果
 * - run-store: 上下文指标、模式、Plan阶段、诊断、Ollama状态
 * - ui-store: 右侧抽屉Tab、侧边栏/抽屉折叠状态
 */

// 重新导出所有子 store 以保持向后兼容
export { useSessionStore } from './session-store.js';
export type { Session } from './session-store.js';

export { useMessageStore } from './message-store.js';
export type { ChatMessage, ToolCallInfo } from './message-store.js';

export { useWorkspaceStore } from './workspace-store.js';
export type { WorkspaceItem } from './workspace-store.js';

export { useKnowledgeStore } from './knowledge-store.js';
export type { KnowledgeEntry, IndexJobState, KnowledgeSearchResult } from './knowledge-store.js';

export { useRunStore } from './run-store.js';
export type { ContextMetrics, RunDiagnostics } from './run-store.js';

export { useUiStore } from './ui-store.js';
export type { RightPanelTab } from './ui-store.js';

/**
 * 向后兼容：组合 store
 * 新代码不应使用此 store，应直接使用各子 store
 * @deprecated 使用各子 store 替代
 */
import { create } from 'zustand';
import { useSessionStore } from './session-store.js';
import { useMessageStore } from './message-store.js';
import { useRunStore } from './run-store.js';
import type { ChatMessage, ToolCallInfo } from './message-store.js';
import type { ContextMetrics } from './run-store.js';
import type { Session } from './session-store.js';

/** 向后兼容的应用状态类型 */
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

  // 操作 - 代理到子 store
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

/**
 * 向后兼容的全局状态 store
 * @deprecated 使用各子 store 替代
 */
export const useAppStore = create<AppState>((set) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  isLoading: false,
  mode: 'chat',
  planPhase: 'PLAN_COLLECT',
  contextMetrics: {
    contextLength: 32768,
    usedTokens: 0,
    usedPercentage: 0,
    lastCompactFreed: 0,
    compactCount: 0,
  },
  ollamaStatus: 'checking',
  ollamaModel: '',

  setCurrentSession: (id) => {
    useSessionStore.getState().setCurrentSession(id);
    set({ currentSessionId: id });
  },
  setSessions: (sessions) => {
    useSessionStore.getState().setSessions(sessions);
    set({ sessions });
  },
  addSession: (session) => {
    useSessionStore.getState().addSession(session);
    set((s) => ({ sessions: [session, ...s.sessions] }));
  },
  addMessage: (message) => {
    useMessageStore.getState().addMessage(message);
    set((s) => ({ messages: [...s.messages, message] }));
  },
  updateMessage: (id, updates) => {
    useMessageStore.getState().updateMessage(id, updates);
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    }));
  },
  setLoading: (loading) => {
    useMessageStore.getState().setLoading(loading);
    set({ isLoading: loading });
  },
  setMode: (mode) => {
    useRunStore.getState().setMode(mode);
    set({ mode });
  },
  setPlanPhase: (phase) => {
    useRunStore.getState().setPlanPhase(phase);
    set({ planPhase: phase });
  },
  setContextMetrics: (metrics) => {
    useRunStore.getState().setContextMetrics(metrics);
    set((s) => ({
      contextMetrics: { ...s.contextMetrics, ...metrics },
    }));
  },
  setOllamaStatus: (status) => {
    useRunStore.getState().setOllamaStatus(status);
    set({ ollamaStatus: status });
  },
  setOllamaModel: (model) => {
    useRunStore.getState().setOllamaModel(model);
    set({ ollamaModel: model });
  },
  clearMessages: () => {
    useMessageStore.getState().clearMessages();
    set({ messages: [] });
  },
}));
