/**
 * Ollama原生API实现
 * 使用 /api/chat, /api/embed, /api/pull 等原生端点
 * 比OpenAI-compatible提供更多信息（eval_count, prompt_eval_count等）
 */

import type { ModelProvider, ChatRequest, ModelEvent, EmbedRequest, EmbedResponse, PullProgress, OllamaStatus, ModelsStatusResult } from './provider.js';
import type { ModelInfo, ModelConfig } from '@workagent/shared';
import {
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_HEALTH_ENDPOINT,
  OLLAMA_CHAT_ENDPOINT,
  OLLAMA_EMBED_ENDPOINT,
  OLLAMA_PULL_ENDPOINT,
  OLLAMA_SHOW_ENDPOINT,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_CONTEXT_LENGTH,
} from '@workagent/shared';

/** Ollama原生API客户端 */
export class OllamaNativeProvider implements ModelProvider {
  private baseUrl: string;
  private config: ModelConfig;

  constructor(config?: Partial<ModelConfig>) {
    this.config = {
      chatModel: config?.chatModel ?? DEFAULT_CHAT_MODEL,
      embeddingModel: config?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
      baseUrl: config?.baseUrl ?? OLLAMA_DEFAULT_BASE_URL,
      temperature: config?.temperature ?? 0.7,
      maxTokens: config?.maxTokens ?? 4096,
    };
    this.baseUrl = this.config.baseUrl;
  }

  /**
   * 流式对话补全
   * 使用Ollama原生 /api/chat 端点
   */
  async *chat(request: ChatRequest): AsyncIterable<ModelEvent> {
    const payload = {
      model: request.model ?? this.config.chatModel,
      messages: request.messages.map(m => {
        const msg: Record<string, unknown> = {
          role: m.role,
          content: m.content,
        };

        // 处理assistant消息中的tool_calls
        // Ollama要求arguments是对象而非JSON字符串
        if (m.toolCalls) {
          msg.tool_calls = m.toolCalls.map(tc => ({
            id: tc.id,
            type: tc.type ?? 'function',
            function: {
              name: tc.function.name,
              // Ollama原生API要求arguments是对象，不是JSON字符串
              arguments: typeof tc.function.arguments === 'string'
                ? (() => { try { return JSON.parse(tc.function.arguments); } catch { return { raw: tc.function.arguments }; } })()
                : tc.function.arguments,
            },
          }));
        }

        // 处理tool角色消息 - Ollama需要name字段而非tool_call_id
        if (m.role === 'tool') {
          // 优先使用显式指定的toolName，否则从toolCallId推断
          msg.name = m.toolName ?? m.toolCallId?.replace(/^tc_/, '') ?? 'unknown_tool';
        }

        return msg;
      }),
      stream: true,
      options: {
        temperature: request.temperature ?? this.config.temperature,
        num_predict: request.maxTokens ?? this.config.maxTokens,
      },
      ...(request.tools ? { tools: request.tools } : {}),
    };

    const response = await fetch(`${this.baseUrl}${OLLAMA_CHAT_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      yield { type: 'error', data: `Ollama chat error: ${response.status} ${response.statusText}` };
      return;
    }

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
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);

            // 处理流式消息
            if (data.message?.content) {
              yield { type: 'token', data: data.message.content };
            }

            // 处理思考过程（qwen3.5等支持thinking的模型）
            if (data.message?.thinking) {
              yield { type: 'thinking', data: data.message.thinking };
            }

            // 处理工具调用
            if (data.message?.tool_calls) {
              for (const tc of data.message.tool_calls) {
                // Ollama返回的arguments是对象，保持原样（不再JSON.stringify）
                const args = tc.function?.arguments;
                yield {
                  type: 'tool_call',
                  data: {
                    id: tc.id ?? `tc_${Date.now()}`,
                    type: 'function' as const,
                    function: {
                      name: tc.function?.name ?? '',
                      arguments: typeof args === 'string'
                        ? (() => { try { return JSON.parse(args); } catch { return { raw: args }; } })()
                        : (args ?? {}),
                    },
                  },
                };
              }
            }

            // 处理完成（含usage信息）
            if (data.done) {
              yield {
                type: 'usage',
                data: {
                  promptTokens: data.prompt_eval_count ?? 0,
                  completionTokens: data.eval_count ?? 0,
                  totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
                },
              };
            }
          } catch {
            // 跳过无法解析的行
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
   * 使用Ollama原生 /api/embed 端点
   */
  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    const input = Array.isArray(request.input) ? request.input : [request.input];

    const response = await fetch(`${this.baseUrl}${OLLAMA_EMBED_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model ?? this.config.embeddingModel,
        input,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embed error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      embeddings: number[][];
      model: string;
      'prompt-eval-count'?: number;
    };

    return {
      embeddings: data.embeddings,
      model: data.model,
      totalTokens: data['prompt-eval-count'] ?? 0,
    };
  }

  /**
   * 列出可用模型
   * 使用 /api/tags 端点
   */
  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}${OLLAMA_HEALTH_ENDPOINT}`);
    if (!response.ok) return [];

    const data = await response.json() as {
      models: Array<{
        name: string;
        size: number;
        details: {
          family: string;
          parameter_size: string;
          quantization_level: string;
        };
      }>;
    };

    return data.models.map(m => ({
      name: m.name,
      size: m.size,
      family: m.details.family,
      parameterSize: m.details.parameter_size,
      quantizationLevel: m.details.quantization_level,
    }));
  }

  /**
   * 拉取模型
   * 使用 /api/pull 端点，支持进度回调
   */
  async pullModel(name: string, onProgress?: (p: PullProgress) => void): Promise<void> {
    const response = await fetch(`${this.baseUrl}${OLLAMA_PULL_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`Ollama pull error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body for pull');

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
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (onProgress) {
              const progress = this.parsePullProgress(name, data);
              onProgress(progress);
            }
          } catch {
            // skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (onProgress) {
      onProgress({ model: name, status: 'success', progress: 100 });
    }
  }

  /**
   * 健康检查
   * 检查Ollama API是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}${OLLAMA_HEALTH_ENDPOINT}`, {
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
        embeddingModel: { name: this.config.embeddingModel, available: false },
        models: [],
      };
    }

