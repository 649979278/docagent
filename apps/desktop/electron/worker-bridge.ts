/**
 * Agent Worker 桥接层
 * 封装 Worker 线程通信，提供请求/响应模式 + 事件推送通道
 * 主进程通过此桥接层与 AgentWorker 通信
 *
 * 特性：
 * - 请求/响应模式：chat 请求等待 Worker 完成
 * - 事件推送通道：AgentEventEnvelope 实时推送到 Renderer
 * - Abort 原子通知：abort 和完成路径竞争时，保证只通知一次
 * - 降级机制：Worker 通信失败时自动降级到主进程直接执行
 */

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { AgentEventEnvelope, AgentMode } from '@workagent/shared';
import type { OpenAICompatConfig } from '@workagent/model-provider';

/** Worker 初始化参数 */
export interface WorkerInitOptions {
  /** 与主进程共享的数据库路径。 */
  dbPath?: string;
  /** OpenAI 兼容模型配置。 */
  openAICompatConfig?: OpenAICompatConfig | null;
}

/** Worker 接收的消息类型 */
export type WorkerRequest =
  | { type: 'init'; options?: WorkerInitOptions }
  | { type: 'chat'; message: string; sessionId: string; mode?: AgentMode }
  | { type: 'abort' }
  | { type: 'plan-approve'; planId: string; approved: boolean; updatedOutlineJson?: string }
  | { type: 'plan-cancel' }
  | { type: 'dispose' };

/** Worker 发送的消息类型 */
export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'event'; event: AgentEventEnvelope }
  | { type: 'chat-result'; success: boolean; error?: string }
  | { type: 'error'; message: string };

/** Agent Worker 桥接层 */
export class AgentWorkerBridge {
  /** Worker 线程实例 */
  private worker: Worker | null = null;

