/**
 * AgentRuntime - Agent运行时核心，参考Claude Code query.ts的agentic loop模式
 * 循环：compact → enrich → selectTools → allocateBudget → callModel(stream) → parseToolCalls → executeTools(串行) → persistTurn → continue/done
 * 工具失败一次fallback，不无限重试
 * 类型化错误处理（handleError → recovery strategy）
 */

import type {
  AgentMode,
  Plan,
  Message,
  MessageRole,
  MessageEventType,
  ToolCall as SharedToolCall,
  ConversationContext,
  AgentState,
  ContextBudget,
  Memory,
  RetrievedChunk,
} from '@workagent/shared';
import {
  ContextLengthExceededError,
  ToolExecutionError,
  getRecoveryStrategy,
  isContextOverflowError,
  DEFAULT_CONTEXT_LENGTH,
  MAX_TOOL_RESULT_TOKENS,
} from '@workagent/shared';
import type { AgentEventEnvelope, AgentEventType, AgentEventDataMap } from '@workagent/shared';
import type { ModelProvider, ChatMessage, ToolCallResult, ModelEvent } from '@workagent/model-provider';
import type { Database, MessageRecord } from '@workagent/store';
import { createMessage, createMessagesBatch, getRecentMessages } from '@workagent/store';
import type { ToolRegistry, ToolExecutor, AgentTool } from '@workagent/tools';
import { toToolDefinition } from '@workagent/tools';
import type { RAGSearchProvider } from '@workagent/tools';
import type { LoopState, TurnState, RuntimeContext } from './state.js';
import { createLoopState, createTurnState, createRuntimeContext } from './state.js';
import { routeAfterResponse } from './router.js';
import { allocateBudget, estimateTokens } from './context/budget.js';
import { compactContext, reactiveCompact, assessCompactNeed } from './context/compact.js';
import { MemoryManager } from './context/memory.js';
import { PlanModeController } from './plan-controller.js';

// ============================================================
// 运行时配置
// ============================================================

/** Agent运行时配置 */
export interface RuntimeConfig {
  /** 最大循环轮次（防止无限循环） */
  maxTurns?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** RAG搜索引擎（可选，设置后支持自动上下文增强） */
  ragSearchProvider?: RAGSearchProvider;
}

/** 默认运行时配置 */
const DEFAULT_RUNTIME_CONFIG: Required<Omit<RuntimeConfig, 'ragSearchProvider'>> & { ragSearchProvider: RAGSearchProvider | undefined } = {
  maxTurns: 20,
  maxRetries: 1,
  ragSearchProvider: undefined,
};

// ============================================================
// AgentRuntime
// ============================================================

/**
 * Agent运行时 - 驱动Agent循环的核心引擎
 * 实现agentic loop模式：
 * compact → enrich → selectTools → allocateBudget → callModel(stream)
 * → parseToolCalls → executeTools(串行) → persistTurn → continue/done
 */
export class AgentRuntime {
  /** 模型提供者 */
  private provider: ModelProvider;
  /** 工具注册中心 */
  private registry: ToolRegistry;
  /** 工具执行器 */
  private executor: ToolExecutor;
  /** 数据库实例 */
  private db: Database;
  /** 记忆管理器 */
  private memoryManager: MemoryManager;
  /** 计划控制器 */
  private planController: PlanModeController;
  /** 运行时配置 */
  private config: Required<Omit<RuntimeConfig, 'ragSearchProvider'>> & { ragSearchProvider?: RAGSearchProvider };

  /** RAG自动检索触发关键词 */
  private static readonly RAG_TRIGGER_KEYWORDS = [
    '参考', '检索', '搜索', '查找', '知识库', '资料', '素材',
    '查询', '寻找', '文库', '文档库', '相关内容', '相关文档',
    '参考文档', '参考文献', '参考资料', '查找资料',
  ];

