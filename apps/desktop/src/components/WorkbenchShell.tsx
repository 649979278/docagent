/**
 * WorkbenchShell 组件 - 三栏布局容器
 * 左侧：SessionTree
 * 中间：ConversationPane
 * 右侧：ContextDrawer
 * 中部顶部：计划可视化与工具结果视图
 */

import React from 'react';
import { useUiStore } from '../stores/ui-store.js';
import { useSessionStore } from '../stores/session-store.js';
import { useMessageStore } from '../stores/message-store.js';
import { useRunStore } from '../stores/run-store.js';
import { Topbar } from './Topbar.js';
import { SessionSidebar } from './session-sidebar.js';
import { ConversationPane } from './ConversationPane.js';
import { ContextDrawer } from './ContextDrawer.js';
import { StatusBar } from './status-bar.js';

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
  onCreateSession: () => void;
  /** 删除会话 */
  onDeleteSession: (id: string) => void;
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
  onDeleteSession,
  assistantMsgIdRef,
  isThinkingRef,
}: WorkbenchShellProps): React.ReactElement {
  const { sidebarCollapsed } = useUiStore();
  const { sessions, currentSessionId } = useSessionStore();
  const { messages, isLoading } = useMessageStore();
  const { contextMetrics, ollamaStatus, mode } = useRunStore();

  return (
    <div className="flex flex-col h-screen bg-[var(--wa-bg-secondary)] text-[var(--wa-text-primary)] font-mono text-sm">
      {/* 顶部工具栏 */}
      <Topbar
        isLoading={isLoading}
        onTogglePlanMode={onTogglePlanMode}
        onAbort={onAbort}
      />

      {/* 主内容区 - 三栏布局 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：会话列表 */}
        {!sidebarCollapsed && (
          <SessionSidebar
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSelectSession={onSelectSession}
            onCreateSession={onCreateSession}
            onDeleteSession={onDeleteSession}
          />
        )}

        {/* 中间：对话区 */}
        <ConversationPane
          onSend={onSend}
          onAbort={onAbort}
          assistantMsgIdRef={assistantMsgIdRef}
          isThinkingRef={isThinkingRef}
        />

        {/* 右侧：上下文抽屉 */}
        <ContextDrawer
          onAddKnowledge={onAddKnowledge}
          onSearchKnowledge={onSearchKnowledge}
        />
      </div>

      {/* 底部状态栏 */}
      <StatusBar
        contextMetrics={contextMetrics}
        messageCount={messages.length}
        ollamaStatus={ollamaStatus}
        mode={mode}
        isLoading={isLoading}
      />
    </div>
  );
}
