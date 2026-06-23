/**
 * 项目会话侧边栏组件。
 * 左侧以“项目目录”为一级概念，每个项目下展示对应对话，并支持归档、删除和项目管理。
 */

import React, { useMemo, useRef, useState } from 'react';
import type { Session } from '../stores/session-store.js';
import { useWorkspaceStore } from '../stores/workspace-store.js';
import { useSettingsStore } from '../stores/settings-store.js';
import { FloatingLayer } from './floating-layer.js';

/** 会话侧边栏组件属性。 */
interface SessionSidebarProps {
  /** 会话列表。 */
  sessions: Session[];
  /** 当前选中的会话 ID。 */
  currentSessionId: string | null;
  /** 选择会话回调。 */
  onSelectSession: (id: string) => void;
  /** 创建新会话回调。 */
  onCreateSession: (workspaceId?: string | null) => void | Promise<string | null>;
  /** 删除会话回调。 */
  onDeleteSession: (id: string, workspaceId?: string | null) => void | Promise<void>;
  /** 打开设置回调。 */
  onOpenSettings: () => void;
}

/** 会话分组结构。 */
interface ProjectGroup {
  id: string;
  name: string;
  rootPath: string | null;
  sessions: Session[];
}

const DEFAULT_PROJECT_ID = '__default__';

/**
 * 提取项目目录的短名称。
 * @param rootPath - 项目根目录路径。
 * @returns 适合侧边栏展示的目录名。
 */
function projectNameFromPath(rootPath: string): string {
  return rootPath.split(/[\\/]/).filter(Boolean).pop() ?? rootPath;
}

/**
 * 会话侧边栏。
 */
