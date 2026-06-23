/**
 * 微压缩 - 清理过时tool_result，截断长工具输出，保留引用ID
 * Level 1压缩，不涉及LLM调用，纯规则处理
 */

import type { Message, ToolCall } from '@workagent/shared';
import { COMPACT_KEEP_RECENT_MESSAGES, MAX_TOOL_RESULT_TOKENS, countTokens } from '@workagent/shared';

// ============================================================
// 微压缩逻辑
// ============================================================

/**
 * 执行微压缩
 * 清理策略：
 * 1. 保留最近N条消息不压缩
 * 2. 清理过时的tool_result消息（对应的tool_call已超过保留范围）
 * 3. 截断超长的工具输出，保留引用ID
 * 4. 保留所有用户消息和系统消息
 * @param messages - 原始消息列表
 * @returns 压缩后的消息列表和释放的token数估算
 */
export function microCompact(messages: Message[]): {
  messages: Message[];
  freedTokens: number;
} {
  if (messages.length <= COMPACT_KEEP_RECENT_MESSAGES) {
    return { messages, freedTokens: 0 };
  }

  // 计算原始token数
  const originalTokens = estimateMessagesTokens(messages);

  // 收集需要保留的toolCallId（最近N条消息中的tool_call）
  const recentToolCallIds = new Set<string>();
  const recentStart = Math.max(0, messages.length - COMPACT_KEEP_RECENT_MESSAGES);
  for (let i = recentStart; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        recentToolCallIds.add(tc.id);
      }
    }
  }

  // 处理消息
  const result: Message[] = [];
  let compactBoundaryId: string | null = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // 保留系统消息
    if (msg.role === 'system') {
      result.push(msg);
      continue;
    }

    // 保留最近的消息
    if (i >= recentStart) {
      result.push(msg);
      continue;
    }

    // 处理过时的tool_result
    if (msg.role === 'tool' && msg.toolCallId) {
      if (recentToolCallIds.has(msg.toolCallId)) {
        // 仍然需要保留此tool_result（最近的tool_call引用了它）
        result.push(truncateToolResult(msg));
      } else {
        // 过时的tool_result，替换为简短占位符
        if (!compactBoundaryId) {
          compactBoundaryId = `compact-micro-${Date.now()}`;
        }
        result.push({
          ...msg,
          content: `[已压缩: tool_result ${msg.toolCallId}]`,
          tokenCount: estimateTokens(`[已压缩: tool_result ${msg.toolCallId}]`),
          compactBoundaryId,
        });
      }
      continue;
    }

    // 保留用户消息
    if (msg.role === 'user') {
      result.push(msg);
      continue;
    }

    // 保留assistant消息中的tool_call
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      result.push(msg);
      continue;
    }

    // 其他assistant消息可以压缩
    if (msg.role === 'assistant') {
      if (!compactBoundaryId) {
        compactBoundaryId = `compact-micro-${Date.now()}`;
      }
      result.push({
        ...msg,
        content: truncateContent(msg.content, 100),
        tokenCount: estimateTokens(truncateContent(msg.content, 100)),
        compactBoundaryId,
      });
      continue;
    }

    // 默认保留
    result.push(msg);
  }

  const newTokens = estimateMessagesTokens(result);

  return {
    messages: result,
    freedTokens: originalTokens - newTokens,
  };
}

/**
 * 截断超长的工具输出，保留引用ID
 * @param msg - 工具结果消息
 * @returns 截断后的消息
 */
function truncateToolResult(msg: Message): Message {
  const maxChars = MAX_TOOL_RESULT_TOKENS * 1.5;
  if (msg.content.length <= maxChars) {
    return msg;
  }

  const truncated = msg.content.slice(0, Math.floor(maxChars));
  const toolCallId = msg.toolCallId ? ` (ref: ${msg.toolCallId})` : '';

  return {
    ...msg,
    content: truncated + `\n...[结果已截断]${toolCallId}`,
    tokenCount: MAX_TOOL_RESULT_TOKENS,
  };
}

/**
 * 截断文本内容到指定字符数
 * @param content - 原始内容
 * @param maxChars - 最大字符数
 * @returns 截断后的内容
 */
function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  return content.slice(0, maxChars) + '...';
}

/**
 * 估算消息列表的总token数
 * @param messages - 消息列表
 * @returns 估算的token数
 */
function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + (msg.tokenCount || estimateTokens(msg.content)), 0);
}

/**
 * 估算文本的token数
 * @param content - 文本内容
 * @returns 估算的token数
 */
function estimateTokens(content: string): number {
  return countTokens(content);
}