  /**
   * 创建Agent运行时
   * @param provider - 模型提供者
   * @param registry - 工具注册中心
   * @param executor - 工具执行器
   * @param db - 数据库实例
   * @param config - 运行时配置
   */
  constructor(
    provider: ModelProvider,
    registry: ToolRegistry,
    executor: ToolExecutor,
    db: Database,
    config: RuntimeConfig = {},
  ) {
    this.provider = provider;
    this.registry = registry;
    this.executor = executor;
    this.db = db;
    this.memoryManager = new MemoryManager(db);
    this.planController = new PlanModeController();
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...config };
  }

  /**
   * 获取计划控制器
   * @returns 计划控制器实例
   */
  getPlanController(): PlanModeController {
    return this.planController;
  }

  /**
   * 运行一个Agent轮次 - 核心agentic loop
   * @param sessionId - 会话ID
   * @param input - 用户输入
   * @param mode - Agent模式
   * @returns 异步生成器，逐个产出事件
   */
  async *runTurn(
    sessionId: string,
    input: string,
    mode: AgentMode = 'chat',
  ): AsyncGenerator<AgentEventEnvelope> {
    // 初始化循环状态
    const loopState = createLoopState(sessionId, mode);
    const turnId = `turn_${Date.now()}`;
    let sequence = 0;

    // 加载上下文
    const memories = this.memoryManager.loadMemories();
    const recentMessages = getRecentMessages(this.db, sessionId, 50);
    const modelConfig = this.provider.getConfig();
    const contextLength = await this.provider.getContextLength() ?? DEFAULT_CONTEXT_LENGTH;

    // 分配上下文预算
    const budget = allocateBudget(contextLength, mode);

    // 构建运行时上下文
    const runtimeCtx = createRuntimeContext({
      sessionId,
      mode,
      planPhase: this.planController.getPhase(),
      activePlanId: null,
      knowledgeBaseIds: [],
      activeFiles: [],
      permissions: {},
    });

    // 构建消息列表
    // 记录已有消息的ID集合，用于后续持久化时排除
    const existingMessageIds = new Set(recentMessages.map(m => m.id));
    const messages = this.buildMessages(recentMessages, input, mode, memories, budget);

    // RAG自动上下文增强：当用户输入包含检索触发关键词时，自动从知识库检索相关内容
    const ragContext = await this.enrichWithRAG(input, sessionId);
    if (ragContext) {
      // 在用户消息之前插入RAG检索结果作为上下文
      const ragMessage: Message = {
        id: this.generateMsgId(),
        role: 'system',
        content: ragContext,
        tokenCount: estimateTokens(ragContext),
        timestamp: Date.now(),
      };
      // 插入到用户消息之前（messages最后一条是用户消息）
      messages.splice(messages.length - 1, 0, ragMessage);

      yield this.createEvent(sessionId, turnId, sequence++, 'rag_enrich', {
        query: input.slice(0, 100),
        injected: true,
      });
    }

    // Agentic loop
    let loopCount = 0;
    let continueLoop = true;

    while (continueLoop && loopCount < this.config.maxTurns) {
      loopCount++;

      // 1. 评估并执行压缩
      const compactAssessment = assessCompactNeed(messages, budget);
      if (compactAssessment.needed) {
        const compactResult = await compactContext(messages, this.provider, memories, budget);
        messages.length = 0;
        messages.push(...compactResult.messages);

        yield this.createEvent(sessionId, turnId, sequence++, 'compact', {
          level: compactResult.level,
          strategy: compactResult.strategy,
          freedTokens: compactResult.freedTokens,
        });
      }

      // 2. 选择可用工具
      const availableTools = this.planController.getToolsForPhase(this.registry);
      const toolDefinitions = availableTools.map(toToolDefinition);

      // 3. 调用模型（流式）
      let assistantContent = '';
      let toolCallResults: ToolCallResult[] = [];
      let usageData = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      try {
        const chatMessages = this.toChatMessages(messages);
        const stream = this.provider.chat({
          messages: chatMessages,
          tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
          temperature: modelConfig.temperature,
          maxTokens: budget.maxCompletionTokens,
          stream: true,
        });

        for await (const event of stream) {
          if (event.type === 'token') {
            assistantContent += event.data;
            yield this.createEvent(sessionId, turnId, sequence++, 'token', { text: event.data });
          } else if (event.type === 'thinking') {
            yield this.createEvent(sessionId, turnId, sequence++, 'thinking', { text: event.data });
          } else if (event.type === 'tool_call') {
            toolCallResults.push(event.data);
          } else if (event.type === 'usage') {
            usageData = event.data;
          } else if (event.type === 'done') {
            break;
          } else if (event.type === 'error') {
            const errorResult = await this.handleError(
              new Error(event.data),
              messages,
              runtimeCtx,
              memories,
              budget,
            );
            if (errorResult.retried) {
              continue;
            }
            yield this.createEvent(sessionId, turnId, sequence++, 'error', {
              code: 'MODEL_ERROR',
              message: event.data,
              recoverable: false,
            });
            continueLoop = false;
            break;
          }
        }
      } catch (error) {
        const errorResult = await this.handleError(
          error,
          messages,
          runtimeCtx,
          memories,
          budget,
        );

        if (errorResult.retried) {
          continue;
        }

        yield this.createEvent(sessionId, turnId, sequence++, 'error', {
          code: error instanceof ContextLengthExceededError ? 'CONTEXT_LENGTH_EXCEEDED' : 'MODEL_ERROR',
          message: error instanceof Error ? error.message : String(error),
          recoverable: error instanceof ContextLengthExceededError,
        });

        if (!isContextOverflowError(error)) {
          continueLoop = false;
          break;
        }
      }

      // 4. 解析工具调用
      const toolCalls = this.parseToolCalls(toolCallResults);

      // 5. 添加assistant消息
      const assistantMessage: Message = {
        id: this.generateMsgId(),
        role: 'assistant',
        content: assistantContent,
        eventType: toolCalls.length > 0 ? 'tool_call' : 'text',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        tokenCount: estimateTokens(assistantContent),
        timestamp: Date.now(),
      };
      messages.push(assistantMessage);

      // 6. 执行工具（串行）
      if (toolCalls.length > 0) {
        const toolContext = {
          sessionId,
          mode,
          permissions: runtimeCtx.permissions,
        };

        // 产出 tool_start 事件
        for (const tc of toolCalls) {
          yield this.createEvent(sessionId, turnId, sequence++, 'tool_start', {
            name: tc.name,
            input: tc.arguments,
          });
        }

        // 串行执行
        const results = await this.executor.executeAll(toolCalls, toolContext);

        // 处理结果
        for (const result of results) {
          const toolMessage: Message = {
            id: this.generateMsgId(),
            role: 'tool',
            content: typeof result.output === 'string'
              ? result.output
              : JSON.stringify(result.output),
            eventType: 'tool_result',
            toolCallId: result.call.id,
            toolName: result.call.name, // Ollama需要tool角色消息包含工具名称
            tokenCount: estimateTokens(
              typeof result.output === 'string' ? result.output : JSON.stringify(result.output),
            ),
            timestamp: Date.now(),
          };
          messages.push(toolMessage);

          yield this.createEvent(sessionId, turnId, sequence++, 'tool_result', {
            name: result.call.name,
            output: result.output,
            isError: result.isError,
            summary: result.summary,
          });
        }
      }

      // 7. 路由决策
      const routeResult = routeAfterResponse(
        loopState,
        toolCalls.length > 0,
        this.planController.getActivePlan(),
      );

      // 更新循环状态
      loopState.currentTurn = createTurnState(turnId, input);
      loopState.currentTurn.assistantContent = assistantContent;
      loopState.currentTurn.toolCalls = toolCalls;
      loopState.currentTurn.tokensUsed = usageData.totalTokens;
      loopState.decision = routeResult.decision;

      // 产出模式/阶段变更事件
      if (routeResult.modeSwitch) {
        yield this.createEvent(sessionId, turnId, sequence++, 'mode_change', {
          mode: routeResult.modeSwitch,
        });
      }
      if (routeResult.phaseSwitch) {
        yield this.createEvent(sessionId, turnId, sequence++, 'phase_change', {
          phase: routeResult.phaseSwitch,
        });
      }

      // 8. 持久化当前轮次
      this.persistMessages(sessionId, turnId, messages, existingMessageIds);

      // 9. 判断是否继续
      if (routeResult.decision === 'Done') {
        continueLoop = false;
      } else if (routeResult.decision === 'WaitApproval') {
        // 等待用户批准，暂停循环
        yield this.createEvent(sessionId, turnId, sequence++, 'permission_request', {
          toolName: 'plan_approve',
          input: { planId: this.planController.getActivePlan()?.id ?? '' },
          safety: 'read_only',
          reason: '计划已生成，等待用户审查和批准',
        });
        continueLoop = false;
      } else if (routeResult.decision === 'EnterPlan') {
        if (routeResult.modeSwitch === 'plan') {
          this.planController.enterPlanMode(sessionId);
        }
        // 继续循环
      }
    }

    // 产出完成事件
    yield this.createEvent(sessionId, turnId, sequence++, 'done', null);
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /**
   * 构建发送给模型的消息列表
   * @param recentMessages - 最近的持久化消息
   * @param userInput - 用户输入
   * @param mode - Agent模式
   * @param memories - 显式记忆
   * @param budget - 上下文预算
   * @returns 构建后的消息列表
   */
  private buildMessages(
    recentMessages: MessageRecord[],
    userInput: string,
    mode: AgentMode,
    memories: Memory[],
    budget: ContextBudget,
  ): Message[] {
    const messages: Message[] = [];

    // 系统提示
    const systemPrompt = this.buildSystemPrompt(mode, memories);
    messages.push({
      id: 'system',
      role: 'system',
      content: systemPrompt,
      tokenCount: estimateTokens(systemPrompt),
      timestamp: Date.now(),
    });

    // 历史消息（按预算截断）——将MessageRecord转换为Message
    const historyBudget = budget.conversationHistory;
    let historyTokens = 0;
    for (const record of recentMessages) {
      const msg: Message = {
        id: record.id,
        role: record.role,
        content: record.content,
        eventType: record.eventType ?? undefined,
        toolCalls: record.toolCalls ?? undefined,
        toolCallId: record.toolCallId ?? undefined,
        toolName: record.toolName ?? undefined,
        tokenCount: record.tokenCount,
        compactBoundaryId: record.compactBoundaryId ?? undefined,
        timestamp: record.createdAt,
      };
      if (historyTokens + msg.tokenCount > historyBudget) break;
      messages.push(msg);
      historyTokens += msg.tokenCount;
    }

    // 用户输入
    messages.push({
      id: this.generateMsgId(),
      role: 'user',
      content: userInput,
      tokenCount: estimateTokens(userInput),
      timestamp: Date.now(),
    });

    return messages;
  }

  /**
   * 构建系统提示
   * @param mode - Agent模式
   * @param memories - 显式记忆
   * @returns 系统提示文本
   */
  private buildSystemPrompt(mode: AgentMode, memories: Memory[]): string {
    const parts: string[] = [];

    // 基础角色定义
    parts.push(`你是WorkAgent，一个专业的公文写作助手。你可以帮助用户撰写、编辑和生成各类公文。

## 工具使用指南

你必须按照以下流程正确使用工具：

### 1. 文档读取流程
当用户提到"参考文档"、"参考文件"、"资料目录"等，需要读取文档内容时：
- **直接使用 doc_read 工具**：它可以接受文件路径或目录路径。传入目录路径时会自动扫描其中所有支持的文档文件（docx/pptx/pdf/txt/md）并批量读取。
- 也可以先用 file_list 列出目录内容，再选择性地用 doc_read 读取特定文件。

### 2. 知识库与RAG检索流程
当用户需要基于已有知识库内容写作或查询时：
- **知识入库**：如果文档尚未加入知识库，先使用 knowledge_add 将文件路径列表添加到知识库建立索引。
- **检索知识**：使用 rag_search 从知识库中检索与查询相关的文档片段，获取带来源引用的文本内容。

### 3. 公文写作流程
当用户需要撰写公文时：
- **收集素材**：先读取参考文档（doc_read）或检索知识库（rag_search），获取相关素材。
- **生成提纲**：使用 draft_outline 生成公文大纲。
- **撰写文档**：使用 doc_write 生成最终文档文件。

### 重要提示
- 始终优先读取用户提供的参考文档内容，不要凭空编造素材。
- 当用户提供目录路径时，直接用 doc_read 传入目录路径即可批量读取。
- 知识库检索（rag_search）仅在文档已通过 knowledge_add 入库后才能检索到内容。
- 如果用户没有明确要求检索知识库，但提到了参考文档，应先读取文档内容，而非直接写作。`);

    // 模式说明
    if (mode === 'plan') {
      parts.push('当前处于计划模式。你需要先收集信息、制定计划，生成提纲后等待用户确认。不能自行执行写文件等操作。');
    } else if (mode === 'execute') {
      parts.push('当前处于执行模式。按照已批准的计划执行步骤，生成公文草稿和最终文档。');
    } else {
      parts.push('当前处于对话模式。你可以回答问题、检索知识库、读取文档等。涉及复杂公文写作时，建议进入计划模式。');
    }

    // 注入记忆
    const memoryPrompt = this.memoryManager.formatMemoriesForPrompt(memories);
    if (memoryPrompt) {
      parts.push(memoryPrompt);
    }

    return parts.join('\n\n');
  }

  /**
   * 将内部消息格式转换为模型ChatMessage格式
   * @param messages - 内部消息列表
   * @returns 模型ChatMessage列表
   */
  private toChatMessages(messages: Message[]): ChatMessage[] {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      // Ollama要求arguments是对象而非JSON字符串
      toolCalls: msg.toolCalls?.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          // 传递原始对象，由Provider层负责格式化
          arguments: tc.arguments as Record<string, unknown>,
        },
      })),
      toolCallId: msg.toolCallId ?? undefined,
      toolName: msg.toolName ?? undefined,
    }));
  }

  /**
   * 解析模型返回的工具调用
   * @param toolCallResults - 模型返回的工具调用结果
   * @returns 解析后的工具调用列表
   */
  private parseToolCalls(toolCallResults: ToolCallResult[]): SharedToolCall[] {
    return toolCallResults.map((tcr) => {
      // arguments可能是对象（Ollama直接返回）或字符串（OpenAI兼容格式）
      let args: Record<string, unknown> = {};
      const rawArgs = tcr.function.arguments;
      if (typeof rawArgs === 'string') {
        try {
          args = JSON.parse(rawArgs);
        } catch {
          args = { raw: rawArgs };
        }
      } else if (typeof rawArgs === 'object' && rawArgs !== null) {
        args = rawArgs;
      }
      return {
        id: tcr.id,
        name: tcr.function.name,
        arguments: args,
      };
    });
  }

  /**
   * 错误处理 - 根据错误类型决定恢复策略
   * @param error - 错误对象
   * @param messages - 当前消息列表
   * @param context - 运行时上下文
   * @param memories - 显式记忆
   * @param budget - 上下文预算
   * @returns 错误处理结果
   */
  private async handleError(
    error: unknown,
    messages: Message[],
    context: RuntimeContext,
    memories: Memory[],
    budget: ContextBudget,
  ): Promise<{ retried: boolean; errorMessage?: string }> {
    // 上下文超限：触发reactive压缩后重试
    if (isContextOverflowError(error)) {
      const compactResult = await reactiveCompact(messages, this.provider, memories);
      messages.length = 0;
      messages.push(...compactResult.messages);
      return { retried: true };
    }

    // AgentError：使用类型化恢复策略
    if (error instanceof Error && 'code' in error) {
      const agentError = error as unknown as { code: string; recoverable: boolean; message: string };
      const strategy = getRecoveryStrategy(agentError as any);

      if (strategy.action === 'abort') {
        return { retried: false, errorMessage: agentError.message };
      }
    }

    // 通用错误：不重试
    return {
      retried: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  /** 消息ID计数器，确保同毫秒内ID唯一 */
  private msgIdCounter = 0;

  /**
   * 生成唯一消息ID
   * 格式: msg_{timestamp}_{counter}
   * @returns 唯一消息ID
   */
  private generateMsgId(): string {
    return `msg_${Date.now()}_${++this.msgIdCounter}`;
  }

  /**
   * 持久化消息到数据库
   * 只持久化本轮新增的消息（排除从DB加载的历史消息和系统消息）
   * @param sessionId - 会话ID
   * @param turnId - 轮次ID
   * @param messages - 当前消息列表
   * @param existingMessageIds - 已存在于数据库的消息ID集合
   */
  private persistMessages(sessionId: string, turnId: string, messages: Message[], existingMessageIds: Set<string>): void {
    // 排除系统消息(id='system')和已存在于数据库的历史消息
    const newMessages = messages.filter((msg) => msg.id !== 'system' && !existingMessageIds.has(msg.id));
    if (newMessages.length === 0) return;

    // 使用消息在完整列表中的绝对位置作为sequence，保证排序正确
    const msgIndexMap = new Map(messages.map((msg, idx) => [msg.id, idx]));

    const params = newMessages.map((msg) => ({
      id: msg.id,
      sessionId,
      turnId,
      sequence: msgIndexMap.get(msg.id) ?? 0,
      role: msg.role,
      content: msg.content,
      eventType: msg.eventType,
      toolCalls: msg.toolCalls,
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      tokenCount: msg.tokenCount,
      compactBoundaryId: msg.compactBoundaryId,
    }));

    createMessagesBatch(this.db, params);

    // 将新持久化的消息ID加入集合，防止循环中重复持久化
    for (const msg of newMessages) {
      existingMessageIds.add(msg.id);
    }
  }

  /**
   * 创建事件信封
   * @param sessionId - 会话ID
   * @param turnId - 轮次ID
   * @param sequence - 序号
   * @param type - 事件类型
   * @param data - 事件数据
   * @returns 事件信封
   */
  private createEvent<T extends AgentEventType>(
    sessionId: string,
    turnId: string,
    sequence: number,
    type: T,
    data: AgentEventDataMap[T],
  ): AgentEventEnvelope<AgentEventDataMap[T]> {
    return {
      sessionId,
      turnId,
      sequence,
      type,
      data,
      createdAt: Date.now(),
    };
  }

  /**
   * RAG自动上下文增强 - 当用户输入包含检索触发关键词时，自动从知识库检索相关内容
   * @param userInput - 用户输入文本
   * @param sessionId - 会话ID
   * @returns RAG增强的上下文文本，如果不需要增强则返回null
   */
  private async enrichWithRAG(userInput: string, _sessionId: string): Promise<string | null> {
    // 检查是否配置了RAG搜索引擎
    if (!this.config.ragSearchProvider) {
      return null;
    }

    // 检查用户输入是否包含RAG触发关键词
    if (!this.shouldTriggerRAG(userInput)) {
      return null;
    }

    try {
      // 使用用户输入作为查询，从知识库检索相关内容
      const chunks = await this.config.ragSearchProvider.search(userInput, {
        topK: 3,
        minScore: 0.3,
      });

      if (chunks.length === 0) {
        return null;
      }

      // 格式化检索结果作为上下文
      const contextParts = chunks.map((chunk, i) => {
        const source = chunk.sourceFile || '未知来源';
        return `[${i + 1}] 来源: ${source}${chunk.locator ? ` (${chunk.locator})` : ''}\n${chunk.content}`;
      });

      return `以下是知识库中与用户查询相关的内容，请在回答时参考这些素材：\n\n${contextParts.join('\n\n')}`;
    } catch {
      // RAG检索失败时不影响正常对话流程
      return null;
    }
  }

  /**
   * 判断用户输入是否应触发RAG自动检索
   * @param userInput - 用户输入文本
   * @returns 是否应触发RAG检索
   */
  private shouldTriggerRAG(userInput: string): boolean {
    const lowerInput = userInput.toLowerCase();
    return AgentRuntime.RAG_TRIGGER_KEYWORDS.some(keyword => lowerInput.includes(keyword));
  }
}