export function SessionSidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onOpenSettings,
}: SessionSidebarProps): React.ReactElement {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [activeProjectMenuId, setActiveProjectMenuId] = useState<string | null>(null);
  const projectAddButtonRef = useRef<HTMLButtonElement>(null);
  const projectMenuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const {
    workspaceTree,
    activeWorkspaceId,
    sessionWorkspaceMap,
    setActiveWorkspaceId,
    setSessionWorkspaceIds,
    addWorkspace,
    updateWorkspaceItem,
    removeWorkspace,
  } = useWorkspaceStore();
  const {
    archivedSessions,
    archiveSession,
    removeWorkspaceArchives,
  } = useSettingsStore();

  /**
   * 持久化归档会话设置。
   */
  const persistArchivedSessions = async (): Promise<void> => {
    await window.workagent?.updateSettings({
      archived_sessions: { value: useSettingsStore.getState().archivedSessions },
    });
  };

  /**
   * 格式化会话相对时间。
   * @param timestamp - 毫秒时间戳。
   * @returns 相对时间文案。
   */
  const formatTime = (timestamp: number): string => {
    const diffMs = Date.now() - timestamp;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))} 分`;
    if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时`;
    if (diffMs < day * 14) return `${Math.floor(diffMs / day)} 天`;
    return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  /**
   * 生成项目分组，优先按真实工作区绑定关系归类会话。
   */
  const projectGroups = useMemo<ProjectGroup[]>(() => {
    const fallbackWorkspace = {
      id: DEFAULT_PROJECT_ID,
      name: '默认项目',
      rootPath: 'D:\\wsx_workspace\\docagent',
      documentCount: 0,
      updatedAt: Date.now(),
    };
    const workspaces = workspaceTree.length > 0 ? workspaceTree : [fallbackWorkspace];
    const archivedLookup = new Set(archivedSessions.map((item) => `${item.workspaceId}:${item.sessionId}`));
    const visibleSessions = sessions.filter((session) => {
      const workspaceIds = sessionWorkspaceMap[session.id];
      if (!workspaceIds || workspaceIds.length === 0) {
        return !archivedLookup.has(`${DEFAULT_PROJECT_ID}:${session.id}`);
      }
      return workspaceIds.some((workspaceId) => !archivedLookup.has(`${workspaceId}:${session.id}`));
    });

    const ungroupedSessions = visibleSessions.filter((session) => (sessionWorkspaceMap[session.id] ?? []).length === 0);
    const groupedProjects = workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name || projectNameFromPath(workspace.rootPath),
      rootPath: workspace.rootPath,
      sessions: visibleSessions.filter((session) => (
        (sessionWorkspaceMap[session.id] ?? []).includes(workspace.id)
        && !archivedLookup.has(`${workspace.id}:${session.id}`)
      )),
    }));

    if (ungroupedSessions.length > 0) {
      groupedProjects.unshift({
        id: DEFAULT_PROJECT_ID,
        name: fallbackWorkspace.name,
        rootPath: fallbackWorkspace.rootPath,
        sessions: ungroupedSessions.filter((session) => !archivedLookup.has(`${DEFAULT_PROJECT_ID}:${session.id}`)),
      });
    }

    return groupedProjects;
  }, [archivedSessions, sessionWorkspaceMap, sessions, workspaceTree]);

  const selectedProjectId = activeWorkspaceId ?? projectGroups[0]?.id ?? DEFAULT_PROJECT_ID;

  /**
   * 选中项目并尽量落到该项目的首个对话。
   * @param project - 项目分组。
   */
  const activateProject = (project: ProjectGroup): void => {
    setActiveWorkspaceId(project.id === DEFAULT_PROJECT_ID ? null : project.id);
    if (project.sessions.length === 0) {
      return;
    }
    const belongsToProject = project.sessions.some((session) => session.id === currentSessionId);
    if (!belongsToProject || !currentSessionId) {
      onSelectSession(project.sessions[0].id);
    }
  };

  /**
   * 切换项目折叠状态。
   * @param projectId - 项目 ID。
   */
  const toggleProject = (projectId: string): void => {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  /**
   * 为当前会话创建归档记录并切换到同项目内的首个可见对话。
   * @param project - 当前项目。
   * @param session - 当前会话。
   */
  const archiveConversation = async (project: ProjectGroup, session: Session): Promise<void> => {
    const workspaceId = project.id;
    const normalizedWorkspaceId = workspaceId === DEFAULT_PROJECT_ID ? null : workspaceId;
    setActiveWorkspaceId(normalizedWorkspaceId);
    archiveSession({
      sessionId: session.id,
      workspaceId,
      workspaceName: project.name,
      sessionTitle: session.title || '新对话',
      archivedAt: Date.now(),
    });
    await persistArchivedSessions();

    if (currentSessionId === session.id) {
      const nextSession = project.sessions.filter((item) => item.id !== session.id)[0];
      if (nextSession) {
        onSelectSession(nextSession.id);
      } else {
        const firstGlobal = projectGroups.flatMap((item) => item.sessions).find((item) => item.id !== session.id);
        if (firstGlobal) {
          onSelectSession(firstGlobal.id);
        }
      }
    }
  };

  /**
   * 使用目录创建项目并绑定当前对话。
   * @param useExisting - 是否使用已有文件夹。
   */
  const createProjectFromDirectory = async (useExisting: boolean): Promise<void> => {
    const [rootPath] = await (window.workagent?.openFileDialog({ directory: true }) ?? Promise.resolve([]));
    if (!rootPath) return;
    const baseName = projectNameFromPath(rootPath);
    const workspace = await window.workagent?.createWorkspace(useExisting ? baseName : `${baseName || '新项目'}`, rootPath);
    if (!workspace) return;
    addWorkspace({
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath,
      documentCount: workspace.documentCount,
      updatedAt: workspace.updatedAt,
    });
    setActiveWorkspaceId(workspace.id);
    if (currentSessionId) {
      await window.workagent?.bindSessionWorkspace(workspace.id, currentSessionId);
      setSessionWorkspaceIds(currentSessionId, [workspace.id]);
    }
    setProjectMenuOpen(false);
  };

  /**
   * 打开项目目录。
   * @param rootPath - 目录路径。
   */
  const revealProject = async (rootPath: string | null): Promise<void> => {
    if (!rootPath) return;
    await window.workagent?.revealInExplorer(rootPath);
    setActiveProjectMenuId(null);
  };

  /**
   * 重命名项目展示名称，不修改实际目录名。
   * @param project - 项目。
   */
  const renameProject = async (project: ProjectGroup): Promise<void> => {
    if (project.id === DEFAULT_PROJECT_ID) return;
    const nextName = window.prompt('输入新的项目显示名称', project.name);
    if (!nextName || nextName.trim() === '' || nextName === project.name) return;
    await window.workagent?.updateWorkspace(project.id, { name: nextName.trim() });
    updateWorkspaceItem(project.id, { name: nextName.trim() });
    setActiveProjectMenuId(null);
  };

  /**
   * 移除整个项目及其对话，但不删除磁盘目录。
   * @param project - 项目。
   */
  const removeProject = async (project: ProjectGroup): Promise<void> => {
    if (project.id === DEFAULT_PROJECT_ID) return;
    const confirmed = window.confirm(`将移除项目“${project.name}”及其下所有对话，实际目录不会被删除。是否继续？`);
    if (!confirmed) return;

    const sessionIds = project.sessions.map((session) => session.id);
    for (const sessionId of sessionIds) {
      await onDeleteSession(sessionId, project.id);
    }
    await window.workagent?.deleteWorkspace(project.id);
    removeWorkspace(project.id);
    removeWorkspaceArchives(project.id);
    await persistArchivedSessions();
    if (activeWorkspaceId === project.id) {
      setActiveWorkspaceId(null);
    }
    setActiveProjectMenuId(null);
  };

  return (
    <aside className="flex w-[290px] flex-col border-r border-[#2b2b2b] bg-[#181818] wa-body">
      <div className="px-3 pb-2 pt-3">
        <button
          onClick={() => void onCreateSession(activeWorkspaceId)}
          className="wa-row min-h-[40px] w-full rounded-xl px-3 py-2 text-left text-[#e6e6e6] hover:bg-[#262626]"
        >
          <Icon name="edit" />
          <span>新对话</span>
        </button>
      </div>

      <div className="relative flex items-center justify-between px-3 pb-2 pt-1 wa-label text-[#8a8a8a]">
        <span>项目</span>
        <button
          ref={projectAddButtonRef}
          onClick={() => setProjectMenuOpen((value) => !value)}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#232323] text-[#d8d8d8] hover:bg-[#2d2d2d]"
          title="添加项目"
        >
          <FolderPlusIcon />
        </button>
        <FloatingLayer
          open={projectMenuOpen}
          anchorRef={projectAddButtonRef}
          placement="bottom-end"
          className="w-[230px]"
          onClose={() => setProjectMenuOpen(false)}
        >
          <div className="rounded-2xl border border-[#3a3a3a] bg-[#2b2b2b] p-2 shadow-2xl">
            <button
              onClick={() => { void createProjectFromDirectory(false); }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[#eeeeee] hover:bg-[#3a3a3a]"
            >
              <FolderPlusIcon />
              <span>新建空白项目</span>
            </button>
            <button
              onClick={() => { void createProjectFromDirectory(true); }}
              className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[#eeeeee] hover:bg-[#3a3a3a]"
            >
              <FolderPlusIcon />
              <span>使用现有文件夹</span>
            </button>
          </div>
        </FloatingLayer>
      </div>

      <div className="wa-scrollbar flex-1 overflow-y-auto px-2 pb-3">
        {projectGroups.map((project) => {
          const collapsed = collapsedProjects.has(project.id);
          const selected = project.id === selectedProjectId;
          const projectHoverId = `project:${project.id}`;
          return (
            <section key={project.id} className="mb-2">
              <div
                className={`group/project flex items-center rounded-xl px-1 ${
                  selected ? 'bg-[#242424]' : 'hover:bg-[#222222]'
                }`}
                onMouseEnter={() => setHoveredId(projectHoverId)}
                onMouseLeave={() => setHoveredId((current) => (current === projectHoverId ? null : current))}
              >
                <button
                  onClick={() => {
                    if (selected) {
                      toggleProject(project.id);
                      return;
                    }
                    activateProject(project);
                  }}
                  className="wa-row min-h-[40px] min-w-0 flex-1 rounded-xl px-1.5 py-2 text-left text-[#cfcfcf]"
                  title={project.rootPath ?? project.name}
                >
                  <ChevronIcon collapsed={collapsed} />
                  <FolderIcon />
                  <span className="truncate">{project.name}</span>
                </button>

                {hoveredId === projectHoverId && (
                  <div className="flex items-center gap-1 pr-1">
                    {project.id !== DEFAULT_PROJECT_ID && (
                      <div className="relative">
                        <button
                          ref={(node) => { projectMenuButtonRefs.current[project.id] = node; }}
                          onClick={() => setActiveProjectMenuId((value) => value === project.id ? null : project.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-[#bdbdbd] hover:bg-[#303030] hover:text-[#f2f2f2]"
                          title="项目更多"
                        >
                          <MoreIcon />
                        </button>
                        <FloatingLayer
                          open={activeProjectMenuId === project.id}
                          anchorRef={{ current: projectMenuButtonRefs.current[project.id] }}
                          placement="bottom-end"
                          className="w-[220px]"
                          onClose={() => setActiveProjectMenuId(null)}
                        >
                          <div className="rounded-2xl border border-[#3a3a3a] bg-[#2b2b2b] p-2 shadow-2xl">
                            <ProjectMenuAction label="在资源管理器中查看" onClick={() => { void revealProject(project.rootPath); }} />
                            <ProjectMenuAction label="重命名项目" onClick={() => { void renameProject(project); }} />
                            <ProjectMenuAction label="移除项目及对话" danger onClick={() => { void removeProject(project); }} />
                          </div>
                        </FloatingLayer>
                      </div>
                    )}
                    <button
                      onClick={() => void onCreateSession(project.id === DEFAULT_PROJECT_ID ? null : project.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-[#bbbbbb] hover:bg-[#303030] hover:text-[#f2f2f2]"
                      title="在该项目下新建对话"
                    >
                      <ComposeIcon />
                    </button>
                  </div>
                )}
              </div>

              {!collapsed && (
                <div className="mt-0.5 space-y-0.5 pl-6">
                  {project.sessions.length === 0 ? (
                    <div className="px-2 py-1.5 wa-label text-[#6f6f6f]">暂无对话</div>
                  ) : project.sessions.map((session) => (
                    <div
                      key={session.id}
                      onMouseEnter={() => setHoveredId(session.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      className={`group relative rounded-xl transition-colors ${
                        session.id === currentSessionId ? 'bg-[#333]' : 'hover:bg-[#292929]'
                      }`}
                    >
                      <button
                        onClick={() => onSelectSession(session.id)}
                        className="grid w-full grid-cols-[1fr_auto] gap-2 px-3 py-2 text-left"
                      >
                        <span className={`truncate ${session.id === currentSessionId ? 'text-[#f2f2f2]' : 'text-[#bdbdbd]'}`}>
                          {session.title || '新对话'}
                        </span>
                        <span className="wa-meta text-[#777]">{formatTime(session.updatedAt)}</span>
                      </button>
                      {hoveredId === session.id && (
                        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-xl bg-[#333] px-1 py-1 shadow-sm">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              void archiveConversation(project, session);
                            }}
                            className="rounded-lg px-2 py-1 wa-meta text-[#bdbdbd] hover:bg-[#3d3d3d] hover:text-[#f2f2f2]"
                            title="归档对话"
                          >
                            归档
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setActiveWorkspaceId(project.id === DEFAULT_PROJECT_ID ? null : project.id);
                              void onDeleteSession(session.id, project.id === DEFAULT_PROJECT_ID ? null : project.id);
                            }}
                            className="rounded-lg px-2 py-1 wa-meta text-[#bdbdbd] hover:bg-[#3d3d3d] hover:text-[#ff8a8a]"
                            title="删除对话"
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="border-t border-[#2b2b2b] px-3 py-2">
        <button onClick={onOpenSettings} className="wa-row w-full rounded-xl px-3 py-2 text-left wa-label text-[#a8a8a8] hover:bg-[#292929]">
          <Icon name="settings" />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}

/**
 * 项目菜单动作按钮。
 */
function ProjectMenuAction({
  label,
  danger = false,
  onClick,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`block w-full rounded-xl px-3 py-2 text-left ${
        danger ? 'text-[#ff9b9b] hover:bg-[#3b2929]' : 'text-[#ededed] hover:bg-[#3a3a3a]'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * 侧栏统一线性图标。
 */
function Icon({ name }: { name: 'edit' | 'settings' }): React.ReactElement {
  const paths: Record<typeof name, React.ReactNode> = {
    edit: <path d="M4 16.5V20h3.5L18.2 9.3l-3.5-3.5L4 16.5Zm12-12 3.5 3.5" />,
    settings: <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Zm7.5-3.5 1.5-1.2-1.5-2.6-1.9.7a7.4 7.4 0 0 0-1.3-.8L16 6h-3l-.3 2.1c-.5.2-.9.5-1.3.8l-1.9-.7L8 10.8 9.5 12 8 13.2l1.5 2.6 1.9-.7c.4.3.8.6 1.3.8L13 18h3l.3-2.1c.5-.2.9-.5 1.3-.8l1.9.7 1.5-2.6L19.5 12Z" />,
  };
  return (
    <span className="wa-icon text-[#bdbdbd]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {paths[name]}
      </svg>
    </span>
  );
}

/**
 * 项目 hover 新建对话图标。
 */
function ComposeIcon(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5V16l10.9-10.9a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L8 20H4Z" />
      <path d="M13.5 6.5 17.5 10.5" />
      <path d="M19 16v4M17 18h4" />
    </svg>
  );
}

/**
 * 项目更多图标。
 */
function MoreIcon(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="6" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="18" cy="12" r="1.8" />
    </svg>
  );
}

/**
 * 项目折叠箭头图标。
 */
function ChevronIcon({ collapsed }: { collapsed: boolean }): React.ReactElement {
  return (
    <span className="wa-icon text-[#8f8f8f]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={collapsed ? 'M9 6l6 6-6 6' : 'M6 9l6 6 6-6'} />
      </svg>
    </span>
  );
}

/**
 * Codex 风格线性文件夹图标。
 */
function FolderIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[#d0d0d0]" aria-hidden="true">
      <path d="M3.5 7.5h6.2l1.7 2h9.1v7.7a2.3 2.3 0 0 1-2.3 2.3H5.8a2.3 2.3 0 0 1-2.3-2.3V7.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M3.5 7.5V6.8A2.3 2.3 0 0 1 5.8 4.5h4.1l1.8 2h6.5a2.3 2.3 0 0 1 2.3 2.3v.7" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 新增项目图标。
 */
function FolderPlusIcon(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 text-current" aria-hidden="true">
      <path d="M3.5 7.5h6.2l1.7 2h9.1v7.7a2.3 2.3 0 0 1-2.3 2.3H5.8a2.3 2.3 0 0 1-2.3-2.3V7.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M3.5 7.5V6.8A2.3 2.3 0 0 1 5.8 4.5h4.1l1.8 2h6.5a2.3 2.3 0 0 1 2.3 2.3v.7" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M15.5 13v5M13 15.5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
