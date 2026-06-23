import { encodingForModel } from 'js-tiktoken';

const encoder = encodingForModel('gpt-4o');

/**
 * 计算文本的 token 数量。
 * 统一供预算控制、RAG 截断和上下文诊断使用。
 *
 * @param text - 要计算的文本。
 * @returns token 数量。
 */
export function countTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return encoder.encode(text).length;
}
