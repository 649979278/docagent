/**
 * Topbar 组件 - 顶部工具栏
 * 包含：WorkAgent 标识、模式切换、中断按钮、Ollama 状态指示器
 */

import React from 'react';
import { useRunStore } from '../stores/run-store.js';
import { useWorkspaceStore } from '../stores/workspace-store.js';
import { useSessionStore } from '../stores/session-store.js';

/** Topbar 组件属性 */
interface TopbarProps {
  /** 是否正在加载 */
  isLoading: boolean;
  /** 切换 Plan 模式 */
  onTogglePlanMode: () => void;
  /** 中断对话 */
  onAbort: () => void;
}

/**
 * 顶部工具栏
 */
export function Topbar({ isLoading, onTogglePlanMode, onAbort }: TopbarProps): React.ReactElement {
  const { mode, ollamaStatus } = useRunStore();
  const { workspaceTree, activeWorkspaceId, setActiveWorkspaceId, addWorkspace } = useWorkspaceStore();
  const currentSessionId = useSessionStore((s) => s.currentSessionId);

  const handleWorkspaceChange = async (workspaceId: string) => {
    setActiveWorkspaceId(workspaceId || null);
    if (workspaceId && currentSessionId) {
      await window.workagent?.bindSessionWorkspace(workspaceId, currentSessionId);
    }
  };

  const handleCreateWorkspace = async () => {
    const [rootPath] = await (window.workagent?.openFileDialog({ directory: true }) ?? Promise.resolve([]));
    if (!rootPath) {
      return;
    }
    const name = rootPath.split(/[\\/]/).filter(Boolean).pop() ?? '新工作区';
    const workspace = await window.workagent?.createWorkspace(name, rootPath);
    if (!workspace) {
      return;
    }
    addWorkspace({
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath,
      documentCount: workspace.documentCount,
      updatedAt: workspace.updatedAt,
    });
    await handleWorkspaceChange(workspace.id);
  };

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b bg-[var(--wa-bg-primary)] select-none" style={{ borderColor: 'var(--wa-border)' }}>
      <div className="flex items-center gap-3">
        <span className="text-base font-semibold text-[var(--wa-text-primary)] tracking-tight">WorkAgent</span>
        <span className="text-xs text-[var(--wa-text-secondary)] hidden sm:inline">公文写作助手</span>
        <select
          value={activeWorkspaceId ?? ''}
          onChange={(event) => { void handleWorkspaceChange(event.target.value); }}
          className="bg-[var(--wa-bg-tertiary)] text-[var(--wa-text-secondary)] border border-[var(--wa-border)]/50 rounded px-2 py-1 text-xs"
        >
          <option value="">全部工作区</option>
          {workspaceTree.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => { void handleCreateWorkspace(); }}
          className="px-2 py-1 rounded text-xs bg-[var(--wa-bg-tertiary)] text-[var(--wa-text-secondary)] border border-[var(--wa-border)]/50 hover:bg-[var(--wa-border)]"
        >
          + 工作区
        </button>
      </div>
      <div className="flex items-center gap-2">
        {/* Plan模式切换 */}
        <button
          onClick={onTogglePlanMode}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            mode === 'plan'
              ? 'bg-[var(--wa-accent)]/15 text-[var(--wa-accent)] border border-[var(--wa-accent)]/30 hover:bg-[var(--wa-accent)]/25'
              : 'bg-[var(--wa-bg-tertiary)] text-[var(--wa-text-secondary)] border border-[var(--wa-border)]/50 hover:bg-[var(--wa-border)]'
          }`}
        >
          {mode === 'plan' ? '📋 Plan模式' : '💬 对话模式'}
        </button>

        {/* 中断按钮 */}
        {isLoading && (
          <button
            onClick={onAbort}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--wa-error)]/15 text-[var(--wa-error)] border border-[var(--wa-error)]/30 hover:bg-[var(--wa-error)]/25 transition-colors"
          >
            ⏹ 停止
          </button>
        )}

        {/* Ollama状态指示器 */}
        <OllamaIndicator status={ollamaStatus} />
      </div>
    </header>
  );
}

/**
 * Ollama 状态指示器
 */
function OllamaIndicator({ status }: { status: string }): React.ReactElement {
  const isRunning = status === 'running';
  const isChecking = status === 'checking';

  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs ${
      isRunning
        ? 'bg-emerald-500/10 text-emerald-400'
        : isChecking
        ? 'bg-[var(--wa-bg-tertiary)] text-[var(--wa-text-secondary)]'
        : 'bg-[var(--wa-error)]/10 text-[var(--wa-error)]'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        isRunning
          ? 'bg-emerald-400'
          : isChecking
          ? 'bg-[var(--wa-text-secondary)] animate-pulse'
          : 'bg-[var(--wa-error)]'
      }`} />
      {isRunning ? 'Ollama' : isChecking ? '检测中...' : '离线'}
    </div>
  );
}
