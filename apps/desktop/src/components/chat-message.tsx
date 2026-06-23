/**
 * 聊天消息组件
 * 支持用户消息、助手消息（含Markdown渲染和工具调用状态）
 */

import React from 'react';
import { MarkdownRenderer } from './markdown-renderer.js';
import type { ChatMessage, ToolCallInfo } from '../stores/app-store.js';

/** 聊天消息组件属性 */
interface ChatMessageProps {
  /** 消息数据 */
  message: ChatMessage;
  /** 是否正在加载（流式输出中） */
  isLoading: boolean;
  /** 是否正在思考（thinking模式，模型尚未输出实际内容） */
  isThinking?: boolean;
}

/**
 * 工具调用状态指示器
 */
function ToolCallBadge({ toolCall }: { toolCall: ToolCallInfo }): React.ReactElement {
  const statusIcon = toolCall.status === 'running' ? (
    <span className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin inline-block" />
  ) : toolCall.status === 'error' ? (
    <span className="wa-icon text-red-400"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6 6 18" /></svg></span>
  ) : (
    <span className="wa-icon text-emerald-400"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 12 4 4L19 6" /></svg></span>
  );

  const statusText = toolCall.status === 'running' ? '执行中' : toolCall.status === 'error' ? '失败' : '完成';
  const statusColor = toolCall.status === 'running' ? 'text-amber-400' : toolCall.status === 'error' ? 'text-red-400' : 'text-emerald-400';

  return (
    <div className="wa-row rounded bg-zinc-800/80 px-2.5 py-1.5 wa-label border border-zinc-700/40">
      {statusIcon}
      <span className="text-zinc-300 font-mono">{toolCall.name}</span>
      <span className={statusColor}>{statusText}</span>
      {toolCall.summary && (
        <span className="text-zinc-500 truncate max-w-[200px]">{toolCall.summary}</span>
      )}
    </div>
  );
}

/**
 * 聊天消息组件
 * 区分用户/助手消息样式，助手消息支持Markdown渲染和工具调用状态
 */
export function ChatMessage({ message, isLoading, isThinking }: ChatMessageProps): React.ReactElement {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-5`}>
      <div className={`${isUser ? 'max-w-[72%]' : 'w-full'}`}>
        {/* 角色标签 */}
        {!isUser && (
          <div className="flex items-center gap-2 mb-1">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#252525] wa-meta text-[#bdbdbd]">WA</span>
            <span className="wa-meta text-[#777]">WorkAgent</span>
          </div>
        )}

        {/* 消息体 */}
        <div className={`px-4 py-3 ${
          isUser
            ? 'rounded-2xl bg-[#2d2d2d] text-[#f0f0f0]'
            : 'rounded-lg bg-transparent text-[#e5e5e5]'
        }`}>
          {/* 用户消息直接显示文本 */}
          {isUser && (
            <div className="whitespace-pre-wrap wa-body leading-relaxed">{message.content}</div>
          )}

          {/* 助手消息渲染Markdown */}
          {isAssistant && (
            <>
              {message.content ? (
                <MarkdownRenderer content={message.content} className="wa-body" />
              ) : isLoading ? (
                <div className="wa-row text-zinc-500">
                  <span className={`w-2 h-2 rounded-full animate-pulse ${isThinking ? 'bg-amber-400' : 'bg-zinc-500'}`} />
                  <span className="wa-label">{isThinking ? '深度思考中...' : '思考中...'}</span>
                  {isThinking && message.tokenCount ? (
                    <span className="wa-meta text-zinc-600">({message.tokenCount}字思考)</span>
                  ) : null}
                </div>
              ) : null}
            </>
          )}

          {/* 工具调用状态 */}
          {isAssistant && message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-3 pt-2 border-t border-zinc-700/40 space-y-1.5">
              <div className="wa-meta text-zinc-500 mb-1">工具调用</div>
              {message.toolCalls.map((tc, i) => (
                <ToolCallBadge key={i} toolCall={tc} />
              ))}
            </div>
          )}
        </div>

        {/* 时间戳 */}
        <div className={`wa-meta text-[#6f6f6f] mt-1 px-4 ${isUser ? 'text-right' : 'text-left'}`}>
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          {message.tokenCount && <span className="ml-2">{message.tokenCount} tokens</span>}
        </div>
      </div>
    </div>
  );
}
