'use strict';

/**
 * Ollama 必需模型清单（精确匹配模型名）。
 * 此文件为纯 CJS，不依赖 TypeScript 编译，doctor-env.js 在构建前也能引用。
 */
const REQUIRED_OLLAMA_MODELS = {
  chat: 'qwen3.5:9b',
  embedding: 'bge-m3',
  reranker: 'bge-reranker-v2-m3',
};

/**
 * 模型名 alias 白名单。
 * key = 期望模型名，value = 可接受的替代 tag 列表。
 * 不在白名单中的变体一律视为不匹配。
 */
const MODEL_ALIASES = {
  'qwen3.5:9b': ['qwen3.5:9b-q4_K_M'],
  'bge-m3': ['bge-m3:latest'],
  'bge-reranker-v2-m3': ['qllama/bge-reranker-v2-m3:latest'],
};

/**
 * 检查 Ollama 模型列表是否包含指定模型。
 * 精确匹配优先，再查 alias 白名单。
 * qwen3.5:7b 不会误判为 qwen3.5:9b。
 *
 * @param {string} modelName - 期望的模型名。
 * @param {string[]} availableModels - Ollama 返回的可用模型名列表。
 * @returns {boolean} 是否可用。
 */
function isModelAvailable(modelName, availableModels) {
  // 精确匹配
  if (availableModels.includes(modelName)) return true;
  // alias 白名单匹配
  const aliases = MODEL_ALIASES[modelName] ?? [];
  return aliases.some(function (alias) { return availableModels.includes(alias); });
}

module.exports = { REQUIRED_OLLAMA_MODELS, MODEL_ALIASES, isModelAvailable };
