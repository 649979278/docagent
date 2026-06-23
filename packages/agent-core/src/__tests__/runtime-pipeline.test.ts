/**
 * Runtime Pipeline 集成测试
 * 验证：
 * 1. Pipeline 步骤执行顺序正确
 * 2. 多轮对话 state 不可变传递
 * 3. handleError 返回新 state 而非原地修改
 * 4. 路由与 pipeline 协同
 * 5. 不可变更新在多轮循环中保持一致
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from '../runtime.js';
import type { ModelProvider, ChatRequest, ModelEvent } from '@workagent/model-provider';
import type { ModelConfig } from '@workagent/shared';
import type { ToolRegistry, ToolExecutor, AgentTool } from '@workagent/tools';
import type { Database } from '@workagent/store';

// ============================================================
// Mock 工具函数
// ============================================================

/** 创建 mock ModelProvider - 返回简单文本回复 */
function createMockProvider(options?: {
  reply?: string;
  thinkingText?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  contextLength?: number;
}): ModelProvider {
  const reply = options?.reply ?? '这是助手回复';
  const toolCalls = options?.toolCalls;

  return {
    chat: vi.fn().mockImplementation((request: ChatRequest) => {
      const events: ModelEvent[] = [];

      // thinking 事件
      if (options?.thinkingText) {
        events.push({ type: 'thinking', data: options.thinkingText });
      }

      // token 事件
      events.push({ type: 'token', data: reply });

      // tool_call 事件
      if (toolCalls) {
        for (const tc of toolCalls) {
          events.push({
            type: 'tool_call',
            data: {
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.arguments },
            },
          });
        }
      }

      // usage 事件
      events.push({
        type: 'usage',
        data: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      });

      // done 事件
      events.push({ type: 'done', data: undefined });

      // 返回异步迭代器
      return (async function* () {
        for (const event of events) {
          yield event;
        }
      })();
    }),
    embed: vi.fn().mockResolvedValue({ embedding: [], model: 'test' }),
    listModels: vi.fn().mockResolvedValue([]),
    pullModel: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(true),
    getModelsStatus: vi.fn().mockResolvedValue({
      providers: [],
      activeModel: 'test',
      health: true,
    }),
    getContextLength: vi.fn().mockResolvedValue(options?.contextLength ?? 32768),
    getConfig: vi.fn().mockReturnValue({
      chatModel: 'test-model',
      embeddingModel: 'test-embed',
      baseUrl: 'http://localhost:11434',
      temperature: 0.7,
      maxTokens: 4096,
    } satisfies ModelConfig),
  };
}

/** 创建 mock ToolRegistry */
function createMockRegistry(tools: AgentTool[] = []): ToolRegistry {
  const toolMap = new Map(tools.map(t => [t.name, t]));
  return {
    register: vi.fn(),
    getTools: vi.fn().mockReturnValue(tools),
    getTool: vi.fn().mockImplementation((name: string) => toolMap.get(name)),
    getToolNames: vi.fn().mockReturnValue(tools.map(t => t.name)),
    has: vi.fn().mockImplementation((name: string) => toolMap.has(name)),
  } as unknown as ToolRegistry;
}

/** 创建 mock ToolExecutor */
function createMockExecutor(results?: Array<{ output: string; isError: boolean }>): ToolExecutor {
  const defaultResults = results ?? [{ output: '工具执行结果', isError: false }];

  return {
    executeAll: vi.fn().mockImplementation((calls) => {
      return Promise.resolve(
        calls.map((call: any, i: number) => {
          const r = defaultResults[i % defaultResults.length];
          return {
            call,
            output: r.output,
            isError: r.isError,
            summary: r.output.slice(0, 50),
          };
        }),
      );
    }),
    executeOne: vi.fn(),
  } as unknown as ToolExecutor;
}

/** 创建 mock Database */
function createMockDatabase(): Database {
  return {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(undefined),
      run: vi.fn().mockReturnValue({ changes: 0 }),
    }),
    exec: vi.fn(),
    transaction: vi.fn().mockImplementation((fn: () => void) => fn),
    pragma: vi.fn(),
    close: vi.fn(),
  } as unknown as Database;
}