    const models = await this.listModels();
    const chatAvailable = models.some(m => m.name.startsWith(this.config.chatModel));
    const embedAvailable = models.some(m => m.name.startsWith(this.config.embeddingModel));

    return {
      ollama: 'running',
      chatModel: { name: this.config.chatModel, available: chatAvailable },
      embeddingModel: { name: this.config.embeddingModel, available: embedAvailable },
      models,
    };
  }

  /**
   * 获取模型上下文长度
   * 从Ollama /api/show 获取模型信息
   */
  async getContextLength(modelName?: string): Promise<number> {
    try {
      const response = await fetch(`${this.baseUrl}${OLLAMA_SHOW_ENDPOINT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName ?? this.config.chatModel }),
      });

      if (!response.ok) return DEFAULT_CONTEXT_LENGTH;

      const data = await response.json() as {
        model_info?: Record<string, unknown>;
      };

      // 尝试从model_info中获取context_length
      const contextLength = data.model_info?.['context_length'];
      if (typeof contextLength === 'number') return contextLength;

      return DEFAULT_CONTEXT_LENGTH;
    } catch {
      return DEFAULT_CONTEXT_LENGTH;
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): ModelConfig {
    return { ...this.config };
  }

  /**
   * 解析pull进度
   */
  private parsePullProgress(model: string, data: Record<string, unknown>): PullProgress {
    const status = data.status as string ?? '';
    if (status === 'success') {
      return { model, status: 'success', progress: 100 };
    }
    if (status.includes('error') || status.includes('failed')) {
      return { model, status: 'failed', progress: 0, message: status };
    }

    // 计算下载进度
    const total = data.total as number ?? 0;
    const completed = data.completed as number ?? 0;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      model,
      status: 'pulling',
      progress,
      message: status,
    };
  }
}
