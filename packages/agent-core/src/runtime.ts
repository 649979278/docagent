/**
 * AgentRuntime - Agent运行时核心，参考Claude Code query.ts的agentic loop模式
 * Per-Iteration Pipeline (对齐 Claude Code):
 *   1. getMessagesAfterCompactBoundary
 *   2. applyToolResultBudget
 *   3. microcompactMessages
 *   4. contextCollapse
 *   5. autoCompactIfNeeded
 *   6. token blocking limit check
 *   7. callModel (stream)
 *   8. parseToolCalls
 *   9. executeTools
 *  10. persistTurn
 *  11. checkTokenBudget
 *  12. buildNextState (不可变更新)
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
  RunTerminalReason,
  AgentEventEnvelope,
  AgentEventType,
  AgentEventDataMap,
  PlanOutline,
} from '@workagent/shared';
import {
  ContextLengthExceededError,
  ToolExecutionError,
  getRecoveryStrategy,
  isContextOverflowError,
  DEFAULT_CONTEXT_LENGTH,
  MAX_TOOL_RESULT_TOKENS,
} from '@workagent/shared';
import type { ModelProvider, ChatMessage, ToolCallResult, ModelEvent } from '@workagent/model-provider';
import type { Database, MessageRecord, PlanRecord } from '@workagent/store';
import { createMessage, createMessagesBatch, getRecentMessages, createAgentRun, createAgentEvent, endAgentRun, getSession, getPlan } from '@workagent/store';
import type { ToolRegistry, ToolExecutor, AgentTool } from '@workagent/tools';
import { toToolDefinition } from '@workagent/tools';
import type { RAGSearchProvider } from '@workagent/tools';
import type { RuntimeContext } from './state.js';
import { createRuntimeContext } from './state.js';
import type { QueryLoopState } from './query-state.js';
import { createQueryLoopState, updateQueryLoopState } from './query-state.js';
import { routeAfterQueryLoop, shouldSuggestPlanMode } from './router.js';
import { BudgetManager, allocateBudget, estimateTokens } from './context/budget.js';
import { compactContext, reactiveCompact, assessCompactNeed, autoCompactIfNeeded } from './context/compact.js';
import { recoverFromCompact } from './context/compact-recovery.js';
import { drainCollapse } from './context/drain-collapse.js';
import { microCompact } from './context/microCompact.js';
import {
  getMessagesAfterCompactBoundary,
  applyToolResultBudget,
  contextCollapse,
  checkTokenBudget,
  estimateMessagesTokens,
} from './context/pipeline.js';
import { injectRagContext } from './context/rag-inject.js';
import { MemoryManager } from './context/memory.js';
import { PlanModeController } from './plan-controller.js';
import { buildFullSystemPrompt, buildSystemPromptLayers, mergeSystemPromptLayers } from './context/system-prompt.js';
import { DiagnosticsCollector } from './diagnostics.js';
import { SessionMemoryLite } from './context/session-memory.js';
import { TranscriptStore } from './context/transcript.js';
import { SessionMemoryPersist } from './context/session-memory-persist.js';

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
  /** transcript JSONL 目录。 */
  transcriptDir?: string;
  /** session summary Markdown 目录。 */
  sessionMemoryDir?: string;
}

