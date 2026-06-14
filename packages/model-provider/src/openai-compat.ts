/**
 * OpenAI兼容API实现
 * 支持局域网中运行OpenAI兼容接口的模型服务
 * 适配 vLLM、Ollama OpenAI模式、LocalAI、LM Studio 等兼容服务
 *
 * 与OllamaNativeProvider的区别：
 * - 使用OpenAI标准API格式（/v1/chat/completions, /v1/embeddings）
 * - 适合局域网中已部署的OpenAI兼容服务
 * - 支持自定义baseURL和API Key
 * - 兼容远程和本地部署的模型
 */

import type { ModelProvider, ChatRequest, ModelEvent, EmbedRequest, EmbedResponse, PullProgress, OllamaStatus, ModelsStatusResult } from './provider.js';
import type { ModelInfo, ModelConfig } from '@workagent/shared';
import { DEFAULT_CONTEXT_LENGTH } from '@workagent/shared';

/** OpenAI兼容提供者配置 */
export interface OpenAICompatConfig {
  /** API基础URL，如 http://192.168.1.100:8000/v1 */
  baseUrl: string;
  /** API密钥（可选，局域网服务通常不需要） */
  apiKey?: string;
  /** 对话模型名称 */
  chatModel: string;
  /** Embedding模型名称（可选，如服务不支持可留空） */
  embeddingModel?: string;
  /** 温度参数 */
  temperature?: number;
  /** 最大生成token数 */
  maxTokens?: number;
  /** 请求超时（毫秒） */
  timeout?: number;
}

/**
 * OpenAI兼容模型提供者
 * 通过OpenAI标准API格式与局域网模型服务交互
 * 适配vLLM、Ollama OpenAI模式、LocalAI、LM Studio等
 */
export class OpenAICompatProvider implements ModelProvider {
  /** 提供者配置 */
  private config: OpenAICompatConfig;

  /** 内部ModelConfig格式 */
  private modelConfig: ModelConfig;

  /**
   * 创建OpenAI兼容模型提供者
   * @param config - 提供者配置
   */
  constructor(config: OpenAICompatConfig) {
    this.config = {
      timeout: 60000,
      temperature: 0.7,
      maxTokens: 4096,
      ...config,
    };

    this.modelConfig = {
      chatModel: config.chatModel,
      embeddingModel: config.embeddingModel ?? '',
      baseUrl: config.baseUrl,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 4096,
    };
  }

