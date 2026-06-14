/**
 * useKnowledgeManager Hook
 * 封装知识库操作逻辑：导入文件、搜索、获取已导入列表
 */

import { useCallback } from 'react';
import { useSessionStore } from '../stores/session-store.js';
import { useKnowledgeStore } from '../stores/knowledge-store.js';
import { useWorkspaceStore } from '../stores/workspace-store.js';

/**
 * 知识库管理 Hook
 * @returns 知识库操作
 */
export function useKnowledgeManager(): {
  /** 导入文件到知识库 */
  addKnowledge: () => Promise<void>;
  /** 搜索知识库 */
  searchKnowledge: (query: string, topK?: number) => Promise<void>;
  /** 获取已导入文档列表 */
  loadDocuments: () => Promise<void>;
} {
  /** 导入文件到知识库 */
  const addKnowledge = useCallback(async () => {
    const api = window.workagent;
    const { currentSessionId } = useSessionStore.getState();
    if (!api || !currentSessionId) return;

    try {
      const filePaths = await api.openFileDialog({
        multiple: true,
        filters: [{ name: '文档', extensions: ['docx', 'pptx', 'pdf', 'txt', 'md'] }],
      });
      if (filePaths.length > 0) {
        const { activeWorkspaceId } = useWorkspaceStore.getState();
        await api.addKnowledge(filePaths, currentSessionId, activeWorkspaceId);
        // 导入后刷新文档列表
        await loadDocuments();
      }
    } catch { /* 静默处理用户取消 */ }
  }, []);

  /** 搜索知识库 */
  const searchKnowledge = useCallback(async (query: string, topK: number = 5) => {
    const api = window.workagent;
    if (!api) return;

    try {
      const response = await api.searchKnowledge(query, topK);
      // 解析搜索结果
      if (response && typeof response === 'object' && 'results' in response) {
        const results = (response as { results: Array<{ content: string; sourceFile: string; sourceType: string; locator: string; score: number }> }).results;
        useKnowledgeStore.getState().setSearchResults(results);
      }
    } catch {
      useKnowledgeStore.getState().clearSearchResults();
    }
  }, []);

  /** 获取已导入文档列表 */
  const loadDocuments = useCallback(async () => {
    const api = window.workagent;
    if (!api) return;

    const { activeWorkspaceId } = useWorkspaceStore.getState();
    const docs = await api.listKnowledge(activeWorkspaceId);
    useKnowledgeStore.getState().setKnowledgeEntries(
      docs.map((doc) => ({
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
  }, []);

  return {
    addKnowledge,
    searchKnowledge,
    loadDocuments,
  };
}
