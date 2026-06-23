/**
 * 知识库相关 IPC 处理器。
 * 负责 knowledge-add、knowledge-search、knowledge-remove 三个 IPC 通道。
 *
 * 注意：knowledge-remove 只删除数据库记录和向量索引，不删除用户磁盘上的原始文件。
 */

import { ipcMain } from 'electron';
import type { IpcHandlerContext } from './context.js';
import { updateDocumentsWorkspace, listDocuments, listDocumentsByWorkspace } from '@workagent/store';

/**
 * 注册知识库相关 IPC 处理器。
 * @param ctx - IPC 共享上下文。
 */
export function registerKnowledgeIpc(ctx: IpcHandlerContext): void {
  // 添加知识库文件
  ipcMain.handle('knowledge-add', async (_ev, filePaths: string[], sessionId: string, workspaceId?: string | null) => {
    const bundle = await ctx.ensureRuntime();

    const results: Array<{ filePath: string; status: string; documentId?: string; error?: string }> = [];

    for (const filePath of filePaths) {
      const result = await bundle.knowledgeService.addDocument(
        filePath,
        workspaceId ?? null,
        (progress, status, documentId) => {
          ctx.sendAgentEvent({
            sessionId,
            turnId: `index_${documentId}`,
            sequence: ctx.nextEventSeq(),
            type: 'index_progress',
            data: {
              job: {
                id: documentId,
                documentId,
                status,
                progress,
                error: null,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            },
            createdAt: Date.now(),
          });
        },
      );
      results.push(result);
    }

    return { filePaths, sessionId, results };
  });

  // 已导入文档列表
  ipcMain.handle('knowledge-list', async (_ev, workspaceId?: string | null) => {
    const db = await ctx.ensureDb();
    const docs = workspaceId
      ? listDocumentsByWorkspace(db, workspaceId)
      : listDocuments(db);
    return docs;
  });

  // 刷新知识库列表
  ipcMain.handle('knowledge-refresh', async (_ev, workspaceId?: string | null) => {
    const db = await ctx.ensureDb();
    return workspaceId ? listDocumentsByWorkspace(db, workspaceId) : listDocuments(db);
  });

  // 搜索知识库
  ipcMain.handle('knowledge-search', async (_ev, query: string, topK?: number) => {
    const bundle = await ctx.ensureRuntime();

    try {
      const results = await bundle.ragEngine.search(query, { topK: topK ?? 5 });
      return { query, topK: topK ?? 5, results };
    } catch (error) {
      return { query, topK: topK ?? 5, results: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 移除知识库文档
  // 只删除数据库记录和向量索引，不删除用户磁盘上的原始文件
  ipcMain.handle('knowledge-remove', async (_ev, filePathOrDocId: string) => {
    const bundle = await ctx.ensureRuntime();
    return bundle.knowledgeService.removeDocument(filePathOrDocId);
  });

  // 批量移除知识库文档
  ipcMain.handle('knowledge-remove-batch', async (_ev, filePathOrDocIds: string[]) => {
    const bundle = await ctx.ensureRuntime();
    return bundle.knowledgeService.removeDocuments(filePathOrDocIds);
  });

  // 迁移知识库文档到目标工作区
  ipcMain.handle('knowledge-move', async (_ev, docIds: string[], workspaceId: string | null) => {
    const db = await ctx.ensureDb();
    updateDocumentsWorkspace(db, docIds, workspaceId);
    return { success: true };
  });
}
