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
import { useSettingsStore, type PermissionPolicy, type ThemeMode, type ReasoningLevel, type ArchivedSessionRecord } from './stores/settings-store.js';
import { useAgentEvents } from './hooks/useAgentEvents.js';
import { useSessionManager } from './hooks/useSessionManager.js';
import { useKnowledgeManager } from './hooks/useKnowledgeManager.js';
import { WorkbenchShell } from './components/WorkbenchShell.js';
import { normalizeOllamaStatus, resolveActiveModelName, type RendererModelsStatus } from './utils/model-status.js';

/** Electron preload暴露的API类型 */
declare global {
  interface Window {
    workagent?: {
      chat: (message: string, sessionId: string, mode?: string) => Promise<{ success: boolean; runId?: string; accepted?: boolean }>;
      chatAbort: () => Promise<{ success: boolean }>;
      createSession: (title?: string) => Promise<{ id: string; title: string; mode: 'chat' | 'plan' | 'execute'; updatedAt: number }>;
      listSessions: () => Promise<Array<{ id: string; title: string; mode: 'chat' | 'plan' | 'execute'; updatedAt: number }>>;
      deleteSession: (sessionId: string) => Promise<{ success: boolean }>;
      updateSessionTitle: (sessionId: string, title: string) => Promise<{ success: boolean }>;
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
      getModelsStatus: () => Promise<RendererModelsStatus>;
      openFileDialog: (options?: { multiple?: boolean; directory?: boolean; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string[]>;
      revealInExplorer: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
      onAgentEvent: (callback: (event: unknown) => void) => () => void;
      onOllamaStatus: (callback: (status: unknown) => void) => () => void;
      onMenuCommand: (callback: (command: unknown) => void) => () => void;
      windowControl: (action: 'minimize' | 'maximize' | 'close') => Promise<{ success: boolean }>;
    };
  }
}

/**
 * 将模型状态同步到运行状态 store，保证右侧面板和顶栏反映真实后端状态。
 */
function applyModelsStatus(status: RendererModelsStatus): void {
  const runStore = useRunStore.getState();
  const settingsStore = useSettingsStore.getState();
  runStore.setOllamaStatus(normalizeOllamaStatus(status));
  const activeModel = settingsStore.activeModel || resolveActiveModelName(status);
  const modelNames = [
    ...(status.providers?.flatMap((provider) => provider.models) ?? []),
    ...(status.models?.map((model) => model.name) ?? []),
  ].filter((name, index, arr) => name && arr.indexOf(name) === index);
  runStore.setOllamaModel(activeModel || resolveActiveModelName(status));
  settingsStore.setAvailableModels(modelNames);
}

/**
 * 从 settings-get 的存储格式中读取 { value } 包装值。
 */
function unwrapSetting<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object' && 'value' in value) {
    return (value as { value: T }).value ?? fallback;
  }
  return (value as T) ?? fallback;
}

/**
 * 应用主题和字体缩放设置到根节点。
 */
function applyVisualSettings(themeMode: ThemeMode, fontScale: number): void {
  const root = document.documentElement;
  const effectiveTheme = themeMode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : themeMode;
  root.dataset.theme = effectiveTheme;
  root.style.setProperty('--wa-font-scale', `${fontScale / 100}`);
}

/**
 * 从用户首句生成会话标题。
 */
function createSessionTitleFromMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.length > 20 ? `${normalized.slice(0, 20)}...` : normalized || '新对话';
}

/**
 * 主App组件 - Codex暗色极简风格
 */
