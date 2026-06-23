import { ipcMain } from 'electron';
import type { IpcHandlerContext } from './context.js';
import {
  bindSessionToWorkspace,
  createWorkspace,
  deleteWorkspace,
  getSessionWorkspaceIds,
  getWorkspaceSessionIds,
  listDocumentsByWorkspace,
  listWorkspaces,
  updateDocumentsWorkspace,
  unbindSessionFromWorkspace,
  updateWorkspace,
} from '@workagent/store';

/**
 * 注册工作区相关 IPC 处理器。
 * @param ctx - IPC 共享上下文。
 */
export function registerWorkspaceIpc(ctx: IpcHandlerContext): void {
  ipcMain.handle('workspace-list', async () => {
    const db = await ctx.ensureDb();
    const workspaces = listWorkspaces(db);
    return workspaces.map((workspace) => ({
      ...workspace,
      documentCount: listDocumentsByWorkspace(db, workspace.id, 1000, 0).length,
    }));
  });

  ipcMain.handle('workspace-create', async (_ev, name: string, rootPath: string) => {
    const db = await ctx.ensureDb();
    const workspace = createWorkspace(db, {
      id: `workspace_${Date.now()}`,
      name,
      rootPath,
    });
    return workspace;
  });

  ipcMain.handle('workspace-update', async (_ev, workspaceId: string, updates: { name?: string; rootPath?: string }) => {
    const db = await ctx.ensureDb();
    updateWorkspace(db, workspaceId, updates);
    return { success: true };
  });

  ipcMain.handle('workspace-delete', async (_ev, workspaceId: string) => {
    const db = await ctx.ensureDb();
    deleteWorkspace(db, workspaceId);
    return { success: true };
  });

  ipcMain.handle('workspace-bind-session', async (_ev, workspaceId: string, sessionId: string) => {
    const db = await ctx.ensureDb();
    bindSessionToWorkspace(db, sessionId, workspaceId);
    return { success: true };
  });

  ipcMain.handle('workspace-unbind-session', async (_ev, workspaceId: string, sessionId: string) => {
    const db = await ctx.ensureDb();
    unbindSessionFromWorkspace(db, sessionId, workspaceId);
    return { success: true };
  });

  ipcMain.handle('workspace-session-ids', async (_ev, sessionId: string) => {
    const db = await ctx.ensureDb();
    return getSessionWorkspaceIds(db, sessionId);
  });

  ipcMain.handle('workspace-documents', async (_ev, workspaceId: string) => {
    const db = await ctx.ensureDb();
    return listDocumentsByWorkspace(db, workspaceId, 1000, 0);
  });

  ipcMain.handle('workspace-document-move', async (_ev, docIds: string[], workspaceId: string | null) => {
    const db = await ctx.ensureDb();
    updateDocumentsWorkspace(db, docIds, workspaceId);
    return { success: true };
  });

  ipcMain.handle('workspace-unbind-all-sessions', async (_ev, workspaceId: string) => {
    const db = await ctx.ensureDb();
    for (const sessionId of getWorkspaceSessionIds(db, workspaceId)) {
      unbindSessionFromWorkspace(db, sessionId, workspaceId);
    }
    return { success: true };
  });
}
