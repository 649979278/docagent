/**
 * 会话状态管理 Store
 * 管理会话列表、当前会话ID、会话切换
 */

import { create } from 'zustand';

/** 会话类型 */
export interface Session {
  id: string;
  title: string;
  mode: 'chat' | 'plan' | 'execute';
  updatedAt: number;
}

/** 会话状态 */
export interface SessionState {
  /** 会话列表 */
  sessions: Session[];
  /** 当前活跃会话ID */
  currentSessionId: string | null;

  /** 设置会话列表 */
  setSessions: (sessions: Session[]) => void;
  /** 添加会话 */
  addSession: (session: Session) => void;
  /** 设置当前会话 */
  setCurrentSession: (id: string | null) => void;
  /** 删除会话（从列表中移除） */
  removeSession: (id: string) => void;
}

/**
 * 会话状态 Store
 */
export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  currentSessionId: null,

  setSessions: (sessions) => set({ sessions }),
  addSession: (session) => set((s) => ({ sessions: [session, ...s.sessions] })),
  setCurrentSession: (id) => set({ currentSessionId: id }),
  removeSession: (id) => set((s) => ({
    sessions: s.sessions.filter((sess) => sess.id !== id),
    currentSessionId: s.currentSessionId === id ? null : s.currentSessionId,
  })),
}));
