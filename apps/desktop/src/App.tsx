/**
 * React主组件 - Codex风格暗色极简UI
 * 使用拆分后的 stores + hooks + 组件：
 * - WorkbenchShell 三栏布局
 * - useAgentEvents 事件监听
 * - useSessionManager 会话管理
 * - useKnowledgeManager 知识库操作
 */

import React, { useCallback, useEffect } from 'react';
import { useSessionStore } from './stores/session-store.js';
import { useMessageStore } from './stores/message-store.js';
import { useRunStore } from './stores/run-store.js';
import { useWorkspaceStore } from './stores/workspace-store.js';
import { useAgentEvents } from './hooks/useAgentEvents.js';
import { useSessionManager } from './hooks/useSessionManager.js';
import { useKnowledgeManager } from './hooks/useKnowledgeManager.js';
import { WorkbenchShell } from './components/WorkbenchShell.js';

/** Electron preload暴露的API类型 */
declare global {
  interface Window {
    workagent?: {
      chat: (message: string, sessionId: string, mode?: string) => Promise<{ success: boolean; runId?: string; accepted?: boolean }>;
      chatAbort: () => Promise<{ success: boolean }>;
      createSession: (title?: string) => Promise<{ id: string; title: string; mode: 'chat' | 'plan' | 'execute'; updatedAt: number }>;
      listSessions: () => Promise<Array<{ id: string; title: string; mode: 'chat' | 'plan' | 'execute'; updatedAt: number }>>;
      deleteSession: (sessionId: string) => Promise<{ success: boolean }>;
      sessionMessages: (sessionId: string) => Promise<Array<{ id: string; role: string; content: string; timestamp: number }>>;
      sessionResume: (sessionId: string) => Promise<{
        runId: string;
        lastSequence: number;
        terminalStatus: string | null;
        lastAssistantContent: string;
        activePlanSnapshot: Record<string, unknown> | null;
        output: {
          draftContent: string | null;
          docPath: string | null;
        } | null;
        totalEvents: number;
        transcriptPath: string;
      } | null>;
      setPlanMode: (enabled: boolean, sessionId: string) => Promise<{ mode: string }>;
      approvePlan: (planId: string, approved: boolean, sessionId: string, updatedOutlineJson?: string) => Promise<unknown>;
      addKnowledge: (filePaths: string[], sessionId: string, workspaceId?: string | null) => Promise<unknown>;
      listKnowledge: (workspaceId?: string | null) => Promise<Array<{
        id: string;
        path: string;
        fileName: string;
        fileType: string;
        status: string;
        chunkCount: number;
        indexedAt: number | null;
        sourceWorkspaceId: string | null;
      }>>;
      knowledgeRefresh: (workspaceId?: string | null) => Promise<Array<{
        id: string;
        path: string;
        fileName: string;
        fileType: string;
        status: string;
        chunkCount: number;
        indexedAt: number | null;
        sourceWorkspaceId: string | null;
      }>>;
      knowledgeMove: (docIds: string[], workspaceId: string | null) => Promise<{ success: boolean }>;
      knowledgeRemoveBatch: (filePathOrDocIds: string[]) => Promise<{ success: boolean }>;
      removeKnowledge: (filePathOrDocId: string) => Promise<{ success: boolean; error?: string }>;
      searchKnowledge: (query: string, topK?: number) => Promise<unknown>;
      listWorkspaces: () => Promise<Array<{ id: string; name: string; rootPath: string; updatedAt: string; documentCount: number }>>;
      createWorkspace: (name: string, rootPath: string) => Promise<{ id: string; name: string; rootPath: string; updatedAt: string; documentCount: number }>;
      updateWorkspace: (workspaceId: string, updates: { name?: string; rootPath?: string }) => Promise<{ success: boolean }>;
      deleteWorkspace: (workspaceId: string) => Promise<{ success: boolean }>;
      bindSessionWorkspace: (workspaceId: string, sessionId: string) => Promise<{ success: boolean }>;
      unbindSessionWorkspace: (workspaceId: string, sessionId: string) => Promise<{ success: boolean }>;
      getSessionWorkspaceIds: (sessionId: string) => Promise<string[]>;
      permissionResponse: (toolName: string, allowed: boolean, remember?: boolean) => Promise<unknown>;
      updateSettings: (settings: Record<string, unknown>) => Promise<unknown>;
      getSettings: (key?: string) => Promise<unknown>;
      getModelsStatus: () => Promise<unknown>;
      openFileDialog: (options?: { multiple?: boolean; directory?: boolean; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string[]>;
      onAgentEvent: (callback: (event: unknown) => void) => () => void;
      onOllamaStatus: (callback: (status: unknown) => void) => () => void;
    };
  }
}

/**
 * 主App组件 - Codex暗色极简风格
 */
export function App(): React.ReactElement {
  // 使用拆分后的 hooks
  const { assistantMsgIdRef, isThinkingRef } = useAgentEvents();
  const { selectSession, createSession, deleteSession } = useSessionManager();
  const { addKnowledge, searchKnowledge } = useKnowledgeManager();

  useEffect(() => {
    void window.workagent?.listWorkspaces().then((workspaces) => {
      useWorkspaceStore.getState().setWorkspaceTree(
        workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          rootPath: workspace.rootPath,
          documentCount: workspace.documentCount,
          updatedAt: workspace.updatedAt,
        })),
      );
    });
  }, []);

  /** 发送消息 */
  const handleSend = useCallback(async (message: string) => {
    const api = window.workagent;
    const { isLoading } = useMessageStore.getState();
    if (!api || isLoading) return;

    let sessionId = useSessionStore.getState().currentSessionId;
    if (!sessionId) {
      const session = await api.createSession(message.slice(0, 30));
      sessionId = session.id;
      useSessionStore.getState().addSession(session);
      useSessionStore.getState().setCurrentSession(sessionId);
    }

    // 用户消息
    useMessageStore.getState().addMessage({
      id: `msg_${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });

    // 助手占位
    const assistantMsgId = `msg_${Date.now()}_asst`;
    assistantMsgIdRef.current = assistantMsgId;
    useMessageStore.getState().addMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
    });
    useMessageStore.getState().setLoading(true);

    try {
      const { mode } = useRunStore.getState();
      await api.chat(message, sessionId, mode);
    } catch (error) {
      useMessageStore.getState().updateMessage(assistantMsgId, {
        content: `发送失败: ${error instanceof Error ? error.message : String(error)}`,
      });
      useMessageStore.getState().setLoading(false);
    }
  }, [assistantMsgIdRef]);

  /** 切换Plan模式 */
  const togglePlanMode = useCallback(async () => {
    const { mode } = useRunStore.getState();
    const newMode = mode === 'plan' ? 'chat' : 'plan';
    const sessionId = useSessionStore.getState().currentSessionId;
    if (window.workagent && sessionId) {
      await window.workagent.setPlanMode(newMode === 'plan', sessionId);
    }
    useRunStore.getState().setMode(newMode);
  }, []);

  /** 中断对话 */
  const handleAbort = useCallback(async () => {
    if (window.workagent) {
      await window.workagent.chatAbort();
      useMessageStore.getState().setLoading(false);
    }
  }, []);

  /** 创建新会话 */
  const handleCreateSession = useCallback(async () => {
    await createSession('新对话');
  }, [createSession]);

  /** 搜索知识库 */
  const handleSearchKnowledge = useCallback(async (query: string) => {
    await searchKnowledge(query, 5);
  }, [searchKnowledge]);

  return (
    <WorkbenchShell
      onSend={handleSend}
      onAbort={handleAbort}
      onTogglePlanMode={togglePlanMode}
      onAddKnowledge={addKnowledge}
      onSearchKnowledge={handleSearchKnowledge}
      onSelectSession={selectSession}
      onCreateSession={handleCreateSession}
      onDeleteSession={deleteSession}
      assistantMsgIdRef={assistantMsgIdRef}
      isThinkingRef={isThinkingRef}
    />
  );
}

export default App;
