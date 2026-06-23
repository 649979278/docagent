/**
 * 摘要压缩 - 使用LLM生成结构化摘要，保留关键信息
 * 超过75%上下文阈值时触发
 * 必须保留：用户明确要求、文种格式约束、当前计划、已选材料来源、禁用表达、已生成草稿关键结论
 */

import type { Message, Memory } from '@workagent/shared';
import { COMPACT_KEEP_RECENT_MESSAGES, countTokens } from '@workagent/shared';
import type { ModelProvider } from '@workagent/model-provider';
import type { ChatMessage } from '@workagent/model-provider';

// ============================================================
// 摘要压缩提示模板
// ============================================================

/** 摘要压缩的系统提示 */
const SUMMARY_COMPACT_SYSTEM_PROMPT = `你是一个上下文压缩助手。你的任务是将对话历史压缩为结构化摘要，保留以下关键信息：

1. **用户明确要求**：用户提出的所有明确要求、偏好和指令
2. **文种格式约束**：公文文种、格式要求、字数限制等
3. **当前计划**：当前的工作计划和进度
4. **已选材料来源**：已检索和引用的材料来源（文件名、章节、引用ID）
5. **禁用表达**：用户明确禁止使用的表达方式或术语
6. **已生成草稿关键结论**：已生成内容的核心结论和关键数据

输出格式：
## 用户要求
- ...

## 文种格式约束
- ...

## 当前计划
- ...

## 材料来源
- ...

## 禁用表达
- ...

## 关键结论
- ...

## 其他重要上下文
- ...`;

// ============================================================
// 摘要压缩结果
// ============================================================

/** 摘要压缩结果 */
export interface SummaryCompactResult {
  /** 压缩后的消息列表 */
  messages: Message[];
  /** 摘要文本 */
  summary: string;
  /** 释放的token数估算 */
  freedTokens: number;
}

// ============================================================
// 摘要压缩函数
// ============================================================

/**
 * 执行摘要压缩
 * 1. 将旧消息发给LLM生成结构化摘要
 * 2. 用摘要消息替换旧消息
 * 3. 保留最近N条消息不变
 * @param messages - 原始消息列表
 * @param provider - 模型提供者
 * @param memories - 当前加载的显式记忆
 * @returns 摘要压缩结果
 */
export async function summaryCompact(
  messages: Message[],
  provider: ModelProvider,
  memories: Memory[] = [],
): Promise<SummaryCompactResult> {
  const originalTokens = estimateMessagesTokens(messages);

  // 分割消息：旧的要压缩的 + 最近的要保留的
  const splitIndex = Math.max(0, messages.length - COMPACT_KEEP_RECENT_MESSAGES);
  const oldMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  // 如果没有旧消息需要压缩，直接返回
  if (oldMessages.length === 0) {
    return {
      messages,
      summary: '',
      freedTokens: 0,
    };
  }

  // 构建压缩请求
  const chatMessages = buildCompactMessages(oldMessages, memories);

  // 调用LLM生成摘要
  let summary = '';
  try {
    const stream = provider.chat({
      messages: chatMessages,
      temperature: 0,
      maxTokens: 2000,
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'token') {
        summary += event.data;
      }
      if (event.type === 'done') {
        break;
      }
    }
  } catch {
    // LLM调用失败时，使用简单的文本截断作为fallback
    summary = fallbackSummary(oldMessages);
  }

  // 构建压缩后的消息列表
  const compactBoundaryId = `compact-summary-${Date.now()}`;
  const summaryMessage: Message = {
    id: `summary-${Date.now()}`,
    role: 'system',
    content: `[上下文压缩摘要]\n${summary}`,
    eventType: 'summary',
    tokenCount: estimateTokens(summary) + 10,
    compactBoundaryId,
    timestamp: Date.now(),
  };

  const resultMessages = [summaryMessage, ...recentMessages];
  const newTokens = estimateMessagesTokens(resultMessages);

  return {
    messages: resultMessages,
    summary,
    freedTokens: originalTokens - newTokens,
  };
}

/**
 * 构建发送给LLM的压缩请求消息
 * @param oldMessages - 需要压缩的旧消息
 * @param memories - 显式记忆列表
 * @returns LLM消息列表
 */
function buildCompactMessages(
  oldMessages: Message[],
  memories: Memory[],
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: SUMMARY_COMPACT_SYSTEM_PROMPT },
  ];

  // 添加显式记忆作为额外上下文
  if (memories.length > 0) {
    const memoryText = memories
      .filter((m) => m.enabled)
      .map((m) => `[${m.type}] ${m.content}`)
      .join('\n');
    messages.push({
      role: 'user',
      content: `当前用户记忆：\n${memoryText}`,
    });
  }

  // 将旧消息格式化为文本
  const conversationText = oldMessages
    .map((msg) => {
      const role = msg.role;
      let content = msg.content;

      // 截断过长的工具输出
      if (msg.role === 'tool' && content.length > 500) {
        content = content.slice(0, 500) + '...[已截断]';
      }

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const toolText = msg.toolCalls
          .map((tc) => `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})`)
          .join(', ');
        content = `[工具调用: ${toolText}] ${content}`;
      }

      return `[${role}] ${content}`;
    })
    .join('\n\n');

  messages.push({
    role: 'user',
    content: `请压缩以下对话历史，保留关键信息：\n\n${conversationText}`,
  });

  return messages;
}

/**
 * Fallback摘要：LLM不可用时使用简单的文本拼接
 * @param messages - 旧消息列表
 * @returns 简单摘要文本
 */
function fallbackSummary(messages: Message[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      parts.push(`用户: ${msg.content.slice(0, 100)}`);
    } else if (msg.role === 'assistant' && !msg.toolCalls?.length) {
      parts.push(`助手: ${msg.content.slice(0, 100)}`);
    } else if (msg.role === 'tool') {
      parts.push(`工具结果[${msg.toolCallId}]: ${msg.content.slice(0, 50)}...`);
    }
  }

  return parts.join('\n');
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
