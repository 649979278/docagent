/**
 * 会话侧边栏组件
 * 显示会话列表，支持创建、切换、删除会话
 */

import React, { useState } from 'react';
import type { Session } from '../stores/app-store.js';

/** 会话侧边栏组件属性 */
interface SessionSidebarProps {
  /** 会话列表 */
  sessions: Session[];
  /** 当前选中的会话ID */
  currentSessionId: string | null;
  /** 选择会话回调 */
  onSelectSession: (id: string) => void;
  /** 创建新会话回调 */
  onCreateSession: () => void;
  /** 删除会话回调 */
  onDeleteSession: (id: string) => void;
}

/**
 * 会话侧边栏
 * Codex风格：紧凑会话列表 + 悬浮操作
 */
export function SessionSidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
}: SessionSidebarProps): React.ReactElement {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  /** 格式化时间 */
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  return (
    <aside className="w-60 border-r border-zinc-800 bg-zinc-950 flex flex-col">
      {/* 创建新会话按钮 */}
      <div className="p-3">
        <button
          onClick={onCreateSession}
          className="w-full px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors text-center border border-zinc-700/50 hover:border-zinc-600"
        >
          + 新对话
        </button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto px-2 scrollbar-thin">
        {sessions.length === 0 && (
          <div className="text-center text-zinc-600 text-xs mt-8">
            暂无对话<br />点击上方按钮开始
          </div>
        )}
        {sessions.map((session) => (
          <div
            key={session.id}
            onMouseEnter={() => setHoveredId(session.id)}
            onMouseLeave={() => setHoveredId(null)}
            className={`group relative rounded-lg mb-0.5 transition-colors ${
              session.id === currentSessionId
                ? 'bg-zinc-800'
                : 'hover:bg-zinc-800/40'
            }`}
          >
            <button
              onClick={() => onSelectSession(session.id)}
              className="w-full text-left px-3 py-2.5 text-xs transition-colors"
            >
              {/* 会话标题 */}
              <div className={`truncate ${
                session.id === currentSessionId ? 'text-zinc-100' : 'text-zinc-400'
              }`}>
                {session.title}
              </div>
              {/* 会话元信息 */}
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-600">
                <span>{formatTime(session.updatedAt)}</span>
                {session.mode === 'plan' && (
                  <span className="px-1 rounded bg-amber-500/15 text-amber-400">Plan</span>
                )}
              </div>
            </button>

            {/* 删除按钮 - hover时显示 */}
            {hoveredId === session.id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteSession(session.id);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-red-500/20 text-zinc-600 hover:text-red-400 transition-colors"
                title="删除会话"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 底部信息 */}
      <div className="p-3 border-t border-zinc-800">
        <div className="text-[10px] text-zinc-600 text-center">
          {sessions.length} 个对话
        </div>
      </div>
    </aside>
  );
}
