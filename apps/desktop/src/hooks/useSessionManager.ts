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
  createSession: (title?: string) => Promise<string | null>;
  /** 删除会话 */
  deleteSession: (id: string) => Promise<void>;
} {
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
        recoverySnapshot: resume ? {
          runId: resume.runId,
          terminalStatus: resume.terminalStatus,
          lastAssistantContent: resume.lastAssistantContent,
          activePlanSnapshot: resume.activePlanSnapshot,
          output: resume.output ?? null,
          totalEvents: resume.totalEvents,
          transcriptPath: resume.transcriptPath,
        } : null,
        activePlanSnapshot: resume?.activePlanSnapshot ?? null,
        output: resume?.output ?? null,
      });
    }
  }, []);

  /** 初始化加载会话列表 */
  const initSessions = useCallback(() => {
    window.workagent?.listSessions().then((sessions) => {
      useSessionStore.getState().setSessions(sessions);
      if (!useSessionStore.getState().currentSessionId && sessions.length > 0) {
        void selectSession(sessions[0].id);
      }
    });
  }, [selectSession]);

  /** 创建新会话 */
  const createSession = useCallback(async (title?: string): Promise<string | null> => {
    const api = window.workagent;
    if (!api) return null;
    const session = await api.createSession(title ?? '新对话');
    useSessionStore.getState().addSession(session);
    useSessionStore.getState().setCurrentSession(session.id);
    useMessageStore.getState().clearMessages();
    return session.id;
  }, []);

  /** 删除会话 */
  const deleteSession = useCallback(async (id: string) => {
    if (window.workagent) {
      await window.workagent.deleteSession(id);
      const { currentSessionId } = useSessionStore.getState();
      if (currentSessionId === id) {
        useSessionStore.getState().setCurrentSession(null);
        useMessageStore.getState().clearMessages();
      }
      // 刷新会话列表
      const sessions = await window.workagent.listSessions();
      useSessionStore.getState().setSessions(sessions);
    }
  }, []);

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
