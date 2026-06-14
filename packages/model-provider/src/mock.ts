/**
 * Mock模型提供者 - 开发时不需要真实Ollama
 * 参考Jan的mock-provider模式
 */

import type { ModelProvider, ChatRequest, ModelEvent, EmbedRequest, EmbedResponse, PullProgress, ModelsStatusResult } from './provider.js';
import type { ModelInfo, ModelConfig } from '@workagent/shared';
import { DEFAULT_CHAT_MODEL, DEFAULT_EMBEDDING_MODEL, DEFAULT_CONTEXT_LENGTH, BGE_M3_DIMENSIONS } from '@workagent/shared';

/** Mock预设回复 */
const MOCK_RESPONSES: Record<string, string> = {
  default: '我已理解您的要求，正在处理中。请问还有其他需要补充的信息吗？',
  plan: '好的，我来为您制定写作计划。\n\n## 计划\n1. 确定文种和格式\n2. 检索相关材料\n3. 生成提纲\n4. 逐章节撰写\n5. 审校和导出\n\n请问您对以上步骤有什么需要调整的吗？',
  greeting: '您好！我是公文写作助手，可以帮助您撰写各类公文。请告诉我您需要什么类型的公文？',
};

/**
 * Mock模型提供者
 * 用于前端开发，无需安装Ollama
 */
export class MockModelProvider implements ModelProvider {
  private delay: number;

  constructor(options?: { delay?: number }) {
    this.delay = options?.delay ?? 50; // 模拟流式输出延迟(ms/字符)
  }

  async *chat(request: ChatRequest): AsyncIterable<ModelEvent> {
    // 根据最后一条用户消息选择回复
    const lastUserMsg = request.messages
      .filter(m => m.role === 'user')
      .pop()?.content ?? '';

    let response = MOCK_RESPONSES.default ?? '';
    if (lastUserMsg.includes('计划') || lastUserMsg.includes('plan') || lastUserMsg.includes('提纲')) {
      response = MOCK_RESPONSES.plan ?? '';
    } else if (lastUserMsg.includes('你好') || lastUserMsg.includes('hello') || lastUserMsg.includes('您好')) {
      response = MOCK_RESPONSES.greeting ?? '';
    }

    // 模拟流式输出
    for (const char of response) {
      yield { type: 'token', data: char };
      await sleep(this.delay);
    }

    // 模拟usage
    yield {
      type: 'usage',
      data: {
        promptTokens: lastUserMsg.length,
        completionTokens: response.length,
        totalTokens: lastUserMsg.length + response.length,
      },
    };

    yield { type: 'done', data: null };
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    const input = Array.isArray(request.input) ? request.input : [request.input];

    // 返回随机向量
    const embeddings = input.map(() =>
      Array.from({ length: BGE_M3_DIMENSIONS }, () => Math.random() * 2 - 1),
    );

    return {
      embeddings,
      model: DEFAULT_EMBEDDING_MODEL,
      totalTokens: input.reduce((sum, s) => sum + s.length, 0),
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        name: DEFAULT_CHAT_MODEL,
        size: 5_300_000_000,
        family: 'qwen3',
        parameterSize: '9B',
        quantizationLevel: 'Q4_K_M',
      },
      {
        name: DEFAULT_EMBEDDING_MODEL,
        size: 2_200_000_000,
        family: 'bge',
        parameterSize: '568M',
        quantizationLevel: 'F16',
      },
    ];
  }

  async pullModel(_name: string, onProgress?: (p: PullProgress) => void): Promise<void> {
    // 模拟拉取进度
    for (let i = 0; i <= 100; i += 10) {
      await sleep(100);
      onProgress?.({ model: _name, status: 'pulling', progress: i });
    }
    onProgress?.({ model: _name, status: 'success', progress: 100 });
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getModelsStatus(): Promise<ModelsStatusResult> {
    return {
      ollama: 'running',
      chatModel: { name: DEFAULT_CHAT_MODEL, available: true },
      embeddingModel: { name: DEFAULT_EMBEDDING_MODEL, available: true },
      models: await this.listModels(),
    };
  }

  async getContextLength(_modelName?: string): Promise<number> {
    return DEFAULT_CONTEXT_LENGTH;
  }

  getConfig(): ModelConfig {
    return {
      chatModel: DEFAULT_CHAT_MODEL,
      embeddingModel: DEFAULT_EMBEDDING_MODEL,
      baseUrl: 'mock://localhost',
      temperature: 0.7,
      maxTokens: 4096,
    };
  }
}

/** 简单sleep工具 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
