/**
 * ConversationPane 组件 - 中间对话区
 * 包含消息列表和输入区，支持流式输出和工具调用状态展示
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useMessageStore } from '../stores/message-store.js';
import { useRunStore } from '../stores/run-store.js';
import { useSessionStore } from '../stores/session-store.js';
import { ChatMessage } from './chat-message.js';
import { PlanVisualizer } from './plan-visualizer.js';
import { ToolResultViewer } from './tool-result-viewer.js';

/** ConversationPane 组件属性 */
interface ConversationPaneProps {
  /** 发送消息回调 */
  onSend: (message: string) => void;
  /** 中断对话回调 */
  onAbort: () => void;
  /** 当前助手消息ID */
  assistantMsgIdRef: React.MutableRefObject<string>;
  /** 是否正在思考 */
  isThinkingRef: React.MutableRefObject<boolean>;
}

/**
 * 中间对话区
 */
export function ConversationPane({ onSend, onAbort, assistantMsgIdRef, isThinkingRef }: ConversationPaneProps): React.ReactElement {
  const { messages, isLoading } = useMessageStore();
  const { mode } = useRunStore();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputHeight, setInputHeight] = useState(40);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /** 发送消息 */
  const handleSend = useCallback(() => {
    const input = inputRef.current;
    if (!input || !input.value.trim() || isLoading) return;
    onSend(input.value.trim());
    input.value = '';
    setInputHeight(40);
  }, [isLoading, onSend]);

  /** 输入框自动调高 */
  const handleInputChange = useCallback(() => {
    const input = inputRef.current;
    if (input) {
      input.style.height = 'auto';
      const newHeight = Math.min(Math.max(input.scrollHeight, 40), 160);
      input.style.height = `${newHeight}px`;
      setInputHeight(newHeight);
    }
  }, []);

  /** 键盘事件处理 */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <main className="flex-1 flex flex-col min-w-0">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-thin">
        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          <PlanVisualizer />
          <ToolResultViewer />
        </div>
        <PlanApprovalBanner />
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--wa-text-secondary)]">
            <div className="text-5xl mb-4 opacity-50">📝</div>
            <p className="text-lg text-[var(--wa-text-secondary)] mb-1">WorkAgent 公文写作助手</p>
            <p className="text-xs text-[var(--wa-text-secondary)] mb-6">基于本地Ollama的离线公文写作工具</p>
            <div className="flex flex-col gap-2 text-xs text-[var(--wa-text-secondary)]">
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded bg-[var(--wa-bg-tertiary)] text-[var(--wa-text-secondary)] text-[10px]">Enter</span>
                <span>发送消息</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded bg-[var(--wa-bg-tertiary)] text-[var(--wa-text-secondary)] text-[10px]">Shift+Enter</span>
                <span>换行</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded bg-[var(--wa-bg-tertiary)] text-[var(--wa-text-secondary)] text-[10px]">📋 Plan</span>
                <span>切换计划模式</span>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            isLoading={isLoading && msg.id === assistantMsgIdRef.current}
            isThinking={isThinkingRef.current && msg.id === assistantMsgIdRef.current}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 */}
      <div className="border-t bg-[var(--wa-bg-primary)] px-4 py-3" style={{ borderColor: 'var(--wa-border)' }}>
        <div className="flex gap-2 items-end max-w-4xl mx-auto">
          <textarea
            ref={inputRef}
            placeholder={mode === 'plan'
              ? '描述写作需求，如"帮我写一份关于XX的通知"...'
              : '输入消息，Shift+Enter换行...'
            }
            onKeyDown={handleKeyDown}
            onInput={handleInputChange}
            disabled={isLoading}
            rows={1}
            style={{ height: `${inputHeight}px` }}
            className="flex-1 bg-[var(--wa-bg-tertiary)] border border-[var(--wa-border)]/50 rounded-lg px-4 py-2.5 text-sm text-[var(--wa-text-primary)] placeholder-[var(--wa-text-secondary)] focus:outline-none focus:border-[var(--wa-border)] focus:ring-1 focus:ring-[var(--wa-border)]/30 disabled:opacity-40 resize-none overflow-hidden leading-relaxed"
          />
          <button
            onClick={isLoading ? onAbort : handleSend}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
              isLoading
                ? 'bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            {isLoading ? '⏹ 停止' : '↵ 发送'}
          </button>
        </div>
      </div>
    </main>
  );
}

/**
 * Plan 审批横幅。
 * 在 planPhase === 'PLAN_REVIEW' 且存在 activePlanId 时显示批准/拒绝按钮。
 * sessionId 从 useSessionStore 获取，不从 preload 获取。
 */
function PlanApprovalBanner(): React.ReactElement | null {
  const { planPhase, diagnostics, mode } = useRunStore();
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const api = window.workagent as any;

  if (planPhase !== 'PLAN_REVIEW' || !diagnostics?.activePlanId || mode !== 'plan') {
    return null;
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 mb-3 bg-amber-50 border border-amber-200 rounded-lg">
      <span className="text-sm text-amber-800">📋 计划已生成，等待审批</span>
      <div className="flex-1" />
      <button
        className="px-3 py-1 text-sm bg-emerald-500 text-white rounded hover:bg-emerald-600 transition-colors"
        onClick={() => api?.approvePlan?.(diagnostics.activePlanId, true, currentSessionId ?? '')}
      >
        ✓ 批准计划
      </button>
      <button
        className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
        onClick={() => api?.approvePlan?.(diagnostics.activePlanId, false, currentSessionId ?? '')}
      >
        ✗ 拒绝计划
      </button>
    </div>
  );
}