export function App(): React.ReactElement {
  // 使用拆分后的 hooks
  const { assistantMsgIdRef, isThinkingRef } = useAgentEvents();
  const { selectSession, createSession, deleteSession } = useSessionManager();
  const { addKnowledge, searchKnowledge } = useKnowledgeManager();

  /**
 * 使用目录创建项目并绑定当前会话。
 */
  const createProjectFromDirectory = useCallback(async () => {
    const api = window.workagent;
    if (!api) return;
    const [rootPath] = await api.openFileDialog({ directory: true });
    if (!rootPath) return;
    const name = rootPath.split(/[\\/]/).filter(Boolean).pop() ?? '新项目';
    const workspace = await api.createWorkspace(name, rootPath);
    useWorkspaceStore.getState().addWorkspace({
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath,
      documentCount: workspace.documentCount,
      updatedAt: workspace.updatedAt,
    });
    useWorkspaceStore.getState().setActiveWorkspaceId(workspace.id);
    let sessionId = useSessionStore.getState().currentSessionId;
    if (!sessionId) {
      const session = await api.createSession('新对话');
      sessionId = session.id;
      useSessionStore.getState().addSession(session);
      useSessionStore.getState().setCurrentSession(session.id);
      useMessageStore.getState().clearMessages();
      useRunStore.getState().resetSessionRuntime('chat');
    }
    if (sessionId) {
      await api.bindSessionWorkspace(workspace.id, sessionId);
      useWorkspaceStore.getState().setSessionWorkspaceIds(sessionId, [workspace.id]);
    }
  }, []);

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

  useEffect(() => {
    const api = window.workagent;
    if (!api) return undefined;
    return api.onMenuCommand((command) => {
      const type = (command as { type?: string })?.type;
      if (type === 'new-chat') {
        void createSession('新对话');
      }
      if (type === 'open-project') {
        void createProjectFromDirectory();
      }
    });
  }, [createProjectFromDirectory, createSession]);

  useEffect(() => {
    const api = window.workagent;
    if (!api) return;

    void Promise.all([
      api.getSettings('permission_policy'),
      api.getSettings('ui_theme'),
      api.getSettings('ui_font_scale'),
      api.getSettings('openai_compat_url'),
      api.getSettings('openai_compat_model'),
      api.getSettings('reasoning_level'),
      api.getSettings('archived_sessions'),
    ]).then(([permissionPolicy, themeMode, fontScale, ollamaBaseUrl, activeModel, reasoningLevel, archivedSessions]) => {
      const settings = {
        permissionPolicy: unwrapSetting<PermissionPolicy>(permissionPolicy, 'ask_dangerous'),
        themeMode: unwrapSetting<ThemeMode>(themeMode, 'dark'),
        fontScale: unwrapSetting<number>(fontScale, 100),
        ollamaBaseUrl: unwrapSetting<string>(ollamaBaseUrl, 'http://localhost:11434'),
        activeModel: unwrapSetting<string>(activeModel, 'qwen3.5:9b'),
        reasoningLevel: unwrapSetting<ReasoningLevel>(reasoningLevel, 'high'),
        archivedSessions: unwrapSetting<ArchivedSessionRecord[]>(archivedSessions, []),
      };
      useSettingsStore.getState().hydrateSettings(settings);
      applyVisualSettings(settings.themeMode, settings.fontScale);
      useRunStore.getState().setOllamaModel(settings.activeModel);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const api = window.workagent;
    if (!api) return undefined;

    void api.getModelsStatus().then(applyModelsStatus).catch(() => {
      useRunStore.getState().setOllamaStatus('start_failed');
    });

    return api.onOllamaStatus((status) => {
      useRunStore.getState().setOllamaStatus(normalizeOllamaStatus(status));
      void api.getModelsStatus().then(applyModelsStatus).catch(() => undefined);
    });
  }, []);

  /** 发送消息 */
  const handleSend = useCallback(async (message: string) => {
    const api = window.workagent;
    const { isLoading } = useMessageStore.getState();
    if (!api || isLoading) return;

    let sessionId = useSessionStore.getState().currentSessionId;
    if (!sessionId) {
      const session = await api.createSession(createSessionTitleFromMessage(message));
      sessionId = session.id;
      useSessionStore.getState().addSession(session);
      useSessionStore.getState().setCurrentSession(sessionId);
      useRunStore.getState().resetSessionRuntime('chat');
      const activeWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId;
      if (activeWorkspaceId) {
        await api.bindSessionWorkspace(activeWorkspaceId, sessionId);
        useWorkspaceStore.getState().setSessionWorkspaceIds(sessionId, [activeWorkspaceId]);
      }
    } else {
      const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
      if (!session || session.title === '新对话') {
        const title = createSessionTitleFromMessage(message);
        useSessionStore.getState().updateSessionTitle(sessionId, title);
        void api.updateSessionTitle(sessionId, title);
      }
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
    const api = window.workagent;
    if (!api) {
      useRunStore.getState().setMode(newMode);
      return;
    }
    let sessionId = useSessionStore.getState().currentSessionId;
    if (!sessionId) {
      const session = await api.createSession('新对话');
      sessionId = session.id;
      useSessionStore.getState().addSession(session);
      useSessionStore.getState().setCurrentSession(sessionId);
      useMessageStore.getState().clearMessages();
      useRunStore.getState().resetSessionRuntime('chat');
    }
    await api.setPlanMode(newMode === 'plan', sessionId);
    if (newMode === 'chat') {
      useRunStore.getState().resetSessionRuntime('chat');
      useRunStore.getState().setDiagnostics({
        activePlanId: null,
        activePlanSnapshot: null,
        output: null,
      });
    } else {
      useRunStore.getState().setMode('plan');
      useRunStore.getState().setPlanPhase('PLAN_COLLECT');
    }
  }, []);

  /** 中断对话 */
  const handleAbort = useCallback(async () => {
    if (window.workagent) {
      await window.workagent.chatAbort();
      useMessageStore.getState().setLoading(false);
    }
  }, []);

  /** 创建新会话 */
  const handleCreateSession = useCallback(async (workspaceId?: string | null) => {
    const targetWorkspaceId = workspaceId ?? useWorkspaceStore.getState().activeWorkspaceId;
    return await createSession('新对话', targetWorkspaceId ?? undefined);
  }, [createSession]);

  /** 搜索知识库 */
  const handleSearchKnowledge = useCallback(async (query: string) => {
    await searchKnowledge(query, 5);
  }, [searchKnowledge]);

  /** 从设置页恢复归档会话，并切换到对应项目上下文。 */
  const handleRestoreArchivedSession = useCallback((sessionId: string, workspaceId: string) => {
    useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId === '__default__' ? null : workspaceId);
    void selectSession(sessionId);
  }, [selectSession]);

  return (
    <WorkbenchShell
      onSend={handleSend}
      onAbort={handleAbort}
      onTogglePlanMode={togglePlanMode}
      onAddKnowledge={addKnowledge}
      onSearchKnowledge={handleSearchKnowledge}
      onSelectSession={selectSession}
      onCreateSession={handleCreateSession}
      onOpenProject={createProjectFromDirectory}
      onDeleteSession={(sessionId, workspaceId) => deleteSession(sessionId, workspaceId)}
      onRestoreArchivedSession={handleRestoreArchivedSession}
      assistantMsgIdRef={assistantMsgIdRef}
      isThinkingRef={isThinkingRef}
    />
  );
}

export default App;
