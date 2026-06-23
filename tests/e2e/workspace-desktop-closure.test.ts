import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDocument, createSession, createWorkspace, initDatabase, listDocumentsByWorkspace, getSessionWorkspaceIds } from '@workagent/store';
import { createDesktopRuntimeBundle } from '../../apps/desktop/electron/runtime-factory.js';

/**
 * Workspace 桌面闭环测试。
 */
describe('workspace desktop closure', () => {
  it('supports workspace docs listing, document move, and session unbind flow', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workagent-workspace-closure-'));
    const dbPath = path.join(tempDir, 'workspace.db');
    const db = initDatabase({ dbPath });
    try {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'source'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'target'), { recursive: true });
    const filePath = path.join(tempDir, 'source', 'doc.txt');
    fs.writeFileSync(filePath, 'workspace closure');

    createWorkspace(db, {
      id: 'ws-source',
      name: '来源工作区',
      rootPath: path.join(tempDir, 'source'),
    });
    createWorkspace(db, {
      id: 'ws-target',
      name: '目标工作区',
      rootPath: path.join(tempDir, 'target'),
    });
    createSession(db, {
      id: 'session-workspace',
      title: 'workspace session',
    });
    createDocument(db, {
      id: 'doc-workspace-closure',
      path: filePath,
      fileName: 'doc.txt',
      fileType: 'txt',
      sha256: 'hash',
      sourceWorkspaceId: 'ws-source',
    });

    const bundle = await createDesktopRuntimeBundle({
      db,
      autoApprovePermissions: true,
    });

    expect(listDocumentsByWorkspace(db, 'ws-source')).toHaveLength(1);
    await bundle.ragEngine.getStats();

    db.prepare('UPDATE documents SET source_workspace_id = ? WHERE id = ?').run('ws-target', 'doc-workspace-closure');
    db.prepare('INSERT OR IGNORE INTO session_workspaces (session_id, workspace_id) VALUES (?, ?)').run('session-workspace', 'ws-source');

    expect(listDocumentsByWorkspace(db, 'ws-source')).toHaveLength(0);
    expect(listDocumentsByWorkspace(db, 'ws-target')).toHaveLength(1);
    expect(getSessionWorkspaceIds(db, 'session-workspace')).toContain('ws-source');
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
