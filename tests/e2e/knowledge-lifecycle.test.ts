import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { initDatabase, createDocument, createWorkspace, listDocumentsByWorkspace, getDocumentByPath, listDocuments } from '@workagent/store';
import { IngestPipeline } from '@workagent/ingest';
import { createDesktopRuntimeBundle } from '../../apps/desktop/electron/runtime-factory.js';

/**
 * 知识库生命周期测试。
 */
describe('knowledge lifecycle', () => {
  it('skips unchanged file, reindexes changed file, removes deleted knowledge, and survives restart', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workagent-knowledge-'));
    const filePath = path.join(tempDir, 'knowledge.txt');
    fs.writeFileSync(filePath, 'alpha', 'utf8');

    const db = await initDatabase({
      dbPath: path.join(tempDir, 'knowledge.db'),
    });

    const bundle = await createDesktopRuntimeBundle({
      db,
      autoApprovePermissions: true,
    });

    const pipeline = new IngestPipeline();
    const first = await pipeline.checkIdempotent(filePath);
    expect(first.needsIngest).toBe(true);

    createDocument(db, {
      id: 'doc-1',
      path: filePath,
      fileName: 'knowledge.txt',
      fileType: 'txt',
      sha256: first.contentHash,
    });
    db.save();

    const second = await pipeline.checkIdempotent(filePath, first.contentHash, 'doc-1');
    expect(second.needsIngest).toBe(false);

    fs.writeFileSync(filePath, 'alpha beta', 'utf8');
    const third = await pipeline.checkIdempotent(filePath, first.contentHash, 'doc-1');
    expect(third.needsIngest).toBe(true);

    const doc = getDocumentByPath(db, filePath);
    expect(doc?.id).toBe('doc-1');

    fs.unlinkSync(filePath);
    expect(fs.existsSync(filePath)).toBe(false);

    const recycledDb = await initDatabase({
      dbPath: path.join(tempDir, 'knowledge.db'),
    });
    const reloadedBundle = await createDesktopRuntimeBundle({
      db: recycledDb,
      autoApprovePermissions: true,
      appDataDir: tempDir,
    });

    const removedDoc = getDocumentByPath(recycledDb, filePath);
    const remainingDocs = listDocuments(recycledDb);
    const stats = await reloadedBundle.ragEngine.getStats();

    expect(removedDoc).toBeUndefined();
    expect(remainingDocs).toHaveLength(0);
    expect(stats.uniqueSources).toBe(0);
    expect(bundle.runtime.getPlanController()).toBeDefined();
  });

  it('stores workspace linkage for knowledge documents and supports workspace-scoped listing', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workagent-knowledge-workspace-'));
    const db = await initDatabase({
      dbPath: path.join(tempDir, 'workspace-knowledge.db'),
    });

    createWorkspace(db, {
      id: 'ws-knowledge',
      name: '知识工作区',
      rootPath: tempDir,
    });

    createDocument(db, {
      id: 'doc-workspace-1',
      path: path.join(tempDir, 'a.txt'),
      fileName: 'a.txt',
      fileType: 'txt',
      sha256: 'hash-a',
      sourceWorkspaceId: 'ws-knowledge',
    });
    createDocument(db, {
      id: 'doc-workspace-2',
      path: path.join(tempDir, 'b.txt'),
      fileName: 'b.txt',
      fileType: 'txt',
      sha256: 'hash-b',
      sourceWorkspaceId: null,
    });
    db.save();

    const workspaceDocs = listDocumentsByWorkspace(db, 'ws-knowledge');
    expect(workspaceDocs).toHaveLength(1);
    expect(workspaceDocs[0].sourceWorkspaceId).toBe('ws-knowledge');
    expect(workspaceDocs[0].fileName).toBe('a.txt');
  });
});
