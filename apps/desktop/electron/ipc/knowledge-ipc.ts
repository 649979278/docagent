/**
 * 知识库相关 IPC 处理器。
 * 负责 knowledge-add、knowledge-search、knowledge-remove 三个 IPC 通道。
 *
 * 注意：knowledge-remove 只删除数据库记录和向量索引，不删除用户磁盘上的原始文件。
 */

import { ipcMain } from 'electron';
import type { IpcHandlerContext } from './context.js';
import { getDocumentByPath, updateDocument, updateDocumentsWorkspace, createDocument, listDocuments, listDocumentsByWorkspace, deleteDocuments } from '@workagent/store';

/**
 * 注册知识库相关 IPC 处理器。
 * @param ctx - IPC 共享上下文。
 */
export function registerKnowledgeIpc(ctx: IpcHandlerContext): void {
  // 添加知识库文件
  ipcMain.handle('knowledge-add', async (_ev, filePaths: string[], sessionId: string, workspaceId?: string | null) => {
    const db = await ctx.ensureDb();
    const bundle = await ctx.ensureRuntime();
    const ingestPipeline = bundle.ingestPipeline;
    const ragEngine = bundle.ragEngine;
    const modelProvider = bundle.modelProvider;

    const results: Array<{ filePath: string; status: string; documentId?: string; error?: string }> = [];

    for (const filePath of filePaths) {
      try {
        const existingDoc = getDocumentByPath(db, filePath);
        const idempotent = await ingestPipeline.checkIdempotent(
          filePath,
          existingDoc?.sha256,
          existingDoc?.id,
        );

        if (!idempotent.needsIngest && existingDoc) {
          results.push({ filePath, status: 'skipped', documentId: existingDoc.id });
          continue;
        }

        if (existingDoc && idempotent.needsIngest) {
          await ragEngine.removeDocument(filePath);
        }

        const doc = await ingestPipeline.ingest(filePath);

        const docId = existingDoc?.id ?? `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        if (!existingDoc) {
          createDocument(db, {
            id: docId,
            path: filePath,
            fileName: doc.fileName,
            fileType: doc.fileType,
            sha256: idempotent.contentHash,
            fileSize: (doc.content.length * 2),
            embeddingModel: modelProvider.getConfig().embeddingModel,
            sourceWorkspaceId: workspaceId ?? null,
          });
        } else {
          updateDocument(db, docId, {
            status: 'queued',
            error: null,
            sourceWorkspaceId: workspaceId ?? existingDoc.sourceWorkspaceId ?? null,
          });
        }
        updateDocument(db, docId, { status: 'extracting' });

        // 通过 RAGEngine 索引（传入 docId 以便 metadataStore 关联 chunks 到 documents）
        await ragEngine.indexDocument(doc, (progress) => {
          ctx.sendAgentEvent({
            sessionId,
            turnId: `index_${docId}`,
            sequence: ctx.nextEventSeq(),
            type: 'index_progress',
            data: {
              job: {
                id: docId,
                documentId: docId,
                status: progress < 100 ? 'embedding' : 'indexed',
                progress,
                error: null,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            },
            createdAt: Date.now(),
          });
        }, docId);

        updateDocument(db, docId, {
          status: 'indexed',
          indexedAt: Date.now(),
          chunkCount: doc.sections.length,
        });
        db.save();

        results.push({
          filePath,
          status: existingDoc ? 'reindexed' : 'indexed',
          documentId: docId,
        });
      } catch (error) {
        results.push({
          filePath,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
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
    const db = await ctx.ensureDb();
    const bundle = await ctx.ensureRuntime();

    // 查找 document 记录（by path or id）
    const doc = db.prepare(
      'SELECT id, path FROM documents WHERE id = ? OR path = ?',
    ).get(filePathOrDocId, filePathOrDocId) as { id: string; path: string } | undefined;

    if (!doc) return { success: false, error: 'Document not found' };

    // 1. 删除向量索引（不删原始文件）
    try {
      await bundle.ragEngine.removeDocument(doc.path);
    } catch {
      // 向量清理失败不阻塞
    }

    // 2. 删除 chunks（FTS5 触发器自动删除 chunks_fts 对应行）
    db.prepare('DELETE FROM chunks WHERE document_id = ?').run(doc.id);

    // 3. 删除 documents 记录
    db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);

    db.save();
    return { success: true };
  });

  // 批量移除知识库文档
  ipcMain.handle('knowledge-remove-batch', async (_ev, filePathOrDocIds: string[]) => {
    const db = await ctx.ensureDb();
    deleteDocuments(db, filePathOrDocIds.map((item) => {
      const doc = db.prepare(
        'SELECT id FROM documents WHERE id = ? OR path = ?',
      ).get(item, item) as { id: string } | undefined;
      return doc?.id ?? item;
    }));
    db.save();
    return { success: true };
  });

  // 迁移知识库文档到目标工作区
  ipcMain.handle('knowledge-move', async (_ev, docIds: string[], workspaceId: string | null) => {
    const db = await ctx.ensureDb();
    updateDocumentsWorkspace(db, docIds, workspaceId);
    db.save();
    return { success: true };
  });
}