/** 默认运行时配置 */
const DEFAULT_RUNTIME_CONFIG: Required<Pick<RuntimeConfig, 'maxTurns' | 'maxRetries'>> & { ragSearchProvider: RAGSearchProvider | undefined } = {
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
  private config: Required<Pick<RuntimeConfig, 'maxTurns' | 'maxRetries'>> & {
    ragSearchProvider?: RAGSearchProvider;
    transcriptDir?: string;
    sessionMemoryDir?: string;
  };
  /** 转录持久化器。 */
  private transcriptStore: TranscriptStore | null;
  /** 会话摘要持久化器。 */
  private sessionMemoryPersist: SessionMemoryPersist | null;
  /** 轻量会话摘要器。 */
  private sessionMemoryBySession: Map<string, SessionMemoryLite>;
  /** 会话级摘要累计状态。 */
  private sessionSummaryTotals: Map<string, { turns: number; tokens: number }>;

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
    this.transcriptStore = config.transcriptDir ? new TranscriptStore(config.transcriptDir) : null;
    this.sessionMemoryPersist = config.sessionMemoryDir ? new SessionMemoryPersist(config.sessionMemoryDir) : null;
    this.sessionMemoryBySession = new Map();
    this.sessionSummaryTotals = new Map();
  }

  /**
   * 获取计划控制器
   * @returns 计划控制器实例
   */
  getPlanController(): PlanModeController {
    return this.planController;
  }

  /**
   * 中断当前运行。
   * 当前版本通过状态标记让外层桥接与迭代器退出保持一致。
   */
  abortCurrentRun(): void {
    this.planController.cancelPlan();
  }

  /**
   * 运行一个Agent轮次 - 核心agentic loop
   * 使用 QueryLoopState 不可变状态 + Per-Iteration Pipeline
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
    const turnId = `turn_${Date.now()}`;
    let sequence = 0;

    // 初始化诊断收集器
    const diagnostics = new DiagnosticsCollector();
    diagnostics.recordSection('init');

    // 加载上下文
    const memories = this.memoryManager.loadMemories();
    const recentMessages = getRecentMessages(this.db, sessionId, 50);
    const modelConfig = this.provider.getConfig();
    const contextLength = await this.provider.getContextLength() ?? DEFAULT_CONTEXT_LENGTH;

    // 使用 BudgetManager 动态分配预算
    const budgetManager = new BudgetManager(contextLength, mode);
    const budget = budgetManager.getBudget();

    // 初始化不可变查询循环状态
    const runId = `run_${Date.now()}`;
    this.restorePlanFromStore(sessionId);
    let state = createQueryLoopState(sessionId, mode, budget, memories, input, runId);
    state = updateQueryLoopState(state, {
      activePlan: this.planController.getActivePlan(),
      planPhase: this.planController.getPhase(),
    });

    const planUnsub = this.planController.onEvent((event) => {
      if (event.type === 'plan_generated') {
        state = updateQueryLoopState(state, {
          activePlan: event.plan,
          planPhase: 'PLAN_COLLECT',
          diagnostics: {
            ...state.diagnostics,
            planTransition: 'PLAN_COLLECT',
          },
        });
      } else if (event.type === 'phase_change') {
        state = updateQueryLoopState(state, {
          planPhase: event.to,
          diagnostics: {
            ...state.diagnostics,
            planTransition: `${event.from}->${event.to}`,
          },
        });
      } else if (event.type === 'plan_approved') {
        state = updateQueryLoopState(state, {
          activePlan: event.plan,
        });
      } else if (event.type === 'plan_cancelled') {
        state = updateQueryLoopState(state, {
          activePlan: null,
        });
      }
    });

    try {
      // 创建 Agent Run 记录
      try {
        createAgentRun(this.db, { id: runId, sessionId, mode });
      } catch {
        // 创建 run 记录失败不影响主流程
      }

      yield this.createEvent(state, turnId, sequence++, 'run_status', {
        runId,
        status: 'running',
      });

      // 构建运行时上下文（兼容旧逻辑）
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
      const existingMessageIds = new Set(recentMessages.map(m => m.id));
      state = updateQueryLoopState(state, {
        messages: this.buildMessages(recentMessages, input, mode, memories, budget, sessionId),
      });

      // RAG 预算感知注入（pipeline 内部，计入 budget）
      const ragResult = await injectRagContext(
        input,
        mode,
        this.planController.getPhase(),
        this.config.ragSearchProvider,
        budget,
      );

      if (ragResult.message) {
        // 将 RAG 消息插入到用户消息之前
        const msgs = [...state.messages];
        let lastUserIdx = -1;
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'user') { lastUserIdx = i; break; }
        }
        if (lastUserIdx >= 0) {
          msgs.splice(lastUserIdx, 0, ragResult.message);
        } else {
          msgs.splice(msgs.length - 1, 0, ragResult.message);
        }

        // RAG token 从 conversationHistory 预算中扣除（对齐二期计划3.2）
        const adjustedBudget: ContextBudget = {
          ...budget,
          conversationHistory: Math.max(0, budget.conversationHistory - ragResult.usedTokens),
        };

        state = updateQueryLoopState(state, {
          messages: msgs,
          budget: adjustedBudget,
          ragChunks: ragResult.injectedChunks,
          diagnostics: {
            ...state.diagnostics,
            ragHitCount: ragResult.injectedChunks.length,
            ragInjectedTokens: ragResult.usedTokens,
            ragTokens: ragResult.usedTokens,
          },
        });

        yield this.createEvent(sessionId, turnId, sequence++, 'rag_enrich', {
          query: input.slice(0, 100),
          injected: true,
          chunkCount: ragResult.injectedChunks.length,
          usedTokens: ragResult.usedTokens,
          triggerReason: ragResult.triggerReason,
        });
      }

      // Agentic loop — 不可变状态重建
      let loopCount = 0;

      while (
        state.transition !== 'completed' &&
        state.transition !== 'aborted' &&
        state.transition !== 'max_turns' &&
        state.transition !== 'prompt_too_long' &&
        state.transition !== 'model_error' &&
        loopCount < this.config.maxTurns
      ) {
        loopCount++;

        // 检测 approved plan 并启动执行
        if (state.activePlan?.status === 'approved' && state.mode === 'execute') {
          this.planController.startExecution();
          state = updateQueryLoopState(state, {
            activePlan: this.planController.getActivePlan(),
            planPhase: this.planController.getPhase(),
          });
        }

        // 每轮重置动态字段
        state = updateQueryLoopState(state, {
          assistantContent: '',
          hasToolCalls: false,
          hasError: false,
          retried: false,
        });

        // ---- Per-Iteration Pipeline ----

        // 1. 获取 compact boundary 之后的消息
        const messagesAfterBoundary = getMessagesAfterCompactBoundary(state);

        // 2. 应用工具结果预算
        const budgetedMessages = applyToolResultBudget(messagesAfterBoundary, state.budget);

        // 3. 微压缩（清理过时 tool_result）
        const microResult = microCompact(budgetedMessages);

        // 4. 上下文折叠（合并连续 assistant 消息）
        const collapsedMessages = contextCollapse(microResult.messages);

        // 5. 自动压缩评估（带 circuit breaker，对齐 Claude Code autoCompact）
        const autoCompactResult = await autoCompactIfNeeded(
          collapsedMessages,
          this.provider,
          memories,
          state.budget,
          state.autoCompactTracking,
          state.activePlan,
        );

        if (autoCompactResult.didCompact) {
          state = updateQueryLoopState(state, {
            messages: autoCompactResult.messages,
            compactCount: state.compactCount + 1,
            autoCompactTracking: autoCompactResult.tracking,
          });

          // 记录诊断（不可变更新）
          diagnostics.recordCompact(true, autoCompactResult.freedTokens);

          yield this.createEvent(sessionId, turnId, sequence++, 'compact', {
            level: 2,
            strategy: 'summary',
            freedTokens: autoCompactResult.freedTokens,
          });

          // 5.5 Post-Compact Recovery（对齐 Claude Code）
          const recoveryResult = await recoverFromCompact(state, this.config.ragSearchProvider ?? null);
          if (recoveryResult.memoryInjected || recoveryResult.ragRehydrated || recoveryResult.planInjected) {
            state = recoveryResult.state;
            yield this.createEvent(sessionId, turnId, sequence++, 'recovery', {
              memoryInjected: recoveryResult.memoryInjected,
              ragRehydrated: recoveryResult.ragRehydrated,
              planInjected: recoveryResult.planInjected,
              totalRecoveryTokens: recoveryResult.totalRecoveryTokens,
            });
          }
        } else {
          // 即使没有自动压缩，也需要更新 tracking（circuit breaker 状态可能变化）
          state = updateQueryLoopState(state, {
            autoCompactTracking: autoCompactResult.tracking,
          });
        }

        // 6. Token 阻塞限制检查
        const estimatedTokens = estimateMessagesTokens(state.messages);
        if (estimatedTokens > state.budget.total * 0.95) {
          state = updateQueryLoopState(state, { transition: 'prompt_too_long' });
          break;
        }

        // 7. 选择可用工具
        const availableTools = this.planController.getToolsForPhase(this.registry);
        const toolDefinitions = availableTools.map(toToolDefinition);

        // 8. 调用模型（流式）
        let assistantContent = '';
        let toolCallResults: ToolCallResult[] = [];
        let usageData = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

        try {
          const chatMessages = this.toChatMessages(state.messages);
          const stream = this.provider.chat({
            messages: chatMessages,
            tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
            temperature: modelConfig.temperature,
            maxTokens: state.budget.maxCompletionTokens,
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
              const errorResult = await this.handleError(new Error(event.data), state);
              if (errorResult.retried) {
                if (errorResult.newState) state = errorResult.newState;
                continue;
              }
              yield this.createEvent(sessionId, turnId, sequence++, 'error', {
                code: 'MODEL_ERROR',
                message: event.data,
                recoverable: false,
              });
              state = updateQueryLoopState(state, { transition: 'model_error' });
              break;
            }
          }
        } catch (error) {
          const errorResult = await this.handleError(error, state);

          if (errorResult.retried) {
            if (errorResult.newState) state = errorResult.newState;
            continue;
          }

          yield this.createEvent(sessionId, turnId, sequence++, 'error', {
            code: error instanceof ContextLengthExceededError ? 'CONTEXT_LENGTH_EXCEEDED' : 'MODEL_ERROR',
            message: error instanceof Error ? error.message : String(error),
            recoverable: error instanceof ContextLengthExceededError,
          });

          if (!isContextOverflowError(error)) {
            state = updateQueryLoopState(state, { transition: 'model_error' });
            break;
          }
        }

        // 9. 解析工具调用
        const toolCalls = this.parseToolCalls(toolCallResults);

        // 10. 添加assistant消息
        const assistantMessage: Message = {
          id: this.generateMsgId(),
          role: 'assistant',
          content: assistantContent,
          eventType: toolCalls.length > 0 ? 'tool_call' : 'text',
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          tokenCount: estimateTokens(assistantContent),
          timestamp: Date.now(),
        };
        state = updateQueryLoopState(state, {
          messages: [...state.messages, assistantMessage],
          assistantContent,
          hasToolCalls: toolCalls.length > 0,
          totalTokensUsed: state.totalTokensUsed + usageData.totalTokens,
        });

        // 记录诊断（不可变更新）
        state = updateQueryLoopState(state, {
          diagnostics: {
            ...state.diagnostics,
            hadToolCall: toolCalls.length > 0,
            completionTokens: usageData.completionTokens,
          },
        });

        // 11. 执行工具（串行）
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

          // 追踪工具执行是否有错误
          let anyError = false;
          const newMessages = [...state.messages];

          for (const result of results) {
            if (result.isError) anyError = true;

            const toolMessage: Message = {
              id: this.generateMsgId(),
              role: 'tool',
              content: typeof result.output === 'string'
                ? result.output
                : JSON.stringify(result.output),
              eventType: 'tool_result',
              toolCallId: result.call.id,
              toolName: result.call.name,
              tokenCount: estimateTokens(
                typeof result.output === 'string' ? result.output : JSON.stringify(result.output),
              ),
              timestamp: Date.now(),
            };
            newMessages.push(toolMessage);

            yield this.createEvent(sessionId, turnId, sequence++, 'tool_result', {
              name: result.call.name,
              output: result.output,
              isError: result.isError,
              summary: result.summary,
            });
          }

          state = updateQueryLoopState(state, {
            messages: newMessages,
            hasError: anyError,
            retried: anyError && !state.retried ? true : state.retried,
          });
        }

        // 12. 路由决策（直接使用 QueryLoopState）
        const routeResult = routeAfterQueryLoop(
          state,
          this.planController.getActivePlan(),
        );

        // 产出 mode_suggestion 事件
        if (state.mode === 'chat' && !state.hasToolCalls && state.userInput) {
          if (shouldSuggestPlanMode(state.userInput)) {
            yield this.createEvent(sessionId, turnId, sequence++, 'mode_suggestion', {
              suggestedMode: 'plan',
              reason: '检测到公文写作需求，建议进入计划模式',
            });
          }
        }

        // 产出模式/阶段变更事件
        if (routeResult.modeSwitch) {
          state = updateQueryLoopState(state, {
            mode: routeResult.modeSwitch,
          });
          yield this.createEvent(sessionId, turnId, sequence++, 'mode_change', {
            mode: routeResult.modeSwitch,
          });
        }
        if (routeResult.phaseSwitch) {
          state = updateQueryLoopState(state, {
            planPhase: routeResult.phaseSwitch,
          });
          yield this.createEvent(sessionId, turnId, sequence++, 'phase_change', {
            phase: routeResult.phaseSwitch,
          });
        }

        // 13. 持久化当前轮次
        this.persistMessages(sessionId, turnId, state.messages, existingMessageIds);

        await this.persistSessionMemoryIfNeeded(state);

        // 14. Token 预算检查（收益递减检测）
        const budgetCheck = checkTokenBudget(state, usageData.completionTokens);
        if (budgetCheck.shouldStop) {
          state = updateQueryLoopState(state, {
            transition: 'completed',
            diagnostics: { ...state.diagnostics, terminalReason: 'completed' },
          });
          break;
        }

        // 15. 不可变更新 — 进入下一轮
        state = updateQueryLoopState(state, {
          turnCount: state.turnCount + 1,
          transition: routeResult.decision === 'Done' ? 'completed' :
                      routeResult.decision === 'WaitApproval' ? 'completed' :
                      routeResult.transition,
        });

        // 判断是否继续
        if (routeResult.decision === 'Done') {
          state = updateQueryLoopState(state, {
            diagnostics: { ...state.diagnostics, terminalReason: 'completed' },
          });
          break;
        } else if (routeResult.decision === 'WaitApproval') {
          yield this.createEvent(sessionId, turnId, sequence++, 'permission_request', {
            toolName: 'plan_approve',
            input: { planId: this.planController.getActivePlan()?.id ?? '' },
            safety: 'read_only',
            reason: '计划已生成，等待用户审查和批准',
          });
          state = updateQueryLoopState(state, {
            diagnostics: { ...state.diagnostics, terminalReason: 'completed' },
          });
          break;
        } else if (routeResult.decision === 'EnterPlan') {
          if (routeResult.modeSwitch === 'plan') {
            this.planController.enterPlanMode(sessionId);
            const activePlan = this.planController.getActivePlan();
            state = updateQueryLoopState(state, {
              activePlan,
              mode: 'plan',
            });
          }
          // 继续循环
        }
      }

      // 循环退出后处理：max_turns 检测（对齐 Claude Code 的 max_turns 终止）
      if (loopCount >= this.config.maxTurns && state.transition !== 'completed' && state.transition !== 'prompt_too_long' && state.transition !== 'model_error') {
        state = updateQueryLoopState(state, {
          transition: 'max_turns',
          diagnostics: { ...state.diagnostics, terminalReason: 'max_turns' },
        });
      }

      // 持久化诊断数据到 DB
      diagnostics.recordTerminal(
        (state.diagnostics.terminalReason as RunTerminalReason) ?? 'completed',
      );
      diagnostics.persist(this.db, runId);
      await this.persistSessionMemoryIfNeeded(state);

      // 结束 Agent Run 记录
      try {
        const terminalReason = state.diagnostics.terminalReason ?? 'completed';
        const status = terminalReason === 'aborted_streaming' || terminalReason === 'aborted_tools'
          ? 'aborted'
          : terminalReason === 'completed'
          ? 'completed'
          : 'failed';
        endAgentRun(this.db, runId, status, terminalReason, state.totalTokensUsed);
      } catch {
        // 结束 run 记录失败不影响主流程
      }

      yield this.createEvent(state, turnId, sequence++, 'run_status', {
        runId,
        status: state.diagnostics.terminalReason === 'aborted_streaming' || state.diagnostics.terminalReason === 'aborted_tools'
          ? 'aborted'
          : state.diagnostics.terminalReason === 'completed'
          ? 'completed'
          : 'failed',
        terminalReason: state.diagnostics.terminalReason ?? 'completed',
      });

      // 产出完成事件
      yield this.createEvent(state, turnId, sequence++, 'done', null);
    } finally {
      planUnsub();
    }
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
    sessionId?: string,
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

    if (sessionId && this.sessionMemoryPersist) {
      const persistedSummary = this.sessionMemoryPersist.load(sessionId);
      if (persistedSummary) {
        messages.push({
          id: `session-summary-${sessionId}`,
          role: 'system',
          content: persistedSummary,
          eventType: 'summary',
          tokenCount: estimateTokens(persistedSummary),
          timestamp: Date.now(),
        });
      }
    }

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
   * 构建系统提示（分层版本 — 对齐 Claude Code 的 static + dynamic prompt 模式）
   * 5 段：role / mode / safety / toolContract / outputContract
   * @param mode - Agent模式
   * @param memories - 显式记忆
   * @returns 系统提示文本
   */
  private buildSystemPrompt(mode: AgentMode, memories: Memory[]): string {
    return buildFullSystemPrompt(mode, memories);
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
   * 不可变：返回新的 state，不修改原状态
   * 恢复路径（对齐 Claude Code）：
   * 1. 上下文超限 → reactive compact → 重试
   * 2. reactive compact 后仍超限 → drain collapse → 重试
   * 3. max_output_tokens → 注入恢复消息 → 重试（最多3次）
   * 4. 瞬态错误（网络超时/模型临时不可用） → withheld retry（最多2次）
   * 5. 其他错误 → 不重试
   * @param error - 错误对象
   * @param state - 当前查询循环状态
   * @returns 错误处理结果（包含可能的新状态）
   */
  private async handleError(
    error: unknown,
    state: QueryLoopState,
  ): Promise<{ retried: boolean; errorMessage?: string; newState?: QueryLoopState }> {
    // 1. 上下文超限：触发reactive压缩后重试
    if (isContextOverflowError(error)) {
      // 已尝试过 reactive compact 但仍超限 → drain collapse
      if (state.hasAttemptedReactiveCompact && !state.hasAttemptedDrainCollapse) {
        const drainResult = drainCollapse(state.messages, state.memories, state.activePlan);
        const newState = updateQueryLoopState(state, {
          messages: drainResult.messages,
          compactCount: state.compactCount + 1,
          hasAttemptedDrainCollapse: true,
          diagnostics: {
            ...state.diagnostics,
            compactOccurred: true,
            compactFreedTokens: (state.diagnostics.compactFreedTokens ?? 0) + drainResult.freedTokens,
          },
        });
        return { retried: true, newState };
      }

      // 首次超限：reactive compact
      if (!state.hasAttemptedReactiveCompact) {
        const compactResult = await reactiveCompact(state.messages, this.provider, state.memories, state.activePlan);
        const newState = updateQueryLoopState(state, {
          messages: compactResult.messages,
          compactCount: state.compactCount + 1,
          hasAttemptedReactiveCompact: true,
          diagnostics: {
            ...state.diagnostics,
            compactOccurred: true,
            compactFreedTokens: compactResult.freedTokens,
          },
        });
        return { retried: true, newState };
      }

      // reactive + drain 都已尝试，仍然超限 → graceful stop
      return { retried: false, errorMessage: '上下文空间耗尽，无法继续。请开启新对话。' };
    }

    // 2. max_output_tokens 恢复（对齐 Claude Code 的 token escalation）
    // 检测方式：错误消息包含 max_output_tokens 或 completion_tokens 超限
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isMaxOutputTokensError =
      errorMsg.toLowerCase().includes('max_output_tokens') ||
      errorMsg.toLowerCase().includes('max output tokens') ||
      errorMsg.toLowerCase().includes('completion tokens exceeded');

    if (isMaxOutputTokensError && state.maxOutputTokensRecoveryCount < 3) {
      // 注入恢复用户消息，让模型知道需要继续
      const recoveryMessage: Message = {
        id: this.generateMsgId(),
        role: 'user',
        content: '请继续完成你的回复。',
        tokenCount: estimateTokens('请继续完成你的回复。'),
        timestamp: Date.now(),
      };
      const newState = updateQueryLoopState(state, {
        messages: [...state.messages, recoveryMessage],
        maxOutputTokensRecoveryCount: state.maxOutputTokensRecoveryCount + 1,
      });
      return { retried: true, newState };
    }

    // 3. 瞬态错误重试（withheld retry）— 网络超时、模型临时不可用
    if (this.isTransientError(error) && state.withheldRetryCount < 2) {
      const newState = updateQueryLoopState(state, {
        withheldRetryCount: state.withheldRetryCount + 1,
      });
      return { retried: true, newState };
    }

    // 4. AgentError：使用类型化恢复策略
    if (error instanceof Error && 'code' in error) {
      const agentError = error as unknown as { code: string; recoverable: boolean; message: string };
      const strategy = getRecoveryStrategy(agentError as any);

      if (strategy.action === 'abort') {
        return { retried: false, errorMessage: agentError.message };
      }
    }

    // 5. 通用错误：不重试
    return {
      retried: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  /**
   * 判断是否为瞬态错误（可重试）。
   * 包括：网络超时、连接重置、模型临时不可用等。
   * @param error - 错误对象。
   * @returns 是否为瞬态错误。
   */
  private isTransientError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('fetch failed') ||
      msg.includes('network') ||
      msg.includes('temporarily unavailable') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests')
    );
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
   * 创建事件信封（包含 runId）
   * @param sessionId - 会话ID
   * @param turnId - 轮次ID
   * @param sequence - 序号
   * @param type - 事件类型
   * @param data - 事件数据
   * @returns 事件信封
   */
  private createEvent<T extends AgentEventType>(
    state: QueryLoopState | string,
    turnId: string,
    sequence: number,
    type: T,
    data: AgentEventDataMap[T],
  ): AgentEventEnvelope<AgentEventDataMap[T]> {
    const sessionId = typeof state === 'string' ? state : state.sessionId;
    const runId = typeof state === 'string' ? undefined : state.runId;
    const envelope: AgentEventEnvelope<AgentEventDataMap[T]> = {
      sessionId,
      turnId,
      sequence,
      type,
      data,
      createdAt: Date.now(),
      source: 'runtime',
      runId,
    };

    if (runId) {
      try {
        createAgentEvent(this.db, {
          runId,
          sequence,
          type,
          data: JSON.stringify(data ?? null),
          toolName: type === 'tool_result' || type === 'tool_start'
            ? (data as { name?: string })?.name
            : undefined,
          isError: type === 'error' || type === 'recoverable_error',
        });
      } catch {
        // 事件持久化失败不影响主流程
      }
    }

    if (runId && this.transcriptStore) {
      try {
        this.transcriptStore.append(runId, envelope);
      } catch {
        // transcript 落盘失败不影响主流程
      }
    }

    return envelope;
  }

  /**
   * 按阈值持久化会话摘要。
   * @param state - 当前查询状态。
   */
  private async persistSessionMemoryIfNeeded(state: QueryLoopState): Promise<void> {
    if (!this.sessionMemoryPersist) {
      return;
    }

    const current = this.sessionSummaryTotals.get(state.sessionId) ?? { turns: 0, tokens: 0 };
    const nextTotals = {
      turns: current.turns + Math.max(1, state.turnCount),
      tokens: current.tokens + state.totalTokensUsed,
    };
    this.sessionSummaryTotals.set(state.sessionId, nextTotals);

    const memory = this.getSessionMemory(state.sessionId);
    if (!memory.shouldSummarize(nextTotals.turns, nextTotals.tokens)) {
      return;
    }

    const summary = await memory.summarize(state.messages, this.provider);
    if (!summary) {
      return;
    }

    memory.updateBaseline(nextTotals.turns, nextTotals.tokens);
    this.sessionMemoryPersist.save(state.sessionId, summary);
  }

  /**
   * 获取会话级摘要器。
   * @param sessionId - 会话 ID。
   * @returns 会话摘要器实例。
   */
  private getSessionMemory(sessionId: string): SessionMemoryLite {
    const existing = this.sessionMemoryBySession.get(sessionId);
    if (existing) {
      return existing;
    }

    const created = new SessionMemoryLite();
    this.sessionMemoryBySession.set(sessionId, created);
    return created;
  }

  /**
   * 从数据库恢复当前会话的活跃计划到计划控制器。
   * @param sessionId - 会话 ID。
   */
  private restorePlanFromStore(sessionId: string): void {
    const session = getSession(this.db, sessionId);
    if (!session?.activePlanId) {
      return;
    }
    const current = this.planController.getActivePlan();
    if (current?.id === session.activePlanId) {
      return;
    }
    const record = getPlan(this.db, session.activePlanId);
    if (!record) {
      return;
    }

    this.planController.restorePlan(planRecordToPlan(record));
  }

}

/**
 * 将数据库计划记录转换为运行时计划快照。
 * @param record - 计划记录。
 * @returns 运行时计划。
 */
function planRecordToPlan(record: PlanRecord): Plan {
  return {
    id: record.id,
    sessionId: record.sessionId,
    status: record.status,
    title: record.title,
    goal: record.goal ?? '',
    outline: parsePlanOutline(record),
    approvedAt: record.approvedAt ?? undefined,
    finalDocPath: record.finalDocPath ?? undefined,
    createdAt: record.createdAt,
  };
}

/**
 * 解析计划记录中的提纲 JSON。
 * @param record - 计划记录。
 * @returns 计划提纲。
 */
function parsePlanOutline(record: PlanRecord): PlanOutline {
  try {
    return JSON.parse(record.outlineJson) as PlanOutline;
  } catch {
    return {
      title: record.title,
      goal: record.goal ?? '',
      materialBasis: '',
      structure: [],
      expectedOutput: '',
      risks: [],
      questions: [],
      citations: [],
    };
  }
}