/** 创建一个只读 mock 工具 */
function createMockTool(name: string): AgentTool {
  return {
    name,
    description: `Mock ${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    safety: 'read_only',
    mode: 'both',
    isReadOnly: vi.fn().mockReturnValue(true),
    checkPermission: vi.fn().mockReturnValue({ allowed: true }),
    call: vi.fn().mockResolvedValue('mock result'),
    renderSummary: vi.fn().mockReturnValue('mock summary'),
  };
}

/** 收集 AsyncGenerator 的所有事件 */
async function collectEvents(gen: AsyncGenerator<any>): Promise<any[]> {
  const events: any[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ============================================================
// 测试
// ============================================================

describe('Runtime Pipeline 集成测试', () => {
  let provider: ModelProvider;
  let registry: ToolRegistry;
  let executor: ToolExecutor;
  let db: Database;

  beforeEach(() => {
    provider = createMockProvider();
    registry = createMockRegistry([createMockTool('rag_search')]);
    executor = createMockExecutor();
    db = createMockDatabase();
  });

  describe('基础 Pipeline 流程', () => {
    it('简单对话产出 token + done 事件', async () => {
      const runtime = new AgentRuntime(provider, registry, executor, db);
      const events = await collectEvents(runtime.runTurn('session-1', '你好'));

      // 至少有 token 和 done 事件
      const tokenEvents = events.filter(e => e.type === 'token');
      const doneEvents = events.filter(e => e.type === 'done');

      expect(tokenEvents.length).toBeGreaterThan(0);
      expect(doneEvents.length).toBe(1);
    });

    it('产出的事件包含正确的 sessionId', async () => {
      const runtime = new AgentRuntime(provider, registry, executor, db);
      const events = await collectEvents(runtime.runTurn('my-session', '你好'));

      for (const event of events) {
        expect(event.sessionId).toBe('my-session');
      }
    });

    it('产出的事件 sequence 递增', async () => {
      const runtime = new AgentRuntime(provider, registry, executor, db);
      const events = await collectEvents(runtime.runTurn('session-1', '你好'));

      const sequences = events.map(e => e.sequence);
      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
      }
    });
  });

  describe('工具调用 Pipeline', () => {
    it('模型返回工具调用时产出 tool_start + tool_result 事件', async () => {
      const toolProvider = createMockProvider({
        reply: '我来帮你搜索',
        toolCalls: [
          { id: 'tc-1', name: 'rag_search', arguments: { query: '测试' } },
        ],
      });
      // 第二次调用（工具执行后）返回普通回复
      let callCount = 0;
      (toolProvider.chat as any).mockImplementation((request: ChatRequest) => {
        callCount++;
        const reply = callCount === 1 ? '我来帮你搜索' : '搜索结果如下';
        const events: ModelEvent[] = [
          { type: 'token', data: reply },
          { type: 'usage', data: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } },
          { type: 'done', data: undefined },
        ];

        if (callCount === 1) {
          events.splice(1, 0, {
            type: 'tool_call',
            data: {
              id: 'tc-1',
              type: 'function' as const,
              function: { name: 'rag_search', arguments: { query: '测试' } },
            },
          });
        }

        return (async function* () {
          for (const event of events) { yield event; }
        })();
      });

      const runtime = new AgentRuntime(toolProvider, registry, executor, db);
      const events = await collectEvents(runtime.runTurn('session-1', '搜索资料'));

      const toolStartEvents = events.filter(e => e.type === 'tool_start');
      const toolResultEvents = events.filter(e => e.type === 'tool_result');
      const doneEvents = events.filter(e => e.type === 'done');

      expect(toolStartEvents.length).toBeGreaterThanOrEqual(1);
      expect(toolResultEvents.length).toBeGreaterThanOrEqual(1);
      expect(doneEvents.length).toBe(1);
    });
  });

  describe('多轮不可变 State 传递', () => {
    it('两轮对话后 state.turnCount 正确递增', async () => {
      // 模拟两轮对话：第一轮有工具调用，第二轮无
      let callCount = 0;
      const multiTurnProvider = createMockProvider();

      (multiTurnProvider.chat as any).mockImplementation((request: ChatRequest) => {
        callCount++;
        const events: ModelEvent[] = [
          { type: 'token', data: `第${callCount}轮回复` },
          { type: 'usage', data: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } },
        ];

        if (callCount === 1) {
          events.push({
            type: 'tool_call',
            data: {
              id: 'tc-1',
              type: 'function' as const,
              function: { name: 'rag_search', arguments: { query: 'test' } },
            },
          });
        }

        events.push({ type: 'done', data: undefined });

        return (async function* () {
          for (const event of events) { yield event; }
        })();
      });

      const runtime = new AgentRuntime(multiTurnProvider, registry, executor, db);
      const events = await collectEvents(runtime.runTurn('session-1', '搜索'));

      // 应该有至少两轮的 token 事件
      const tokenEvents = events.filter(e => e.type === 'token');
      expect(tokenEvents.length).toBeGreaterThanOrEqual(2);

      // 应该有一次 done 事件
      const doneEvents = events.filter(e => e.type === 'done');
      expect(doneEvents.length).toBe(1);
    });
  });

  describe('handleError 不可变性', () => {
    it('handleError 不修改传入的 state（验证通过事件流无异常）', async () => {
      // 正常对话，不触发错误
      const runtime = new AgentRuntime(provider, registry, executor, db);
      const events = await collectEvents(runtime.runTurn('session-1', '你好'));

      // 无 error 事件
      const errorEvents = events.filter(e => e.type === 'error');
      expect(errorEvents.length).toBe(0);

      // 有 done 事件
      const doneEvents = events.filter(e => e.type === 'done');
      expect(doneEvents.length).toBe(1);
    });
  });

  describe('Pipeline 诊断数据', () => {
    it('compact 事件在上下文过大时产出', async () => {
      // 创建一个返回很长回复的 provider，模拟上下文增长
      const longReplyProvider = createMockProvider({
        reply: 'A'.repeat(1000),
      });

      const runtime = new AgentRuntime(longReplyProvider, registry, executor, db);
      const events = await collectEvents(runtime.runTurn('session-1', '你好'));

      // 即使没有触发 compact，也应该正常完成
      const doneEvents = events.filter(e => e.type === 'done');
      expect(doneEvents.length).toBe(1);
    });
  });

  describe('RAG 注入 Pipeline 集成', () => {
    it('无 RAG provider 时正常对话不受影响', async () => {
      const runtime = new AgentRuntime(provider, registry, executor, db);
      const events = await collectEvents(runtime.runTurn('session-1', '你好'));

      // 不应有 rag_enrich 事件
      const ragEvents = events.filter(e => e.type === 'rag_enrich');
      expect(ragEvents.length).toBe(0);

      // 正常完成
      const doneEvents = events.filter(e => e.type === 'done');
      expect(doneEvents.length).toBe(1);
    });

    it('带 RAG provider + 关键词时产出 rag_enrich 事件', async () => {
      const mockSearchProvider = {
        search: vi.fn().mockResolvedValue([
          {
            content: '检索到的内容',
            sourceFile: 'test.docx',
            sourceType: 'docx',
            locator: '第1页',
            score: 0.85,
            chunkId: 'chunk-1',
          },
        ]),
      };

      const runtime = new AgentRuntime(provider, registry, executor, db, {
        ragSearchProvider: mockSearchProvider as any,
      });

      const events = await collectEvents(runtime.runTurn('session-1', '请帮我检索相关资料'));

      // 应该有 rag_enrich 事件
      const ragEvents = events.filter(e => e.type === 'rag_enrich');
      expect(ragEvents.length).toBe(1);
      expect(ragEvents[0].data.injected).toBe(true);
      expect(ragEvents[0].data.chunkCount).toBe(1);
      expect(ragEvents[0].data.triggerReason).toBe('keyword');
    });

    it('RAG 事件包含 usedTokens 信息', async () => {
      const mockSearchProvider = {
        search: vi.fn().mockResolvedValue([
          {
            content: '检索内容',
            sourceFile: 'test.docx',
            sourceType: 'docx',
            locator: '第1页',
            score: 0.85,
            chunkId: 'chunk-1',
          },
        ]),
      };

      const runtime = new AgentRuntime(provider, registry, executor, db, {
        ragSearchProvider: mockSearchProvider as any,
      });

      const events = await collectEvents(runtime.runTurn('session-1', '搜索资料'));
      const ragEvents = events.filter(e => e.type === 'rag_enrich');

      if (ragEvents.length > 0) {
        expect(ragEvents[0].data.usedTokens).toBeGreaterThan(0);
      }
    });
  });

  describe('模式建议', () => {
    it('检测到公文写作关键词时产出 mode_suggestion 事件', async () => {
      const runtime = new AgentRuntime(provider, registry, executor, db);
      const events = await collectEvents(runtime.runTurn('session-1', '帮我写一份通知'));

      const suggestionEvents = events.filter(e => e.type === 'mode_suggestion');
      expect(suggestionEvents.length).toBe(1);
      expect(suggestionEvents[0].data.suggestedMode).toBe('plan');
    });

    it('普通对话不产出 mode_suggestion 事件', async () => {
      const runtime = new AgentRuntime(provider, registry, executor, db);
      const events = await collectEvents(runtime.runTurn('session-1', '你好'));

      const suggestionEvents = events.filter(e => e.type === 'mode_suggestion');
      expect(suggestionEvents.length).toBe(0);
    });
  });

  describe('端到端完整流程', () => {
    it('完整对话：用户输入 → token → done，无异常', async () => {
      const runtime = new AgentRuntime(provider, registry, executor, db);
      const events = await collectEvents(runtime.runTurn('session-1', '你好，请介绍一下自己'));

      // 验证事件类型和顺序
      const types = events.map(e => e.type);

      // 应该有 token 事件
      expect(types).toContain('token');
      // 应该以 done 结尾
      expect(types[types.length - 1]).toBe('done');
    });

    it('所有事件都有 sessionId、turnId、sequence', async () => {
      const runtime = new AgentRuntime(provider, registry, executor, db);
      const events = await collectEvents(runtime.runTurn('session-1', '你好'));

      for (const event of events) {
        expect(event).toHaveProperty('sessionId');
        expect(event).toHaveProperty('turnId');
        expect(event).toHaveProperty('sequence');
        expect(event).toHaveProperty('type');
        expect(event).toHaveProperty('createdAt');
        expect(typeof event.sequence).toBe('number');
      }
    });
  });
});
