/**
 * Agent Worker 线程入口。
 * Worker 只负责隔离执行与消息转发，运行时装配必须和主进程 direct 模式共用 runtime-factory。
 */

import { parentPort } from 'node:worker_threads';
import type { AgentEventEnvelope, AgentMode } from '@workagent/shared';
import type { OpenAICompatConfig } from '@workagent/model-provider';
import { closeDatabase, initDatabase, type Database } from '@workagent/store';
import type { AgentRuntime } from '@workagent/agent-core';
import { createDesktopRuntimeBundle, type DesktopRuntimeBundle, type PermissionApprovalPolicy } from '../runtime-factory.js';

/** Worker 初始化参数。 */
interface AgentWorkerInitOptions {
  /** 数据库路径。 */
  dbPath?: string;
  /** OpenAI 兼容模型配置。 */
  openAICompatConfig?: OpenAICompatConfig | null;
  /** 工具权限审批策略。 */
  permissionPolicy?: PermissionApprovalPolicy;
}

/** Worker接收的消息类型 */
type AgentWorkerMessage =
  | { type: 'init'; options?: AgentWorkerInitOptions }
  | { type: 'chat'; message: string; sessionId: string; mode?: AgentMode }
  | { type: 'abort' }
  | { type: 'plan-approve'; planId: string; sessionId: string; approved: boolean; updatedOutlineJson?: string }
  | { type: 'plan-cancel' }
  | { type: 'dispose' };

/** Worker发送的消息类型 */
type AgentWorkerResponse =
  | { type: 'ready' }
  | { type: 'event'; event: AgentEventEnvelope }
  | { type: 'chat-result'; success: boolean; error?: string }
  | { type: 'error'; message: string };

/** AgentWorker运行时状态 */
let db: Database | null = null;
let runtime: AgentRuntime | null = null;
let bundle: DesktopRuntimeBundle | null = null;
let currentIterator: AsyncGenerator<AgentEventEnvelope> | null = null;
/** 当前对话的会话 ID，abort 事件需要携带 */
let currentSessionId: string | null = null;
/** 当前对话的运行 ID，abort 事件需要携带 */
let currentRunId: string | null = null;
/** 当前对话的运行模式。 */
let currentMode: AgentMode | null = null;

/**
 * 初始化 Agent 运行时。
 * @param options - 初始化参数。
 */
async function initialize(options?: AgentWorkerInitOptions): Promise<void> {
  try {
    db = initDatabase({
      dbPath: options?.dbPath,
      log: (msg: string) => send({
        type: 'event',
        event: {
          sessionId: '',
          turnId: '',
          sequence: 0,
          type: 'error',
          data: { code: 'LOG', message: msg, recoverable: true },
          createdAt: Date.now(),
          source: 'worker',
        },
      }),
    });

    bundle = await createDesktopRuntimeBundle({
      db,
      permissionPolicy: options?.permissionPolicy ?? 'ask_dangerous',
      getOpenAICompatConfig: () => options?.openAICompatConfig ?? null,
      emitEvent: (event) => send({ type: 'event', event: { ...event, source: 'worker' } }),
    });
    runtime = bundle.runtime;

    send({ type: 'ready' });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 处理对话请求。
 * @param message - 用户消息。
 * @param sessionId - 会话 ID。
 * @param mode - 运行模式。
 */
async function handleChat(message: string, sessionId: string, mode?: AgentMode): Promise<void> {
  if (!runtime) {
    send({ type: 'chat-result', success: false, error: 'AgentRuntime未初始化' });
    return;
  }

  // 保存当前对话上下文，abort 事件需要携带
  currentSessionId = sessionId;
  currentRunId = null;
  currentMode = mode ?? 'chat';

  try {
    const effectiveMode = mode ?? 'chat';
    const iterator = runtime.runTurn(sessionId, message, effectiveMode);
    currentIterator = iterator;

    for await (const event of iterator) {
      if (event.type === 'run_status') {
        const data = event.data as { runId?: string };
        if (data.runId) {
          currentRunId = data.runId;
        }
      }
      send({ type: 'event', event: { ...event, source: 'worker' } });
    }

    currentIterator = null;
    send({ type: 'chat-result', success: true });
  } catch (error) {
    currentIterator = null;
    send({ type: 'chat-result', success: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    currentSessionId = null;
    currentRunId = null;
    currentMode = null;
  }
}

/**
 * 中断当前对话。
 * 终止迭代器前先发送 run_status:aborted 事件，确保 Renderer 收到中止状态。
 */
function handleAbort(): void {
  if (currentIterator) {
    // 发送 aborted 事件（主进程 direct 模式由 runtime 自己发，Worker 模式需手动补充）
    send({
      type: 'event',
      event: {
        sessionId: currentSessionId ?? '',
        turnId: '',
        sequence: Date.now(),
        type: 'run_status',
        data: {
          runId: currentRunId ?? '',
          status: 'aborted',
          terminalReason: 'aborted_streaming',
        },
        createdAt: Date.now(),
        source: 'worker' as const,
      },
    });

    currentIterator.return?.(undefined);
    currentIterator = null;
  }
}

/**
 * 批准或拒绝计划。
 * @param sessionId - 会话 ID。
 * @param approved - 是否批准。
 */
function handlePlanApprove(planId: string, sessionId: string, approved: boolean, updatedOutlineJson?: string): void {
  if (!bundle) return;
  bundle.planService.approve({ planId, sessionId, approved, updatedOutlineJson });
}

/**
 * 取消计划。
 */
function handlePlanCancel(): void {
  runtime?.getPlanController().cancelPlan();
}

/**
 * 清理资源。
 */
function dispose(): void {
  handleAbort();
  runtime = null;
  bundle = null;
  if (db) {
    closeDatabase(db);
    db = null;
  }
}

/**
 * 发送消息到主线程。
 * @param response - Worker 响应。
 */
function send(response: AgentWorkerResponse): void {
  parentPort?.postMessage(response);
}

parentPort?.on('message', async (msg: AgentWorkerMessage) => {
  switch (msg.type) {
    case 'init':
      await initialize(msg.options);
      break;
    case 'chat':
      await handleChat(msg.message, msg.sessionId, msg.mode);
      break;
    case 'abort':
      handleAbort();
      break;
    case 'plan-approve':
      handlePlanApprove(msg.planId, msg.sessionId, msg.approved, msg.updatedOutlineJson);
      break;
    case 'plan-cancel':
      handlePlanCancel();
      break;
    case 'dispose':
      dispose();
      break;
  }
});
