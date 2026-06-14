/**
 * ModelProvider统一接口
 * 支持本机Ollama、局域网OpenAI-compatible、Mock三种实现
 */

import type { ModelInfo, ModelConfig } from '@workagent/shared';

// ============================================================
// 模型请求和响应类型
// ============================================================

/** 聊天请求 */
export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

/** 聊天消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCallResult[];
  toolCallId?: string;
  /** tool角色消息对应的工具名称（Ollama原生API需要此字段） */
  toolName?: string;
}

/** 工具定义（模型看到的） */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** 工具调用结果（模型返回的） */
export interface ToolCallResult {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** arguments: Ollama返回对象，OpenAI兼容返回JSON字符串 */
    arguments: string | Record<string, unknown>;
  };
}

/** 模型流式事件 */
export type ModelEvent =
  | { type: 'token'; data: string }
  | { type: 'thinking'; data: string }
  | { type: 'tool_call'; data: ToolCallResult }
  | { type: 'usage'; data: UsageInfo }
  | { type: 'done'; data: null }
  | { type: 'error'; data: string };

/** Token使用信息 */
export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Embedding请求 */
export interface EmbedRequest {
  input: string | string[];
  model?: string;
}

/** Embedding响应 */
export interface EmbedResponse {
  embeddings: number[][];
  model: string;
  totalTokens: number;
}

/** 模型拉取进度 */
export interface PullProgress {
  model: string;
  status: 'pulling' | 'success' | 'failed';
  progress: number; // 0-100
  message?: string;
}

/** Ollama状态 */
export type OllamaStatus = 'running' | 'not_installed' | 'start_failed' | 'unavailable';

/** 模型状态检查结果 */
export interface ModelsStatusResult {
  ollama: OllamaStatus;
  chatModel: { name: string; available: boolean };
  embeddingModel: { name: string; available: boolean };
  models: ModelInfo[];
}

// ============================================================
// ModelProvider接口
// ============================================================

/**
 * 统一模型提供者接口
 * 隐藏Ollama/OpenAI-compatible/Mock的差异
 */
export interface ModelProvider {
  /** 流式对话补全 */
  chat(request: ChatRequest): AsyncIterable<ModelEvent>;

  /** 文本向量化 */
  embed(request: EmbedRequest): Promise<EmbedResponse>;

  /** 列出可用模型 */
  listModels(): Promise<ModelInfo[]>;

  /** 拉取模型 */
  pullModel(name: string, onProgress?: (p: PullProgress) => void): Promise<void>;

  /** 健康检查 */
  isAvailable(): Promise<boolean>;

  /** 获取模型状态 */
  getModelsStatus(): Promise<ModelsStatusResult>;

  /** 获取模型上下文长度 */
  getContextLength(modelName?: string): Promise<number>;

  /** 获取当前配置 */
  getConfig(): ModelConfig;
}
