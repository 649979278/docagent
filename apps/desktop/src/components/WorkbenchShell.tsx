/**
 * WorkbenchShell 组件 - Codex 风格应用壳
 * 左侧：项目/会话树
 * 中间：ConversationPane
 * 右上：环境信息浮窗
 */

import React, { useState } from 'react';
import { useUiStore } from '../stores/ui-store.js';
import { useSessionStore } from '../stores/session-store.js';
import { useMessageStore } from '../stores/message-store.js';
import { SessionSidebar } from './session-sidebar.js';
import { ConversationPane } from './ConversationPane.js';
import { SettingsDialog } from './settings-dialog.js';
import { AppTitlebar } from './app-titlebar.js';

/** WorkbenchShell 组件属性 */
interface WorkbenchShellProps {
  /** 发送消息 */
  onSend: (message: string) => void;
  /** 中断对话 */
  onAbort: () => void;
  /** 切换 Plan 模式 */
  onTogglePlanMode: () => void;
  /** 导入知识 */
  onAddKnowledge: () => void;
  /** 搜索知识 */
  onSearchKnowledge: (query: string) => void;
  /** 选择会话 */
  onSelectSession: (id: string) => void;
  /** 创建会话 */
  onCreateSession: (workspaceId?: string | null) => Promise<string | null>;
  /** 打开项目文件夹 */
  onOpenProject: () => void;
  /** 删除会话 */
  onDeleteSession: (id: string, workspaceId?: string | null) => void;
  /** 恢复归档会话。 */
  onRestoreArchivedSession: (sessionId: string, workspaceId: string) => void;
  /** 当前助手消息ID ref */
  assistantMsgIdRef: React.MutableRefObject<string>;
  /** 是否正在思考 */
  isThinkingRef: React.MutableRefObject<boolean>;
}

/**
 * 三栏布局容器
 */
export function WorkbenchShell({
  onSend,
  onAbort,
  onTogglePlanMode,
  onAddKnowledge,
  onSearchKnowledge,
  onSelectSession,
  onCreateSession,
  onOpenProject,
  onDeleteSession,
  onRestoreArchivedSession,
  assistantMsgIdRef,
  isThinkingRef,
}: WorkbenchShellProps): React.ReactElement {
  const { sidebarCollapsed } = useUiStore();
  const { sessions, currentSessionId } = useSessionStore();
  const { isLoading } = useMessageStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[var(--wa-bg-primary)] text-[var(--wa-text-primary)]">
      <AppTitlebar
        onCreateSession={() => { void onCreateSession(null); }}
        onOpenProject={onOpenProject}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="flex h-[calc(100%-var(--wa-titlebar-height))] min-w-0 overflow-hidden">
        {!sidebarCollapsed && (
          <SessionSidebar
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSelectSession={onSelectSession}
            onCreateSession={onCreateSession}
            onDeleteSession={onDeleteSession}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        <ConversationPane
          onSend={onSend}
          onAbort={onAbort}
          onTogglePlanMode={onTogglePlanMode}
          onAddKnowledge={onAddKnowledge}
          assistantMsgIdRef={assistantMsgIdRef}
          isThinkingRef={isThinkingRef}
        />
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onAddKnowledge={onAddKnowledge}
        onRestoreArchivedSession={onRestoreArchivedSession}
      />

      {isLoading && (
        <button
          onClick={onAbort}
          className="fixed right-5 bottom-5 z-50 rounded-full border border-[#4b2f2f] bg-[#2b1c1c] px-3 py-1.5 wa-label text-[#ff9a9a] shadow-lg hover:bg-[#3a2424]"
        >
          停止生成
        </button>
      )}
    </div>
  );
}
