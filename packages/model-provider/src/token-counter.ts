/**
 * Token计数器
 * 优先使用Ollama返回的usage字段作为ground truth
 * 回退到字符数估算（中文约1.5字/token，英文约4字/token）
 * 二期可集成js-tiktoken进行更精确的计数
 */

import type { UsageInfo } from './provider.js';

/** Token计数结果 */
export interface TokenCountResult {
  /** token数量 */
  tokenCount: number;
  /** 计数方式 */
  method: 'ollama_usage' | 'estimate';
  /** 估算的置信度（0-1） */
  confidence: number;
}

/**
 * 从Ollama usage信息获取精确token计数
 * Ollama返回的prompt_eval_count和eval_count是ground truth
 * @param usage - Ollama返回的usage信息
 * @returns token计数结果
 */
export function countTokensFromUsage(usage: UsageInfo): TokenCountResult {
  return {
    tokenCount: usage.totalTokens,
    method: 'ollama_usage',
    confidence: 1.0,
  };
}

/**
 * 估算文本的token数
 * 粗略估算：混合中英文文本约2字符/token
 * 中文约1.5字/token，英文约4字符/token
 * @param text - 待估算的文本
 * @returns token计数结果
 */
export function estimateTokenCount(text: string): TokenCountResult {
  if (!text || text.length === 0) {
    return { tokenCount: 0, method: 'estimate', confidence: 0.5 };
  }

  // 区分中文字符和ASCII字符
  let cjkCount = 0;
  let asciiCount = 0;

  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||  // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4DBF) ||  // CJK Unified Ideographs Extension A
      (code >= 0x3000 && code <= 0x303F) ||  // CJK Symbols and Punctuation
      (code >= 0xFF00 && code <= 0xFFEF)       // Halfwidth and Fullwidth Forms
    ) {
      cjkCount++;
    } else {
      asciiCount++;
    }
  }

  // 中文约1.5字/token，英文约4字符/token
  const cjkTokens = cjkCount / 1.5;
  const asciiTokens = asciiCount / 4;
  const totalTokens = Math.ceil(cjkTokens + asciiTokens);

  return {
    tokenCount: totalTokens,
    method: 'estimate',
    confidence: 0.6,
  };
}

/**
 * 估算消息列表的总token数
 * @param messages - 消息列表
 * @returns 总token数
 */
export function estimateMessagesTokens(messages: Array<{ content: string; tokenCount?: number }>): number {
  return messages.reduce((sum, msg) => {
    if (msg.tokenCount && msg.tokenCount > 0) {
      return sum + msg.tokenCount;
    }
    return sum + estimateTokenCount(msg.content).tokenCount;
  }, 0);
}

/**
 * 检查上下文使用率是否超过阈值
 * @param usedTokens - 已使用token数
 * @param totalTokens - 总可用token数
 * @param threshold - 阈值（0-1），默认0.75
 * @returns 是否超过阈值
 */
export function isContextOverThreshold(
  usedTokens: number,
  totalTokens: number,
  threshold: number = 0.75,
): boolean {
  if (totalTokens <= 0) return false;
  return (usedTokens / totalTokens) > threshold;
}
