import React from 'react';
import { useMessageStore } from '../stores/message-store.js';

/**
 * 工具结果视图。
 * 聚合展示最近一次助手消息上的工具调用结果，避免用户只能从长消息里找碎片。
 */
export function ToolResultViewer(): React.ReactElement | null {
  const { messages } = useMessageStore();
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant' && message.toolCalls?.length);

  if (!latestAssistant?.toolCalls?.length) {
    return null;
  }

  return (
    <section className="rounded-lg border border-[var(--wa-border)]/50 bg-[var(--wa-bg-tertiary)]/40 p-3">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--wa-text-secondary)]">工具结果</div>
      <div className="space-y-2">
        {latestAssistant.toolCalls.map((toolCall, index) => (
          <div key={`${toolCall.name}-${index}`} className="rounded border border-[var(--wa-border)]/40 bg-[var(--wa-bg-primary)] px-2.5 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--wa-text-primary)]">{toolCall.name}</span>
              <span className="text-[var(--wa-text-secondary)]">{toolCall.status}</span>
            </div>
            {toolCall.summary && (
              <p className="mt-1 whitespace-pre-wrap text-[var(--wa-text-secondary)]">{toolCall.summary}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
