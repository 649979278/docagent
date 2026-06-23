/**
 * useSessionManager Hook
 * 封装会话管理逻辑：创建、切换、删除、初始化加载
 */

import { useCallback, useEffect } from 'react';
import { useSessionStore } from '../stores/session-store.js';
import { useMessageStore } from '../stores/message-store.js';
import { useRunStore } from '../stores/run-store.js';
import { useWorkspaceStore } from '../stores/workspace-store.js';
import { useKnowledgeStore } from '../stores/knowledge-store.js';

/**
 * 会话管理 Hook
 * @returns 会话管理操作
 */
export function useSessionManager(): {
  /** 初始化加载会话列表 */
  initSessions: () => void;
  /** 选择会话 */
  selectSession: (id: string) => Promise<void>;
  /** 创建新会话 */
  createSession: (title?: string, workspaceId?: string | null) => Promise<string | null>;
  /** 删除会话 */
  deleteSession: (id: string, preferredWorkspaceId?: string | null) => Promise<void>;
} {
  /**
   * 刷新会话与项目的绑定关系。
   * @param sessions - 当前会话列表。
   */
  const refreshSessionWorkspaceMap = useCallback(async (
    sessions: Array<{ id: string }>,
  ): Promise<Record<string, string[]>> => {
    const entries = await Promise.all(
      sessions.map(async (session) => ({
        id: session.id,
        workspaceIds: await window.workagent?.getSessionWorkspaceIds(session.id) ?? [],
      })),
    );
    const map = Object.fromEntries(entries.map((entry) => [entry.id, entry.workspaceIds]));
    useWorkspaceStore.getState().setSessionWorkspaceMap(map);
    return map;
  }, []);

  /** 选择会话 */
  const selectSession = useCallback(async (id: string) => {
    // 如果当前有正在进行的对话，先中断
    const { isLoading } = useMessageStore.getState();
    if (isLoading && window.workagent) {
      await window.workagent.chatAbort();
      useMessageStore.getState().setLoading(false);
    }
    // 切换会话
    useSessionStore.getState().setCurrentSession(id);
    if (window.workagent) {
      const msgs = await window.workagent.sessionMessages(id);
      const resume = await window.workagent.sessionResume(id);
      const workspaceIds = await window.workagent.getSessionWorkspaceIds(id);
      const knowledgeDocs = await window.workagent.listKnowledge(workspaceIds[0] ?? null);
      const session = useSessionStore.getState().sessions.find((item) => item.id === id);
      useMessageStore.getState().clearMessages();
      for (const m of msgs) {
        useMessageStore.getState().addMessage({
          id: m.id,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          timestamp: m.timestamp,
        });
      }
      useWorkspaceStore.getState().setActiveWorkspaceId(workspaceIds[0] ?? null);
      useWorkspaceStore.getState().setSessionWorkspaceIds(id, workspaceIds);
      const nextMode = session?.mode ?? 'chat';
      useRunStore.getState().setMode(nextMode);
      useRunStore.getState().setPlanPhase(
        nextMode === 'plan' && resume?.activePlanSnapshot
          ? 'PLAN_REVIEW'
          : nextMode === 'execute' && resume?.activePlanSnapshot
            ? 'EXECUTE_DRAFT'
            : 'PLAN_COLLECT',
      );
      useKnowledgeStore.getState().setKnowledgeEntries(
        knowledgeDocs.map((doc) => ({
          id: doc.id,
          title: doc.fileName,
          type: doc.fileType,
          indexedAt: doc.indexedAt ?? 0,
          chunkCount: doc.chunkCount,
          status: doc.status,
          sourceWorkspaceId: doc.sourceWorkspaceId,
          path: doc.path,
        })),
      );
      useRunStore.getState().setDiagnostics({
        runId: null,
        runStatus: undefined,
        terminalReason: null,
        ragHitCount: 0,
        ragInjectedTokens: 0,
        output: resume?.output ?? null,
        recoverySnapshot: resume ? {
          runId: resume.runId,
          terminalStatus: resume.terminalStatus,
          lastAssistantContent: resume.lastAssistantContent,
          activePlanSnapshot: resume.activePlanSnapshot,
          output: resume.output ?? null,
          totalEvents: resume.totalEvents,
          transcriptPath: resume.transcriptPath,
        } : null,
        activePlanSnapshot: nextMode === 'chat' ? null : (resume?.activePlanSnapshot ?? null),
        activePlanId: nextMode === 'chat' ? null : ((resume?.activePlanSnapshot as { id?: string } | null)?.id ?? null),
      });
    }
  }, []);

  /** 初始化加载会话列表 */
  const initSessions = useCallback(() => {
    window.workagent?.listSessions().then((sessions) => {
      useSessionStore.getState().setSessions(sessions);
      void refreshSessionWorkspaceMap(sessions);
      if (!useSessionStore.getState().currentSessionId && sessions.length > 0) {
        void selectSession(sessions[0].id);
      }
    });
  }, [refreshSessionWorkspaceMap, selectSession]);

  /** 创建新会话 */
  const createSession = useCallback(async (title?: string, workspaceId?: string | null): Promise<string | null> => {
    const api = window.workagent;
    if (!api) return null;
    const session = await api.createSession(title ?? '新对话');
    if (workspaceId) {
      await api.bindSessionWorkspace(workspaceId, session.id);
      useWorkspaceStore.getState().setSessionWorkspaceIds(session.id, [workspaceId]);
      useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
    } else {
      useWorkspaceStore.getState().setSessionWorkspaceIds(session.id, []);
    }
    useSessionStore.getState().addSession(session);
    useSessionStore.getState().setCurrentSession(session.id);
    useMessageStore.getState().clearMessages();
    useRunStore.getState().resetSessionRuntime('chat');
    useKnowledgeStore.getState().setKnowledgeEntries([]);
    return session.id;
  }, []);

  /** 删除会话 */
  const deleteSession = useCallback(async (id: string, preferredWorkspaceId?: string | null) => {
    const api = window.workagent;
    if (!api) return;

    const { currentSessionId, sessions: existingSessions } = useSessionStore.getState();
    const { activeWorkspaceId, sessionWorkspaceMap } = useWorkspaceStore.getState();
    const fallbackWorkspaceId = preferredWorkspaceId ?? activeWorkspaceId ?? sessionWorkspaceMap[id]?.[0] ?? null;

    await api.deleteSession(id);
    useWorkspaceStore.getState().setSessionWorkspaceIds(id, []);

    const sessions = await api.listSessions();
    useSessionStore.getState().setSessions(sessions);
    const nextMap = await refreshSessionWorkspaceMap(sessions);

    if (currentSessionId === id) {
      const sameWorkspaceSessions = fallbackWorkspaceId
        ? sessions.filter((session) => (nextMap[session.id] ?? []).includes(fallbackWorkspaceId))
        : sessions;
      const nextSession = sameWorkspaceSessions[0]
        ?? sessions[0]
        ?? existingSessions.find((session) => session.id !== id)
        ?? null;
      if (nextSession) {
        await selectSession(nextSession.id);
      } else {
        useSessionStore.getState().setCurrentSession(null);
        useMessageStore.getState().clearMessages();
        useRunStore.getState().resetSessionRuntime('chat');
        useKnowledgeStore.getState().setKnowledgeEntries([]);
      }
    }
  }, [refreshSessionWorkspaceMap, selectSession]);

  // 初始化时加载会话列表
  useEffect(() => {
    initSessions();
  }, [initSessions]);

  return {
    initSessions,
    selectSession,
    createSession,
    deleteSession,
  };
}
