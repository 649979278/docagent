/**
 * 聊天和计划相关 IPC 处理器。
 * 负责 chat、chat-abort、plan-mode、plan-approve 四个 IPC 通道。
 */

import { ipcMain } from 'electron';
import type { IpcHandlerContext } from './context.js';
import type { AgentMode, AgentEventEnvelope } from '@workagent/shared';
import { getSession, createSession, updateSession } from '@workagent/store';
import type { AgentWorkerBridge } from '../worker-bridge.js';
import type { SessionOrchestrator } from '@workagent/agent-core';

/**
 * 聊天 IPC 运行时状态。
 * 独立于 IpcHandlers 类，由 chat-ipc 内部维护。
 */
export interface ChatRuntimeState {
  /** 当前运行 ID。 */
  currentRunId: string | null;
  /** 当前运行模式。 */
  currentRunMode: AgentMode | null;
  /** 当前活跃会话 ID。 */
  activeChatSessionId: string | null;
  /** 当前正在执行的 runtime 迭代器。 */
  currentIterator: AsyncGenerator<AgentEventEnvelope> | null;
  /** 已发出 terminal 事件的 runId 集合。 */
  terminalRunIds: Set<string>;
  /** Worker 桥接层。 */
  workerBridge: AgentWorkerBridge | null;
  /** 是否使用 Worker 模式。 */
  useWorkerMode: boolean;
  /** 会话编排器。 */
  orchestrator: SessionOrchestrator | null;
}

/**
 * 注册聊天和计划相关 IPC 处理器。
 * @param ctx - IPC 共享上下文。
 * @param state - 聊天运行时状态（由调用方创建，引用传递）。
 * @returns state 对象，调用方可通过此引用访问/修改运行时状态。
 */
export function registerChatIpc(
  ctx: IpcHandlerContext,
  state: ChatRuntimeState,
): void {
  // 对话
  ipcMain.handle('chat', async (_ev, message: string, sessionId: string, mode?: string) => {
    return handleChat(ctx, state, message, sessionId, mode as AgentMode);
  });

  // 中断当前对话
  ipcMain.handle('chat-abort', async () => {
    return handleAbort(ctx, state);
  });

  // Plan 模式切换
  ipcMain.handle('plan-mode', async (_ev, enabled: boolean, sessionId: string) => {
    const bundle = await ctx.ensureRuntime();
    const result = bundle.planService.setPlanMode(sessionId, enabled);
    if (state.orchestrator) {
      state.orchestrator.updateMode(sessionId, result.mode);
    }
    return result;
  });

  // Plan 审批
  ipcMain.handle('plan-approve', async (_ev, planId: string, approved: boolean, sessionId: string, updatedOutlineJson?: string) => {
    if (state.useWorkerMode && state.workerBridge?.isAvailable()) {
      state.workerBridge.planApprove(planId, approved, sessionId, updatedOutlineJson);
    }
    const bundle = await ctx.ensureRuntime();
    const result = bundle.planService.approve({ planId, approved, sessionId, updatedOutlineJson });
    if (state.orchestrator) {
      state.orchestrator.updateMode(sessionId, approved ? 'execute' : 'chat');
    }
    return result;
  });
}

/**
 * 处理对话请求。
 * 优先通过 Worker Bridge，降级到主进程直接执行。
 */
async function handleChat(
  ctx: IpcHandlerContext,
  state: ChatRuntimeState,
  message: string,
  sessionId: string,
  mode?: AgentMode,
): Promise<{ success: boolean; runId?: string; accepted?: boolean }> {
  const db = await ctx.ensureDb();

  // 确保会话存在
  let session = getSession(db, sessionId);
  if (!session) {
    session = createSession(db, { id: sessionId, title: message.slice(0, 30) });
  }
  const resolvedMode = session.mode === 'execute'
    ? 'execute'
    : mode ?? session.mode ?? 'chat';
  // 无论新建还是已有，都确保 orchestrator 加载了该会话
  state.orchestrator?.load(sessionId);

  // 尝试通过 Worker Bridge 执行
  if (state.useWorkerMode && state.workerBridge?.isAvailable()) {
    return handleChatViaWorker(ctx, state, message, sessionId, resolvedMode);
  }

  // 降级：主进程直接执行
  return handleChatDirectly(ctx, state, message, sessionId, resolvedMode);
}

