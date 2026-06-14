/**
 * 预加载脚本 - 白名单API桥接
 * Renderer通过contextBridge访问的受限API
 * 7.4 Preload typed contract：每个 IPC handler 固定返回结构
 */

import { contextBridge, ipcRenderer } from 'electron';

// ============================================================
// IPC 返回类型契约
// ============================================================

/** chat 返回类型 */
interface ChatResult {
  runId: string;
  accepted: boolean;
  success: boolean;
}

/** session-list 返回类型 */
interface SessionListResult {
  sessions: Array<{
    id: string;
    title: string;
    mode: 'chat' | 'plan' | 'execute';
    updatedAt: number;
  }>;
}

/** session-messages 返回类型 */
interface SessionMessagesResult {
  messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
  }>;
  cursor?: string;
}

/** knowledge-search 返回类型 */
interface KnowledgeSearchResult {
  query: string;
  topK: number;
  results: Array<{
    content: string;
    sourceFile: string;
    sourceType: string;
    locator: string;
    score: number;
  }>;
  error?: string;
}

/** knowledge-add 返回类型 */
interface KnowledgeAddResult {
  filePaths: string[];
  sessionId: string;
  results: Array<{
    filePath: string;
    status: string;
    documentId?: string;
    error?: string;
  }>;
}

/** knowledge-list 返回类型 */
interface KnowledgeListItem {
  id: string;
  path: string;
  fileName: string;
  fileType: string;
  sha256: string;
  status: string;
  error: string | null;
  fileSize: number;
  chunkCount: number;
  embeddingModel: string | null;
  sourceWorkspaceId: string | null;
  createdAt: number;
  indexedAt: number | null;
}

/** session-resume 返回类型 */
interface SessionResumeResult {
  runId: string;
  lastSequence: number;
  terminalStatus: string | null;
  lastAssistantContent: string;
  activePlanSnapshot: Record<string, unknown> | null;
  totalEvents: number;
  transcriptPath: string;
}

/** workspace-list 返回类型 */
interface WorkspaceResult {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  documentCount: number;
}

/** models-status 返回类型 */
interface ModelsStatusResult {
  providers: Array<{
    name: string;
    available: boolean;
    models: string[];
  }>;
  activeModel: string;
  health: boolean;
}

/** 暴露给Renderer的API */
const api = {
  // 对话 - 固定返回 { runId, accepted, success }
  chat: (message: string, sessionId: string, mode?: string): Promise<ChatResult> =>
    ipcRenderer.invoke('chat', message, sessionId, mode),

  // 中断对话
  chatAbort: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('chat-abort'),

  // 会话管理
  createSession: (title?: string): Promise<{ id: string; title: string; mode: 'chat' | 'plan' | 'execute'; updatedAt: number }> =>
    ipcRenderer.invoke('session-create', title),

  listSessions: (): Promise<SessionListResult['sessions']> =>
    ipcRenderer.invoke('session-list'),

  deleteSession: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('session-delete', sessionId),

  sessionMessages: (sessionId: string): Promise<SessionMessagesResult['messages']> =>
    ipcRenderer.invoke('session-messages', sessionId),

  sessionResume: (sessionId: string): Promise<SessionResumeResult | null> =>
    ipcRenderer.invoke('session-resume', sessionId),

  // Plan模式
  setPlanMode: (enabled: boolean, sessionId: string): Promise<{ mode: string }> =>
    ipcRenderer.invoke('plan-mode', enabled, sessionId),

  approvePlan: (planId: string, approved: boolean, sessionId: string, updatedOutlineJson?: string): Promise<{ planId: string; approved: boolean; sessionId: string }> =>
    ipcRenderer.invoke('plan-approve', planId, approved, sessionId, updatedOutlineJson),

  // 知识库 - 固定返回结构
  addKnowledge: (filePaths: string[], sessionId: string, workspaceId?: string | null): Promise<KnowledgeAddResult> =>
    ipcRenderer.invoke('knowledge-add', filePaths, sessionId, workspaceId),

  listKnowledge: (workspaceId?: string | null): Promise<KnowledgeListItem[]> =>
    ipcRenderer.invoke('knowledge-list', workspaceId),

  searchKnowledge: (query: string, topK?: number): Promise<KnowledgeSearchResult> =>
    ipcRenderer.invoke('knowledge-search', query, topK),

  /** 移除知识库文档（只删除数据库记录和向量索引，不删除磁盘文件） */
  removeKnowledge: (filePathOrDocId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('knowledge-remove', filePathOrDocId),

  // 权限响应
  permissionResponse: (toolName: string, allowed: boolean, remember?: boolean): Promise<{ toolName: string; allowed: boolean; remember?: boolean }> =>
    ipcRenderer.invoke('permission-response', toolName, allowed, remember),

  // 设置
  updateSettings: (settings: Record<string, unknown>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings-update', settings),

  getSettings: (key?: string): Promise<unknown> =>
    ipcRenderer.invoke('settings-get', key),

  // 模型状态 - 固定返回结构
  getModelsStatus: (): Promise<ModelsStatusResult> =>
    ipcRenderer.invoke('models-status'),

  // 文件对话框
  openFileDialog: (options?: { multiple?: boolean; directory?: boolean; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string[]> =>
    ipcRenderer.invoke('open-file-dialog', options),

  // 工作区
  listWorkspaces: (): Promise<WorkspaceResult[]> =>
    ipcRenderer.invoke('workspace-list'),

  createWorkspace: (name: string, rootPath: string): Promise<WorkspaceResult> =>
    ipcRenderer.invoke('workspace-create', name, rootPath),

  updateWorkspace: (workspaceId: string, updates: { name?: string; rootPath?: string }): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('workspace-update', workspaceId, updates),

  deleteWorkspace: (workspaceId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('workspace-delete', workspaceId),

  bindSessionWorkspace: (workspaceId: string, sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('workspace-bind-session', workspaceId, sessionId),

  unbindSessionWorkspace: (workspaceId: string, sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('workspace-unbind-session', workspaceId, sessionId),

  getSessionWorkspaceIds: (sessionId: string): Promise<string[]> =>
    ipcRenderer.invoke('workspace-session-ids', sessionId),

  // 事件监听
  onAgentEvent: (callback: (event: unknown) => void): (() => void) => {
    const handler = (_ev: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('agent-event', handler);
    return () => ipcRenderer.removeListener('agent-event', handler);
  },

  // Ollama状态监听
  onOllamaStatus: (callback: (status: unknown) => void): (() => void) => {
    const handler = (_ev: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('ollama-status', handler);
    return () => ipcRenderer.removeListener('ollama-status', handler);
  },
};

contextBridge.exposeInMainWorld('workagent', api);
