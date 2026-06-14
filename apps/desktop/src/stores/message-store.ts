/**
 * 消息状态管理 Store
 * 管理消息列表、加载状态、助手消息流式更新
 */

import { create } from 'zustand';

/** 工具调用信息 */
export interface ToolCallInfo {
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
}

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

/** 消息状态 */
export interface MessageState {
  /** 消息列表 */
  messages: ChatMessage[];
  /** 是否正在加载（模型生成中） */
  isLoading: boolean;

  /** 添加消息 */
  addMessage: (message: ChatMessage) => void;
  /** 更新消息 */
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  /** 设置加载状态 */
  setLoading: (loading: boolean) => void;
  /** 清空消息 */
  clearMessages: () => void;
}

/**
 * 消息状态 Store
 */
export const useMessageStore = create<MessageState>((set) => ({
  messages: [],
  isLoading: false,

  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  updateMessage: (id, updates) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),
  setLoading: (loading) => set({ isLoading: loading }),
  clearMessages: () => set({ messages: [] }),
}));