/**
 * 通过 Worker Bridge 执行对话。
 */
async function handleChatViaWorker(
  ctx: IpcHandlerContext,
  state: ChatRuntimeState,
  message: string,
  sessionId: string,
  mode?: AgentMode,
): Promise<{ success: boolean; runId?: string; accepted?: boolean }> {
  state.activeChatSessionId = sessionId;
  state.currentRunMode = mode ?? 'chat';

  // 设置事件回调：Worker 事件推送到 Renderer（带 thinking 节流）
  const thinkingState = createThinkingThrottle(ctx, state, sessionId);
  state.workerBridge!.setEventCallback((event) => {
    if (state.activeChatSessionId !== sessionId) return;

    if (event.type === 'thinking') {
      const data = event.data as { text: string };
      thinkingState.buffer += data.text ?? '';
      if (!thinkingState.timer) {
        thinkingState.timer = setTimeout(thinkingState.flush, thinkingState.interval);
      }
    } else {
      if (event.type === 'run_status') {
        const data = event.data as { runId?: string };
        if (data.runId) {
          state.currentRunId = data.runId;
        }
      }
      thinkingState.clear();
      thinkingState.flush();
      ctx.sendAgentEvent(event);
    }
  });

  try {
    const result = await state.workerBridge!.chat(message, sessionId, mode);
    thinkingState.clear();
    thinkingState.flush();
    state.activeChatSessionId = null;
    state.currentRunMode = null;

    return {
      success: result.success,
      runId: state.currentRunId ?? undefined,
      accepted: true,
    };
  } catch (error) {
    thinkingState.clear();
    state.activeChatSessionId = null;
    state.currentRunMode = null;
    return { success: false, runId: state.currentRunId ?? undefined, accepted: true };
  }
}

/**
 * 主进程直接执行对话（降级模式）。
 */
async function handleChatDirectly(
  ctx: IpcHandlerContext,
  state: ChatRuntimeState,
  message: string,
  sessionId: string,
  mode?: AgentMode,
): Promise<{ success: boolean; runId?: string; accepted?: boolean }> {
  const bundle = await ctx.ensureRuntime();

  try {
    const effectiveMode = mode ?? 'chat';
    state.currentRunMode = effectiveMode;
    const iterator = bundle.runtime.runTurn(sessionId, message, effectiveMode);
    state.currentIterator = iterator;
    state.activeChatSessionId = sessionId;

    // thinking 事件节流
    const thinkingState = createThinkingThrottle(ctx, state, sessionId);

    for await (const event of iterator) {
      // 如果用户已切换到其他会话，停止发送事件但仍让 runtime 完成持久化
      if (state.activeChatSessionId !== sessionId) {
        iterator.return?.(undefined);
        break;
      }

      if (event.type === 'thinking') {
        const data = event.data as { text: string };
        thinkingState.buffer += data.text ?? '';
        if (!thinkingState.timer) {
          thinkingState.timer = setTimeout(thinkingState.flush, thinkingState.interval);
        }
      } else {
        thinkingState.clear();
        thinkingState.flush();
        if (event.type === 'run_status') {
          const data = event.data as { runId?: string };
          if (data.runId) {
            state.currentRunId = data.runId;
          }
        }
        ctx.sendAgentEvent(event);
      }
      if (event.type === 'done') {
        break;
      }
    }

    thinkingState.clear();
    thinkingState.flush();

    state.currentIterator = null;
    state.activeChatSessionId = null;
    state.currentRunMode = null;
    return { success: true, runId: state.currentRunId ?? undefined, accepted: true };
  } catch (error) {
    state.currentIterator = null;
    state.activeChatSessionId = null;
    state.currentRunMode = null;
    ctx.sendAgentEvent({
      sessionId,
      turnId: `turn_${Date.now()}`,
      sequence: ctx.nextEventSeq(),
      type: 'error',
      data: {
        code: 'AGENT_ERROR',
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      },
      createdAt: Date.now(),
    });
    return { success: false, runId: state.currentRunId ?? undefined, accepted: true };
  }
}