  /**
   * 流式对话补全
   * 使用OpenAI标准 /v1/chat/completions 端点
   * 支持SSE流式响应和工具调用
   */
  async *chat(request: ChatRequest): AsyncIterable<ModelEvent> {
    const url = this.buildUrl('/chat/completions');

    const payload = {
      model: request.model ?? this.config.chatModel,
      messages: request.messages.map((m) => {
        const msg: Record<string, unknown> = {
          role: m.role,
          content: m.content,
        };
        // 工具调用结果
        if (m.toolCalls) {
          msg.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }));
        }
        // 工具响应
        if (m.toolCallId) {
          msg.tool_call_id = m.toolCallId;
        }
        return msg;
      }),
      stream: true,
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      ...(request.tools ? {
        tools: request.tools.map((t) => ({
          type: 'function',
          function: t.function,
        })),
      } : {}),
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      yield { type: 'error', data: `OpenAI-compat chat error: ${response.status} ${response.statusText} ${errorText}` };
      return;
    }

    // 解析SSE流
    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', data: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const dataStr = trimmed.slice(6); // 去掉 "data: " 前缀
          if (dataStr === '[DONE]') continue;

          try {
            const data = JSON.parse(dataStr);
            const choice = data.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;

            // 处理推理/思考内容（如qwen3.5的thinking模式）
            if (delta?.reasoning) {
              yield { type: 'thinking', data: delta.reasoning };
            }

            // 处理文本内容
            if (delta?.content) {
              yield { type: 'token', data: delta.content };
            }

            // 处理工具调用
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                yield {
                  type: 'tool_call',
                  data: {
                    id: tc.id ?? `tc_${Date.now()}`,
                    type: 'function' as const,
                    function: {
                      name: tc.function?.name ?? '',
                      arguments: tc.function?.arguments ?? '',
                    },
                  },
                };
              }
            }

            // 处理usage信息（部分兼容服务在最后一个chunk中提供）
            if (data.usage) {
              yield {
                type: 'usage',
                data: {
                  promptTokens: data.usage.prompt_tokens ?? 0,
                  completionTokens: data.usage.completion_tokens ?? 0,
                  totalTokens: data.usage.total_tokens ?? 0,
                },
              };
            }
          } catch {
            // 跳过无法解析的SSE数据
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done', data: null };
  }

  /**
   * 文本向量化
   * 使用OpenAI标准 /v1/embeddings 端点
   */
  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    if (!this.config.embeddingModel) {
      throw new Error('未配置Embedding模型，无法执行向量化。请在设置中配置embedding模型名称。');
    }

    const url = this.buildUrl('/embeddings');
    const input = Array.isArray(request.input) ? request.input : [request.input];

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: request.model ?? this.config.embeddingModel,
        input,
      }),
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    if (!response.ok) {
      throw new Error(`OpenAI-compat embed error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
      model: string;
      usage?: { prompt_tokens: number; total_tokens: number };
    };

    return {
      embeddings: data.data.map((d) => d.embedding),
      model: data.model,
      totalTokens: data.usage?.total_tokens ?? 0,
    };
  }

  /**
   * 列出可用模型
   * 使用OpenAI标准 /v1/models 端点
   */
  async listModels(): Promise<ModelInfo[]> {
    const url = this.buildUrl('/models');

    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return [];

      const data = await response.json() as {
        data: Array<{
          id: string;
          size?: number;
        }>;
      };

      return data.data.map((m) => ({
        name: m.id,
        size: m.size ?? 0,
        family: '',
        parameterSize: '',
        quantizationLevel: '',
      }));
    } catch {
      return [];
    }
  }

  /**
   * 拉取模型（OpenAI兼容服务通常不支持动态拉取）
   * 对于vLLM/LocalAI等服务，模型在服务端预配置
   * 对于Ollama OpenAI模式，可通过Ollama原生API拉取
   */
  async pullModel(name: string, onProgress?: (p: PullProgress) => void): Promise<void> {
    // OpenAI兼容API不支持模型拉取
    // 如果连接的是Ollama OpenAI模式，可以通过原生API拉取
    onProgress?.({
      model: name,
      status: 'failed',
      progress: 0,
      message: 'OpenAI兼容模式不支持模型拉取，请通过服务端管理模型',
    });
  }

  /**
   * 健康检查
   * 检查API端点是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      const url = this.buildUrl('/models');
      const headers: Record<string, string> = {};
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 获取模型状态
   */
  async getModelsStatus(): Promise<ModelsStatusResult> {
    const available = await this.isAvailable();
    if (!available) {
      return {
        ollama: 'unavailable' as OllamaStatus,
        chatModel: { name: this.config.chatModel, available: false },
        embeddingModel: { name: this.config.embeddingModel ?? '', available: false },
        models: [],
      };
    }

    const models = await this.listModels();
    const chatAvailable = models.some((m) => m.name === this.config.chatModel || m.name.startsWith(this.config.chatModel));
    const embedAvailable = !this.config.embeddingModel
      || models.some((m) => m.name === this.config.embeddingModel || m.name.startsWith(this.config.embeddingModel));

    return {
      ollama: 'running',
      chatModel: { name: this.config.chatModel, available: chatAvailable },
      embeddingModel: { name: this.config.embeddingModel ?? '', available: embedAvailable },
      models,
    };
  }

  /**
   * 获取模型上下文长度
   * OpenAI兼容API通常不提供此信息，返回默认值
   * 可通过配置覆盖
   */
  async getContextLength(_modelName?: string): Promise<number> {
    // OpenAI兼容服务通常不提供context_length查询接口
    // 返回默认值，用户可通过配置覆盖
    return DEFAULT_CONTEXT_LENGTH;
  }

  /**
   * 获取当前配置
   */
  getConfig(): ModelConfig {
    return { ...this.modelConfig };
  }

  /**
   * 更新配置
   * 支持运行时动态切换模型和URL
   * @param update - 部分配置更新
   */
  updateConfig(update: Partial<OpenAICompatConfig>): void {
    Object.assign(this.config, update);
    // 同步更新内部ModelConfig
    this.modelConfig = {
      chatModel: this.config.chatModel,
      embeddingModel: this.config.embeddingModel ?? '',
      baseUrl: this.config.baseUrl,
      temperature: this.config.temperature ?? 0.7,
      maxTokens: this.config.maxTokens ?? 4096,
    };
  }

  // ============================================================
  // 私有辅助方法
  // ============================================================

  /**
   * 构建完整API URL
   * 处理baseURL末尾斜杠和路径前缀
   * @param path - API路径（如 /chat/completions）
   * @returns 完整URL
   */
  private buildUrl(path: string): string {
    let base = this.config.baseUrl;
    // 确保base以/v1结尾（OpenAI兼容API标准路径）
    if (!base.endsWith('/v1') && !base.endsWith('/v1/')) {
      base = base.replace(/\/$/, '') + '/v1';
    }
    // 拼接路径
    return base.replace(/\/$/, '') + path;
  }
}
