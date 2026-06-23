import path from 'node:path';

import { countTokens, type ExtractedDocument } from '@workagent/shared';
import type { IngestPipeline } from '@workagent/ingest';
import type { RAGEngine } from '@workagent/rag';
import type { ModelProvider } from '@workagent/model-provider';
import type { Database, DocumentRecord } from '@workagent/store';
import {
  createDocument,
  deleteChunksByDocument,
  deleteDocument,
  getDocument,
  getDocumentByPath,
  updateDocument,
} from '@workagent/store';

/** 知识库索引进度回调。 */
export type KnowledgeProgressCallback = (progress: number, status: 'extracting' | 'embedding' | 'indexed', documentId: string) => void;

/** 知识库添加结果。 */
export interface KnowledgeAddResult {
  filePath: string;
  status: 'skipped' | 'indexed' | 'reindexed' | 'failed';
  documentId?: string;
  error?: string;
}

/** 知识库服务依赖。 */
export interface KnowledgeServiceDeps {
  db: Database;
  ingestPipeline: IngestPipeline;
  ragEngine: RAGEngine;
  modelProvider: ModelProvider;
}

/**
 * 知识库应用服务。
 * 统一管理 document、chunks/FTS、vector index 和 workspace 绑定，避免 IPC/Worker/Tool 各自实现索引语义。
 */
export class KnowledgeService {
  private readonly db: Database;
  private readonly ingestPipeline: IngestPipeline;
  private readonly ragEngine: RAGEngine;
  private readonly modelProvider: ModelProvider;

  /**
   * 创建知识库服务。
   * @param deps - 服务依赖。
   */
  constructor(deps: KnowledgeServiceDeps) {
    this.db = deps.db;
    this.ingestPipeline = deps.ingestPipeline;
    this.ragEngine = deps.ragEngine;
    this.modelProvider = deps.modelProvider;
  }

  /**
   * 添加或重建单个知识库文档。
   * @param filePath - 文件路径。
   * @param workspaceId - 可选工作区 ID。
   * @param onProgress - 进度回调。
   * @returns 添加结果。
   */
  async addDocument(
    filePath: string,
    workspaceId?: string | null,
    onProgress?: KnowledgeProgressCallback,
  ): Promise<KnowledgeAddResult> {
    let pendingDocId: string | undefined;
    try {
      const existingDoc = getDocumentByPath(this.db, filePath);
      const idempotent = await this.ingestPipeline.checkIdempotent(
        filePath,
        existingDoc?.sha256,
        existingDoc?.id,
      );

      if (!idempotent.needsIngest && existingDoc) {
        return { filePath, status: 'skipped', documentId: existingDoc.id };
      }

      if (existingDoc) {
        await this.removeDocument(existingDoc.id, { keepOriginalFile: true, ignoreMissing: true });
      }

      const document = await this.ingestPipeline.ingest(filePath);
      const docId = existingDoc?.id ?? `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      pendingDocId = docId;
      this.upsertDocumentRecord(docId, document, idempotent.contentHash, workspaceId ?? existingDoc?.sourceWorkspaceId ?? null);

      onProgress?.(5, 'extracting', docId);
      onProgress?.(20, 'embedding', docId);
      const chunks = await this.ragEngine.indexDocument(document, (progress) => {
        onProgress?.(20 + Math.round(progress * 0.75), progress < 100 ? 'embedding' : 'indexed', docId);
      });

      this.replaceChunkMetadata(docId, document, chunks);
      updateDocument(this.db, docId, {
        status: 'indexed',
        error: null,
        chunkCount: chunks.length,
        indexedAt: Date.now(),
      });

      onProgress?.(100, 'indexed', docId);
      return {
        filePath,
        status: existingDoc ? 'reindexed' : 'indexed',
        documentId: docId,
      };
    } catch (error) {
      const failedDoc = pendingDocId ? getDocument(this.db, pendingDocId) : getDocumentByPath(this.db, filePath);
      if (failedDoc) {
        updateDocument(this.db, failedDoc.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return {
        filePath,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 删除知识库文档的 DB 元数据、全文索引和向量索引，不删除用户原始文件。
   * @param filePathOrDocId - 文档 ID 或路径。
   * @param options - 删除选项。
   * @returns 是否删除成功。
   */
  async removeDocument(
    filePathOrDocId: string,
    options: { keepOriginalFile?: boolean; ignoreMissing?: boolean } = {},
  ): Promise<{ success: boolean; error?: string }> {
    const doc = this.findDocument(filePathOrDocId);
    if (!doc) {
      return options.ignoreMissing ? { success: true } : { success: false, error: 'Document not found' };
    }

    try {
      await this.ragEngine.removeDocument(doc.path);
    } catch {
      // 向量清理失败不阻塞 DB 元数据清理，重建时会按 sourceFile 覆盖。
    }

    const restoreFtsTriggers = disableChunkFtsDeleteTriggers(this.db);
    try {
      deleteVectorTextIndexByDocument(this.db, doc.id);
      deleteChunksByDocument(this.db, doc.id);
    } finally {
      restoreFtsTriggers();
    }
    deleteDocument(this.db, doc.id);
    return { success: true };
  }

  /**
   * 批量删除知识库文档。
   * @param filePathOrDocIds - 文档 ID 或路径列表。
   * @returns 删除结果。
   */
  async removeDocuments(filePathOrDocIds: string[]): Promise<{ success: boolean; results: Array<{ id: string; success: boolean; error?: string }> }> {
    const results = [];
    for (const item of filePathOrDocIds) {
      const result = await this.removeDocument(item);
      results.push({ id: item, ...result });
    }
    return {
      success: results.every((result) => result.success),
      results,
    };
  }

  /**
   * 回收磁盘上已不存在的知识库文档。
   * @returns 回收数量。
   */
  async reconcileDeletedKnowledge(): Promise<number> {
    const documents = this.db.prepare('SELECT id, path FROM documents').all() as Array<{ id: string; path: string }>;
    let removed = 0;
    for (const document of documents) {
      const fs = await import('node:fs');
      if (fs.existsSync(document.path)) {
        continue;
      }
      const result = await this.removeDocument(document.id, { ignoreMissing: true });
      if (result.success) {
        removed++;
      }
    }
    return removed;
  }

  /**
   * 创建或更新文档记录。
   * @param docId - 文档 ID。
   * @param document - 解析后的文档。
   * @param sha256 - 内容哈希。
   * @param workspaceId - 工作区 ID。
   */
  private upsertDocumentRecord(
    docId: string,
    document: ExtractedDocument,
    sha256: string,
    workspaceId: string | null,
  ): void {
    const existing = getDocument(this.db, docId);
    if (!existing) {
      createDocument(this.db, {
        id: docId,
        path: document.filePath,
        fileName: document.fileName,
        fileType: document.fileType,
        sha256,
        fileSize: document.content.length * 2,
        embeddingModel: this.modelProvider.getConfig().embeddingModel,
        sourceWorkspaceId: workspaceId,
      });
    }

    updateDocument(this.db, docId, {
      status: 'extracting',
      error: null,
      embeddingModel: this.modelProvider.getConfig().embeddingModel,
      sourceWorkspaceId: workspaceId,
    });
  }

  /**
   * 替换指定文档的 chunk 元数据，并触发 FTS 同步。
   * @param documentId - 文档 ID。
   * @param document - 解析后的文档。
   * @param chunks - RAG 分块结果。
   */
  private replaceChunkMetadata(
    documentId: string,
    document: ExtractedDocument,
    chunks: Array<{ chunkId: string; content: string; metadata: { locator?: string; chunkIndex?: number } }>,
  ): void {
    const transaction = this.db.transaction(() => {
      deleteChunksByDocument(this.db, documentId);
      const stmt = this.db.prepare(
        `INSERT INTO chunks (
          id, document_id, chunk_index, content_preview, source_locator,
          content, source_file, token_count, vector_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      chunks.forEach((chunk, index) => {
        stmt.run(
          chunk.chunkId,
          documentId,
          chunk.metadata.chunkIndex ?? index,
          chunk.content.slice(0, 100),
          chunk.metadata.locator ?? null,
          chunk.content,
          document.filePath,
          countTokens(chunk.content),
          chunk.chunkId,
          Date.now(),
        );
      });
    });
    transaction();
  }

