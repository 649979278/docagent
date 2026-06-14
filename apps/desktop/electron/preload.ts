/**
 * 预加载脚本 - 白名单API桥接
 * Renderer通过contextBridge访问的受限API
 */

import { contextBridge, ipcRenderer } from 'electron';

/** 暴露给Renderer的API */
const api = {
  // 对话
  chat: (message: string, sessionId: string, mode?: string) =>
    ipcRenderer.invoke('chat', message, sessionId, mode),

  // 中断对话
  chatAbort: () =>
    ipcRenderer.invoke('chat-abort'),

  // 会话管理
  createSession: (title?: string) =>
    ipcRenderer.invoke('session-create', title),
  listSessions: () =>
    ipcRenderer.invoke('session-list'),
  deleteSession: (sessionId: string) =>
    ipcRenderer.invoke('session-delete', sessionId),

  sessionMessages: (sessionId: string) =>
    ipcRenderer.invoke('session-messages', sessionId),

  // Plan模式
  setPlanMode: (enabled: boolean, sessionId: string) =>
    ipcRenderer.invoke('plan-mode', enabled, sessionId),
  approvePlan: (planId: string, approved: boolean, sessionId: string) =>
    ipcRenderer.invoke('plan-approve', planId, approved, sessionId),

  // 知识库
  addKnowledge: (filePaths: string[], sessionId: string) =>
    ipcRenderer.invoke('knowledge-add', filePaths, sessionId),
  searchKnowledge: (query: string, topK?: number) =>
    ipcRenderer.invoke('knowledge-search', query, topK),

  // 权限响应
  permissionResponse: (toolName: string, allowed: boolean, remember?: boolean) =>
    ipcRenderer.invoke('permission-response', toolName, allowed, remember),

  // 设置
  updateSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('settings-update', settings),
  getSettings: (key?: string) =>
    ipcRenderer.invoke('settings-get', key),

  // 模型状态
  getModelsStatus: () =>
    ipcRenderer.invoke('models-status'),

  // 文件对话框
  openFileDialog: (options?: { multiple?: boolean; filters?: Array<{ name: string; extensions: string[] }> }) =>
    ipcRenderer.invoke('open-file-dialog', options),

  // 事件监听
  onAgentEvent: (callback: (event: unknown) => void) => {
    const handler = (_ev: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('agent-event', handler);
    return () => ipcRenderer.removeListener('agent-event', handler);
  },

  // Ollama状态监听
  onOllamaStatus: (callback: (status: unknown) => void) => {
    const handler = (_ev: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('ollama-status', handler);
    return () => ipcRenderer.removeListener('ollama-status', handler);
  },
};

contextBridge.exposeInMainWorld('workagent', api);
