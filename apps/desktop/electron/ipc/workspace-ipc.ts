import { ipcMain } from 'electron';
import type { IpcHandlerContext } from './context.js';
import {
  bindSessionToWorkspace,
  createWorkspace,
  deleteWorkspace,
  getSessionWorkspaceIds,
  listDocumentsByWorkspace,
  listWorkspaces,
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
    db.save();
    return workspace;
  });

  ipcMain.handle('workspace-update', async (_ev, workspaceId: string, updates: { name?: string; rootPath?: string }) => {
    const db = await ctx.ensureDb();
    updateWorkspace(db, workspaceId, updates);
    db.save();
    return { success: true };
  });

  ipcMain.handle('workspace-delete', async (_ev, workspaceId: string) => {
    const db = await ctx.ensureDb();
    deleteWorkspace(db, workspaceId);
    db.save();
    return { success: true };
  });

  ipcMain.handle('workspace-bind-session', async (_ev, workspaceId: string, sessionId: string) => {
    const db = await ctx.ensureDb();
    bindSessionToWorkspace(db, sessionId, workspaceId);
    db.save();
    return { success: true };
  });

  ipcMain.handle('workspace-unbind-session', async (_ev, workspaceId: string, sessionId: string) => {
    const db = await ctx.ensureDb();
    unbindSessionFromWorkspace(db, sessionId, workspaceId);
    db.save();
    return { success: true };
  });

  ipcMain.handle('workspace-session-ids', async (_ev, sessionId: string) => {
    const db = await ctx.ensureDb();
    return getSessionWorkspaceIds(db, sessionId);
  });
}
