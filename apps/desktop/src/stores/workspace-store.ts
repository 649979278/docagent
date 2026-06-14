/**
 * 工作区状态管理 Store
 * 管理工作区树、当前活跃工作区
 */

import { create } from 'zustand';

/** 工作区条目 */
export interface WorkspaceItem {
  id: string;
  name: string;
  rootPath: string;
  /** 已挂载文档数量 */
  documentCount: number;
  updatedAt: number | string;
}

/** 工作区状态 */
export interface WorkspaceState {
  /** 工作区树 */
  workspaceTree: WorkspaceItem[];
  /** 当前活跃工作区ID */
  activeWorkspaceId: string | null;

  /** 设置工作区树 */
  setWorkspaceTree: (tree: WorkspaceItem[]) => void;
  /** 设置当前工作区 */
  setActiveWorkspaceId: (id: string | null) => void;
  /** 添加工作区 */
  addWorkspace: (workspace: WorkspaceItem) => void;
  /** 删除工作区 */
  removeWorkspace: (id: string) => void;
  /** 更新工作区 */
  updateWorkspaceItem: (id: string, updates: Partial<WorkspaceItem>) => void;
}

/**
 * 工作区状态 Store
 */
export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaceTree: [],
  activeWorkspaceId: null,

  setWorkspaceTree: (tree) => set({ workspaceTree: tree }),
  setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),
  addWorkspace: (workspace) => set((s) => ({
    workspaceTree: [...s.workspaceTree, workspace],
  })),
  removeWorkspace: (id) => set((s) => ({
    workspaceTree: s.workspaceTree.filter((w) => w.id !== id),
    activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
  })),
  updateWorkspaceItem: (id, updates) => set((s) => ({
    workspaceTree: s.workspaceTree.map((workspace) => (
      workspace.id === id ? { ...workspace, ...updates } : workspace
    )),
  })),
}));
