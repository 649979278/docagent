/**
 * 系统设置状态管理。
 * 统一保存权限策略、主题、字号、模型地址和可用模型列表。
 */

import { create } from 'zustand';

/** 工具权限审批策略。 */
export type PermissionPolicy = 'ask_every_time' | 'ask_dangerous' | 'full_access';

/** 外观主题模式。 */
export type ThemeMode = 'dark' | 'light' | 'system';

/** 模型思考等级。 */
export type ReasoningLevel = 'low' | 'medium' | 'high';

/** 已归档会话记录。 */
export interface ArchivedSessionRecord {
  /** 会话 ID。 */
  sessionId: string;
  /** 所属项目 ID，未绑定项目时使用 __default__。 */
  workspaceId: string;
  /** 项目展示名称。 */
  workspaceName: string;
  /** 会话标题快照。 */
  sessionTitle: string;
  /** 归档时间。 */
  archivedAt: number;
}

/** 设置状态。 */
export interface SettingsState {
  /** 权限审批策略。 */
  permissionPolicy: PermissionPolicy;
  /** 主题模式。 */
  themeMode: ThemeMode;
  /** 全局字体缩放百分比。 */
  fontScale: number;
  /** Ollama 服务地址。 */
  ollamaBaseUrl: string;
  /** 当前聊天模型。 */
  activeModel: string;
  /** 模型思考等级。 */
  reasoningLevel: ReasoningLevel;
  /** 可用模型名称。 */
  availableModels: string[];
  /** 已归档会话。 */
  archivedSessions: ArchivedSessionRecord[];
  /** 设置权限策略。 */
  setPermissionPolicy: (policy: PermissionPolicy) => void;
  /** 设置主题模式。 */
  setThemeMode: (mode: ThemeMode) => void;
  /** 设置字体缩放。 */
  setFontScale: (scale: number) => void;
  /** 设置 Ollama 服务地址。 */
  setOllamaBaseUrl: (url: string) => void;
  /** 设置当前模型。 */
  setActiveModel: (model: string) => void;
  /** 设置模型思考等级。 */
  setReasoningLevel: (level: ReasoningLevel) => void;
  /** 设置可用模型列表。 */
  setAvailableModels: (models: string[]) => void;
  /** 覆盖已归档会话列表。 */
  setArchivedSessions: (records: ArchivedSessionRecord[]) => void;
  /** 记录归档会话。 */
  archiveSession: (record: ArchivedSessionRecord) => void;
  /** 恢复归档会话。 */
  restoreArchivedSession: (sessionId: string, workspaceId: string) => void;
  /** 移除某个项目下的所有归档会话。 */
  removeWorkspaceArchives: (workspaceId: string) => void;
  /** 批量合并设置。 */
  hydrateSettings: (settings: Partial<Pick<SettingsState, 'permissionPolicy' | 'themeMode' | 'fontScale' | 'ollamaBaseUrl' | 'activeModel' | 'availableModels' | 'reasoningLevel' | 'archivedSessions'>>) => void;
}

/**
 * 系统设置 Store。
 */
export const useSettingsStore = create<SettingsState>((set) => ({
  permissionPolicy: 'ask_dangerous',
  themeMode: 'dark',
  fontScale: 100,
  ollamaBaseUrl: 'http://localhost:11434',
  activeModel: 'qwen3.5:9b',
  reasoningLevel: 'high',
  availableModels: [],
  archivedSessions: [],

  setPermissionPolicy: (permissionPolicy) => set({ permissionPolicy }),
  setThemeMode: (themeMode) => set({ themeMode }),
  setFontScale: (fontScale) => set({ fontScale }),
  setOllamaBaseUrl: (ollamaBaseUrl) => set({ ollamaBaseUrl }),
  setActiveModel: (activeModel) => set({ activeModel }),
  setReasoningLevel: (reasoningLevel) => set({ reasoningLevel }),
  setAvailableModels: (availableModels) => set({ availableModels }),
  setArchivedSessions: (archivedSessions) => set({ archivedSessions }),
  archiveSession: (record) => set((state) => ({
    archivedSessions: [
      record,
      ...state.archivedSessions.filter((item) => !(item.sessionId === record.sessionId && item.workspaceId === record.workspaceId)),
    ],
  })),
  restoreArchivedSession: (sessionId, workspaceId) => set((state) => ({
    archivedSessions: state.archivedSessions.filter((item) => !(item.sessionId === sessionId && item.workspaceId === workspaceId)),
  })),
  removeWorkspaceArchives: (workspaceId) => set((state) => ({
    archivedSessions: state.archivedSessions.filter((item) => item.workspaceId !== workspaceId),
  })),
  hydrateSettings: (settings) => set((state) => ({ ...state, ...settings })),
}));
