/**
 * IPC 处理器共享上下文。
 * 各领域 IPC 处理器通过此接口访问共享资源，不直接持有 IpcHandlers 实例。
 */

import type { BrowserWindow } from 'electron';
import type { AgentEventEnvelope } from '@workagent/shared';
import type { Database } from '@workagent/store';
import type { DesktopRuntimeBundle } from '../runtime-factory.js';

/**
 * IPC 处理器共享上下文接口。
 * 各领域 IPC 处理器通过此接口访问共享资源。
 */
export interface IpcHandlerContext {
  /** 渲染进程窗口。 */
  win: BrowserWindow;
  /** 确保数据库已初始化。 */
  ensureDb(): Promise<Database>;
  /** 确保 Runtime Bundle 已初始化。 */
  ensureRuntime(): Promise<DesktopRuntimeBundle>;
  /** 发送 Agent 事件到 Renderer。 */
  sendAgentEvent(event: AgentEventEnvelope): void;
  /** 获取当前活跃会话 ID。 */
  getActiveSessionId(): string | null;
  /** 设置当前活跃会话 ID。 */
  setActiveSessionId(sessionId: string | null): void;
  /** 获取事件序列号并自增。 */
  nextEventSeq(): number;
}