/**
 * 中断当前对话。
 * 支持 Worker 模式和主进程直接执行模式。
 */
async function handleAbort(
  ctx: IpcHandlerContext,
  state: ChatRuntimeState,
): Promise<{ success: boolean }> {
  const runId = state.currentRunId;
  // 防止重复 terminal 事件：同一 runId 只能 abort 一次
  if (!runId || state.terminalRunIds.has(runId)) {
    return { success: false };
  }
  state.terminalRunIds.add(runId);

  const sessionId = state.activeChatSessionId ?? '';
  // Worker 模式：通过 Bridge 发送 abort（Worker 自身会发 run_status:aborted）
  if (state.useWorkerMode && state.workerBridge?.isAvailable()) {
    state.workerBridge.abort();
  }

  // 主进程直接执行模式：终止迭代器
  if (state.currentIterator) {
    state.currentIterator.return?.(undefined);
    state.currentIterator = null;

    // 主进程模式需要手动发 aborted 事件
    ctx.sendAgentEvent({
      sessionId,
      turnId: '',
      sequence: ctx.nextEventSeq(),
      type: 'run_status',
      data: {
        runId,
        status: 'aborted',
        terminalReason: 'aborted',
      },
      createdAt: Date.now(),
    });
  }

  // 发送 done 确保前端状态重置
  ctx.sendAgentEvent({
    sessionId,
    turnId: '',
    sequence: ctx.nextEventSeq(),
    type: 'done',
    data: null,
    createdAt: Date.now(),
  });
  state.activeChatSessionId = null;
  state.currentRunMode = null;

  // 清理过期的 terminalRunIds 防止内存泄漏
  if (state.terminalRunIds.size > 100) {
    state.terminalRunIds.clear();
  }

  return { success: true };
}

/**
 * 创建 thinking 事件节流器。
 * qwen3.5 等模型会输出大量 thinking chunk，逐条 IPC 发送会压垮前端渲染。
 */
function createThinkingThrottle(
  ctx: IpcHandlerContext,
  state: ChatRuntimeState,
  sessionId: string,
): {
  buffer: string;
  timer: ReturnType<typeof setTimeout> | null;
  interval: number;
  flush: () => void;
  clear: () => void;
} {
  const s = {
    buffer: '',
    timer: null as ReturnType<typeof setTimeout> | null,
    interval: 200,
    flush: () => {},
    clear: () => {},
  };

  s.flush = () => {
    if (s.buffer && state.activeChatSessionId === sessionId) {
      ctx.sendAgentEvent({
        sessionId,
        turnId: '',
        sequence: ctx.nextEventSeq(),
        type: 'thinking',
        data: { text: s.buffer },
        createdAt: Date.now(),
      });
      s.buffer = '';
    }
    s.timer = null;
  };

  s.clear = () => {
    if (s.timer) {
      clearTimeout(s.timer);
      s.timer = null;
    }
  };

  return s;
}

/**
 * 创建默认的 ChatRuntimeState。
 * @param orchestrator - 会话编排器。
 * @returns 聊天运行时状态。
 */
export function createChatRuntimeState(orchestrator: SessionOrchestrator | null): ChatRuntimeState {
  return {
    currentRunId: null,
    currentRunMode: null,
    activeChatSessionId: null,
    currentIterator: null,
    terminalRunIds: new Set(),
    workerBridge: null,
    useWorkerMode: true,
    orchestrator,
  };
}