  /** 待处理的请求 Promise */
  private pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }> = new Map();

  /** 事件推送回调 */
  private eventCallback: ((event: AgentEventEnvelope) => void) | null = null;

  /** 是否已初始化 */
  private initialized: boolean = false;

  /** 是否正在对话 */
  private chatting: boolean = false;

  /** Abort 原子通知标志 */
  private notified: boolean = false;

  /** 当前对话的请求ID */
  private chatRequestId: string | null = null;

  /** Worker 通信是否可用 */
  private available: boolean = true;

  /**
   * 初始化 Worker 线程
   * @returns 初始化是否成功
   */
  async initialize(options?: WorkerInitOptions): Promise<boolean> {
    try {
      const workerPath = path.join(__dirname, 'workers', 'agent-worker.js');
      this.worker = new Worker(workerPath);

      // 监听 Worker 消息
      this.worker.on('message', (msg: WorkerResponse) => {
        this.handleWorkerMessage(msg);
      });

      // 监听 Worker 错误
      this.worker.on('error', (err) => {
        console.error('[AgentWorkerBridge] Worker error:', err.message);
        this.available = false;
        this.rejectAllPending(`Worker error: ${err.message}`);
      });

      // 监听 Worker 退出
      this.worker.on('exit', (code) => {
        if (code !== 0) {
          console.warn(`[AgentWorkerBridge] Worker exited with code ${code}`);
        }
        this.available = false;
        this.worker = null;
        this.rejectAllPending(`Worker exited with code ${code}`);
      });

      // 发送初始化请求
      const initResult = await this.sendRequest('init', options);
      this.initialized = initResult === true;
      return this.initialized;
    } catch (error) {
      console.warn('[AgentWorkerBridge] Worker initialization failed:', error instanceof Error ? error.message : String(error));
      this.available = false;
      return false;
    }
  }

  /**
   * 发送对话请求到 Worker
   * 请求/响应模式：等待 Worker 完成对话后返回结果
   * @param message - 用户消息
   * @param sessionId - 会话ID
   * @param mode - 对话模式
   * @returns 对话结果
   */
  async chat(message: string, sessionId: string, mode?: AgentMode): Promise<{ success: boolean }> {
    if (!this.available || !this.worker) {
      return { success: false };
    }

    // 重置 abort 原子通知标志
    this.notified = false;
    this.chatting = true;
    this.chatRequestId = `chat_${Date.now()}`;

    try {
      const result = await this.sendChatRequest(message, sessionId, mode);
      this.chatting = false;

      // 原子通知：abort 和完成路径竞争时，只通知一次
      if (!this.notified) {
        this.notified = true;
      }

      return result as { success: boolean };
    } catch (error) {
      this.chatting = false;

      // 原子通知
      if (!this.notified) {
        this.notified = true;
      }

      return { success: false };
    }
  }

  /**
   * 设置事件推送回调
   * Worker 产出的 AgentEventEnvelope 通过此回调推送到 Renderer
   * @param cb - 事件回调函数
   */
  setEventCallback(cb: (event: AgentEventEnvelope) => void): void {
    this.eventCallback = cb;
  }

  /**
   * 中断当前对话
   * Abort 原子通知语义：
   * - 终止模型流 + 终止工具执行 + 标记 run 状态为 aborted
   * - abort 和完成路径竞争时，用 notified 标志保证只通知一次
   */
  abort(): void {
    if (!this.available || !this.worker) return;

    // 原子通知：如果已经通知过，不再重复处理
    if (this.notified) return;

    this.notified = true;

    // 发送 abort 请求到 Worker
    this.worker.postMessage({ type: 'abort' } as WorkerRequest);

    // 拒绝当前的 chat 请求
    if (this.chatRequestId && this.pendingRequests.has(this.chatRequestId)) {
      const pending = this.pendingRequests.get(this.chatRequestId);
      this.pendingRequests.delete(this.chatRequestId);
      pending?.resolve({ success: false });
    }

    this.chatting = false;
    this.chatRequestId = null;
  }

  /**
   * 批准/拒绝计划
   * @param planId - 计划ID
   * @param approved - 是否批准
   */
  planApprove(planId: string, approved: boolean, updatedOutlineJson?: string): void {
    if (!this.available || !this.worker) return;
    this.worker.postMessage({ type: 'plan-approve', planId, approved, updatedOutlineJson } as WorkerRequest);
  }

  /**
   * 取消计划
   */
  planCancel(): void {
    if (!this.available || !this.worker) return;
    this.worker.postMessage({ type: 'plan-cancel' } as WorkerRequest);
  }

  /**
   * 检查 Worker 是否可用
   */
  isAvailable(): boolean {
    return this.available && this.worker !== null;
  }

  /**
   * 检查是否正在对话
   */
  isChatting(): boolean {
    return this.chatting;
  }

  /**
   * 清理 Worker 资源
   */
  dispose(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' } as WorkerRequest);
      // 给 Worker 一小段时间清理
      setTimeout(() => {
        this.worker?.terminate();
        this.worker = null;
      }, 1000);
    }
    this.pendingRequests.clear();
    this.available = false;
    this.initialized = false;
    this.chatting = false;
    this.notified = false;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 处理 Worker 返回的消息
   */
  private handleWorkerMessage(msg: WorkerResponse): void {
    switch (msg.type) {
      case 'ready':
        this.resolveRequest('init', true);
        break;

      case 'event':
        // 事件推送到 Renderer
        if (this.eventCallback) {
          this.eventCallback(msg.event);
        }
        break;

      case 'chat-result':
        this.resolveChatRequest(msg.success, msg.error);
        break;

      case 'error':
        console.error('[AgentWorkerBridge] Worker error:', msg.message);
        // 如果有正在进行的请求，拒绝它
        if (this.chatRequestId) {
          this.resolveChatRequest(false, msg.message);
        }
        break;
    }
  }

  /**
   * 发送初始化请求到 Worker
   */
  private sendRequest(type: string, options?: WorkerInitOptions): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = type === 'init' ? 'init' : `req_${Date.now()}`;
      this.pendingRequests.set(requestId, { resolve, reject });

      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      this.worker.postMessage({ type, options } as WorkerRequest);

      // 30秒超时
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request ${type} timed out`));
        }
      }, 30000);
    });
  }

  /**
   * 发送对话请求到 Worker
   */
  private sendChatRequest(message: string, sessionId: string, mode?: AgentMode): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = this.chatRequestId!;
      this.pendingRequests.set(requestId, { resolve, reject });

      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      this.worker.postMessage({
        type: 'chat',
        message,
        sessionId,
        mode,
      } as WorkerRequest);

      // 10分钟超时（长对话可能耗时）
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Chat request timed out'));
        }
      }, 600000);
    });
  }

  /**
   * 解决初始化请求
   */
  private resolveRequest(requestId: string, result: unknown): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      this.pendingRequests.delete(requestId);
      pending.resolve(result);
    }
  }

  /**
   * 解决对话请求
   */
  private resolveChatRequest(success: boolean, error?: string): void {
    if (this.chatRequestId) {
      const pending = this.pendingRequests.get(this.chatRequestId);
      if (pending) {
        this.pendingRequests.delete(this.chatRequestId);
        pending.resolve({ success, error });
      }
      this.chatRequestId = null;
      this.chatting = false;
    }
  }

  /**
   * 拒绝所有待处理请求
   */
  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      this.pendingRequests.delete(id);
      pending.reject(new Error(reason));
    }
    this.chatRequestId = null;
    this.chatting = false;
  }
}
