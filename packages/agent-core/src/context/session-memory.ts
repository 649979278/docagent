/**
 * Session Memory Lite - 轻量会话记忆
 * 每 5 轮或 token 增量达 4000 时异步提炼一次摘要
 * 对齐 Claude Code 的 session summary 模式
 */

import type { Message, Memory } from '@workagent/shared';
import type { ModelProvider } from '@workagent/model-provider';
import { estimateTokens } from './budget.js';

// ============================================================
// 常量
// ============================================================

/** 默认摘要触发轮次间隔 */
const DEFAULT_SUMMARY_TURN_INTERVAL = 5;

/** 默认摘要触发 token 增量阈值 */
const DEFAULT_SUMMARY_TOKEN_THRESHOLD = 4000;

/** 摘要 prompt 模板 */
const SUMMARY_PROMPT = `请根据以下对话历史，提炼结构化摘要。格式如下：

## 用户目标
（用户想要达成的目标）

## 当前进展
（已完成的关键步骤和结论）

## 未决问题
（尚未解决或需要确认的问题）

## 关键约束
（用户明确提出的要求、格式、限制）

对话历史：
`;

// ============================================================
// SessionMemoryLite
// ============================================================

/**
 * 会话摘要结构
 */
export interface SessionSummary {
  /** 用户目标 */
  userGoal: string;
  /** 当前进展 */
  progress: string;
  /** 未决问题 */
  openQuestions: string;
  /** 关键约束 */
  constraints: string;
}

/**
 * 轻量会话记忆 — 每 3-5 轮或 token 增量达阈值时异步提炼一次摘要
 * 摘要替代早期消息被压缩掉的内容，确保上下文延续性
 */
export class SessionMemoryLite {
  /** 上次摘要时的轮次 */
  private lastSummaryTurn: number = 0;
  /** 上次摘要时的累计 token 数 */
  private lastSummaryTokens: number = 0;
  /** 当前摘要 */
  private summary: string | null = null;
  /** 摘要触发轮次间隔 */
  private turnInterval: number;
  /** 摘要触发 token 增量阈值 */
  private tokenThreshold: number;

  /**
   * 创建轻量会话记忆
   * @param turnInterval - 摘要触发轮次间隔（默认 5）
   * @param tokenThreshold - 摘要触发 token 增量阈值（默认 4000）
   */
  constructor(turnInterval: number = DEFAULT_SUMMARY_TURN_INTERVAL, tokenThreshold: number = DEFAULT_SUMMARY_TOKEN_THRESHOLD) {
    this.turnInterval = turnInterval;
    this.tokenThreshold = tokenThreshold;
  }

  /**
   * 检查是否需要提炼摘要
   * @param turnCount - 当前轮次
   * @param currentTokens - 当前累计 token 数
   * @returns 是否需要提炼
   */
  shouldSummarize(turnCount: number, currentTokens: number): boolean {
    const turnDelta = turnCount - this.lastSummaryTurn;
    const tokenDelta = currentTokens - this.lastSummaryTokens;
    return turnDelta >= this.turnInterval || tokenDelta > this.tokenThreshold;
  }

  /**
   * 异步提炼会话摘要
   * 使用 provider 生成结构化摘要：用户目标/当前进展/未决问题/关键约束
   * @param messages - 当前消息列表
   * @param provider - 模型提供者
   * @returns 提炼后的摘要文本
   */
  async summarize(messages: Message[], provider: ModelProvider): Promise<string> {
    // 构建摘要 prompt
    const conversationText = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
      .join('\n');

    const prompt = SUMMARY_PROMPT + conversationText;

    let result = '';
    try {
      const stream = provider.chat({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 1024,
        stream: true,
      });

      for await (const event of stream) {
        if (event.type === 'token') {
          result += event.data;
        } else if (event.type === 'done') {
          break;
        }
      }
    } catch {
      // 摘要失败不应阻塞主流程，返回当前摘要或空字符串
      return this.summary ?? '';
    }

    if (result) {
      this.summary = result;
    }

    return this.summary ?? '';
  }

  /**
   * 更新摘要触发基准（在摘要完成后调用）
   * @param turnCount - 当前轮次
   * @param currentTokens - 当前累计 token 数
   */
  updateBaseline(turnCount: number, currentTokens: number): void {
    this.lastSummaryTurn = turnCount;
    this.lastSummaryTokens = currentTokens;
  }

  /**
   * 获取当前摘要
   * @returns 当前摘要文本，如果无摘要返回 null
   */
  getSummary(): string | null {
    return this.summary;
  }

  /**
   * 获取摘要 token 估算
   * @returns 摘要 token 数，如果无摘要返回 0
   */
  getSummaryTokenEstimate(): number {
    if (!this.summary) return 0;
    return estimateTokens(this.summary);
  }

  /**
   * 将摘要格式化为可注入的消息内容
   * @returns 格式化后的摘要文本，如果无摘要返回 null
   */
  formatSummaryForInjection(): string | null {
    if (!this.summary) return null;
    return `## 会话摘要\n\n以下是之前对话的摘要，请在后续回答中参考：\n\n${this.summary}`;
  }
}
