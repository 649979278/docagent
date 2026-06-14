/**
 * @workagent/model-provider - 统一模型接口入口
 */

// 接口定义
export type {
  ChatRequest,
  ChatMessage,
  ToolDefinition,
  ToolCallResult,
  ModelEvent,
  UsageInfo,
  EmbedRequest,
  EmbedResponse,
  PullProgress,
  OllamaStatus,
  ModelsStatusResult,
} from './provider.js';

export type { ModelProvider } from './provider.js';

// Ollama实现
export { OllamaNativeProvider } from './ollama-native.js';

// OpenAI兼容实现（局域网）
export { OpenAICompatProvider } from './openai-compat.js';
export type { OpenAICompatConfig } from './openai-compat.js';

// Mock实现
export { MockModelProvider } from './mock.js';

// 健康检查
export { ModelHealthMonitor, checkModelHealth } from './health.js';
export type { HealthCheckResult, HealthCallback } from './health.js';

// Token计数
export { countTokensFromUsage, estimateTokenCount, estimateMessagesTokens, isContextOverThreshold } from './token-counter.js';
export type { TokenCountResult } from './token-counter.js';