  /**
   * 按 ID 或路径查找文档。
   * @param filePathOrDocId - 文档 ID 或路径。
   * @returns 文档记录。
   */
  private findDocument(filePathOrDocId: string): DocumentRecord | undefined {
    return getDocument(this.db, filePathOrDocId) ?? getDocumentByPath(this.db, filePathOrDocId);
  }
}

/**
 * 临时禁用 chunks FTS 删除相关触发器，避免手动清理 FTS 后主表删除再次触发 delete 异常。
 * @param db - 数据库实例。
 * @returns 恢复触发器的函数。
 */
function disableChunkFtsDeleteTriggers(db: Database): () => void {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'").get();
  if (!table) {
    return () => {};
  }
  db.exec('DROP TRIGGER IF EXISTS chunks_fts_delete; DROP TRIGGER IF EXISTS chunks_fts_update;');
  return () => {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, chunk_id, source_file, content)
        VALUES ('delete', old.rowid, old.id, old.source_file, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, chunk_id, source_file, content)
        VALUES ('delete', old.rowid, old.id, old.source_file, old.content);
        INSERT INTO chunks_fts(rowid, chunk_id, source_file, content)
        VALUES (new.rowid, new.id, new.source_file, new.content);
      END;
    `);
  };
}

/**
 * 删除指定文档在 chunks_fts 中的全文索引残留。
 * @param db - 数据库实例。
 * @param documentId - 文档 ID。
 */
function deleteVectorTextIndexByDocument(db: Database, documentId: string): void {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'").get();
  if (!table) {
    return;
  }
  const rows = db.prepare('SELECT rowid FROM chunks WHERE document_id = ?').all(documentId) as Array<{ rowid: number }>;
  const stmt = db.prepare("INSERT INTO chunks_fts(chunks_fts, rowid) VALUES ('delete', ?)");
  for (const row of rows) {
    try {
      stmt.run(row.rowid);
    } catch {
      // FTS 残留清理失败不应阻止主表删除；后续重建会覆盖向量和 metadata。
    }
  }
}

/**
 * 根据文件路径生成展示用文件名。
 * @param filePath - 文件路径。
 * @returns 文件名。
 */
export function getKnowledgeFileName(filePath: string): string {
  return path.basename(filePath);
}
