/**
 * 底部状态栏组件
 * Codex风格：上下文进度条 + 运行状态 + 消息计数
 */

import React from 'react';
import type { ContextMetrics } from '../stores/app-store.js';

/** 状态栏组件属性 */
interface StatusBarProps {
  /** 上下文指标 */
  contextMetrics: ContextMetrics;
  /** 消息总数 */
  messageCount: number;
  /** Ollama状态 */
  ollamaStatus: 'checking' | 'running' | 'not_installed' | 'start_failed';
  /** 当前模式 */
  mode: 'chat' | 'plan' | 'execute';
  /** 是否正在加载 */
  isLoading: boolean;
}

/**
 * 上下文使用率颜色
 */
function getContextColor(percentage: number): string {
  if (percentage < 50) return 'bg-emerald-500';
  if (percentage < 75) return 'bg-blue-500';
  if (percentage < 90) return 'bg-amber-500';
  return 'bg-red-500';
}

/**
 * 上下文使用率文字颜色
 */
function getContextTextColor(percentage: number): string {
  if (percentage < 50) return 'text-emerald-400';
  if (percentage < 75) return 'text-blue-400';
  if (percentage < 90) return 'text-amber-400';
  return 'text-red-400';
}

/**
 * 底部状态栏
 * 显示上下文使用率、模型状态、消息计数等关键指标
 */
export function StatusBar({
  contextMetrics,
  messageCount,
  ollamaStatus,
  mode,
  isLoading,
}: StatusBarProps): React.ReactElement {
  const pct = Math.min(contextMetrics.usedPercentage, 100);
  const barColor = getContextColor(pct);
  const textColor = getContextTextColor(pct);

  return (
    <footer className="flex items-center justify-between px-4 py-1.5 bg-zinc-950 border-t border-zinc-800 text-xs text-zinc-500 select-none">
      {/* 左侧：上下文指标 */}
      <div className="flex items-center gap-4">
        {/* 上下文使用率 */}
        <div className="flex items-center gap-2">
          <span className="text-zinc-600">上下文</span>
          <div className="w-28 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${barColor} transition-all duration-500 ease-out rounded-full`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className={`tabular-nums ${textColor}`}>
            {pct.toFixed(0)}%
          </span>
        </div>

        {/* Token计数 */}
        {contextMetrics.usedTokens > 0 && (
          <span className="text-zinc-600 tabular-nums">
            {contextMetrics.usedTokens.toLocaleString()} / {contextMetrics.contextLength.toLocaleString()}
          </span>
        )}

        {/* 压缩次数 */}
        {contextMetrics.compactCount > 0 && (
          <span className="text-zinc-600">
            压缩 {contextMetrics.compactCount}次
            {contextMetrics.lastCompactFreed > 0 && (
              <span className="text-emerald-600 ml-1">
                -{contextMetrics.lastCompactFreed.toLocaleString()} tokens
              </span>
            )}
          </span>
        )}
      </div>

      {/* 右侧：状态信息 */}
      <div className="flex items-center gap-3">
        {/* 加载状态 */}
        {isLoading && (
          <div className="flex items-center gap-1.5 text-amber-400">
            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
            <span>生成中</span>
          </div>
        )}

        {/* 模式 */}
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
          mode === 'plan' ? 'bg-amber-500/15 text-amber-400' :
          mode === 'execute' ? 'bg-blue-500/15 text-blue-400' :
          'bg-zinc-800 text-zinc-500'
        }`}>
          {mode === 'plan' ? 'Plan' : mode === 'execute' ? 'Execute' : 'Chat'}
        </span>

        {/* 消息数 */}
        <span className="text-zinc-600 tabular-nums">{messageCount} 条消息</span>

        {/* 版本 */}
        <span className="text-zinc-700">v0.1.0</span>
      </div>
    </footer>
  );
}
