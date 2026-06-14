/**
 * UI 状态管理 Store
 * 管理 UI 布局状态：侧边栏折叠、右侧抽屉、当前 tab
 */

import { create } from 'zustand';

/** 右侧抽屉 Tab 类型 */
export type RightPanelTab =
  | 'environment'   // 当前环境：模型、上下文长度、权限模式
  | 'plan'          // 当前计划：阶段、目标、待确认点
  | 'knowledge'     // 当前知识：已挂载文档、索引进度、最近引用
  | 'run'           // 当前运行：prompt 预算分布、compact boundary、tool failure
  | 'output';       // 当前输出：草稿摘要、导出目标

/** UI 状态 */
export interface UiState {
  /** 右侧抽屉当前 Tab */
  rightPanelTab: RightPanelTab;
  /** 左侧边栏是否折叠 */
  sidebarCollapsed: boolean;
  /** 右侧抽屉是否折叠 */
  drawerCollapsed: boolean;

  /** 设置右侧抽屉 Tab */
  setRightPanelTab: (tab: RightPanelTab) => void;
  /** 切换侧边栏折叠 */
  toggleSidebar: () => void;
  /** 切换抽屉折叠 */
  toggleDrawer: () => void;
  /** 设置侧边栏折叠 */
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** 设置抽屉折叠 */
  setDrawerCollapsed: (collapsed: boolean) => void;
}

/**
 * UI 状态 Store
 */
export const useUiStore = create<UiState>((set) => ({
  rightPanelTab: 'environment',
  sidebarCollapsed: false,
  drawerCollapsed: false,

  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleDrawer: () => set((s) => ({ drawerCollapsed: !s.drawerCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setDrawerCollapsed: (collapsed) => set({ drawerCollapsed: collapsed }),
}));
