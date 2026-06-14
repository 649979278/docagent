/**
 * IPC 处理器 - 生命周期管理 + 会话管理 + 领域分发
 *
 * 职责：
 * - 管理数据库、Runtime、Worker Bridge 的生命周期
 * - 注册会话管理 IPC（简单稳定，不拆分）
 * - 构造 IpcHandlerContext 并分发给领域 IPC 模块
 *
 * 具体业务逻辑见：
 * - ipc/chat-ipc.ts — 聊天、中断、Plan 模式、Plan 审批
 * - ipc/knowledge-ipc.ts — 知识库添加、搜索、移除
 * - ipc/settings-ipc.ts — 设置、模型状态、文件对话框
 */

import { ipcMain, BrowserWindow } from 'electron';
import type { AgentEventEnvelope } from '@workagent/shared';
import type { OpenAICompatConfig } from '@workagent/model-provider';
import { initDatabase, closeDatabase, createSession, listSessions, deleteSession, getSession, updateSession, getSessionMessages } from '@workagent/store';
import { getSetting } from '@workagent/store';
import type { Database } from '@workagent/store';
import { SessionOrchestrator } from '@workagent/agent-core';
import { AgentWorkerBridge } from './worker-bridge.js';
import { createDesktopRuntimeBundle } from './runtime-factory.js';
import { getAppDataDir } from '@workagent/windows-tools';
import type { IpcHandlerContext } from './ipc/context.js';
import { registerChatIpc, createChatRuntimeState } from './ipc/chat-ipc.js';
import type { ChatRuntimeState } from './ipc/chat-ipc.js';
import { registerKnowledgeIpc } from './ipc/knowledge-ipc.js';
import { registerSettingsIpc } from './ipc/settings-ipc.js';
import { registerWorkspaceIpc } from './ipc/workspace-ipc.js';
import type { DesktopRuntimeBundle } from './runtime-factory.js';

/**
 * IPC 处理器。
 * 管理数据库、Runtime、Worker Bridge 的生命周期，并分发给领域 IPC 模块。
 */
export class IpcHandlers {
  private win: BrowserWindow;
  private db: Database | null = null;
  private eventSeq = 0;
  /** 需要重初始化的标志（由 settings-ipc 回调设置） */
  private needsRuntimeReinit = false;
  /** 聊天运行时状态（与 chat-ipc 共享） */
  private chatState: ChatRuntimeState | null = null;
  /** 缓存的 Runtime Bundle */
  private cachedBundle: DesktopRuntimeBundle | null = null;

  constructor(win: BrowserWindow) {
    this.win = win;
  }

  /**
   * 注册所有 IPC 处理程序。
   */
  register(): void {
    const ctx: IpcHandlerContext = {
      win: this.win,
      ensureDb: () => this.ensureDb(),
      ensureRuntime: () => this.ensureRuntime(),
      sendAgentEvent: (event) => this.sendAgentEvent(event),
      getActiveSessionId: () => this.chatState?.activeChatSessionId ?? null,
      setActiveSessionId: (id) => { if (this.chatState) this.chatState.activeChatSessionId = id; },
      nextEventSeq: () => this.eventSeq++,
    };

    // 会话管理（简单稳定，直接在此注册）
    ipcMain.handle('session-create', async (_ev, title?: string) => {
      const db = await this.ensureDb();
      const id = `session_${Date.now()}`;
      const session = createSession(db, { id, title: title ?? '新对话' });
      db.save();
      return session;
    });

    ipcMain.handle('session-list', async () => {
      const db = await this.ensureDb();
      return listSessions(db);
    });

    ipcMain.handle('session-delete', async (_ev, sessionId: string) => {
      const db = await this.ensureDb();
      if (this.chatState?.orchestrator?.getCurrentSessionId() === sessionId) {
        // 通知 chat-ipc 清理（通过共享状态）
        if (this.chatState) {
          this.chatState.currentIterator = null;
        }
      }
      deleteSession(db, sessionId);
      db.save();
      return { success: true };
    });

    ipcMain.handle('session-messages', async (_ev, sessionId: string) => {
      const db = await this.ensureDb();
      return getSessionMessages(db, sessionId);
    });

    ipcMain.handle('session-resume', async (_ev, sessionId: string) => {
      const bundle = await this.ensureRuntime();
      return bundle.resumeSession(sessionId);
    });

    // 权限（简单，直接在此注册）
    ipcMain.handle('permission-response', async (_ev, toolName: string, allowed: boolean, remember?: boolean) => {
      return { toolName, allowed, remember };
    });

    // 领域 IPC 模块
    // chat-ipc 需要共享状态，先初始化
    this.chatState = createChatRuntimeState(null);
    registerChatIpc(ctx, this.chatState);
    registerKnowledgeIpc(ctx);
    registerWorkspaceIpc(ctx);
    registerSettingsIpc(ctx, (changedKeys) => {
      // 如果更新了 OpenAI 兼容配置，标记需要重初始化
      if (changedKeys.some(k => k === 'openai_compat_url' || k === 'openai_compat_model')) {
        this.needsRuntimeReinit = true;
      }
    });
  }

  /**
   * 发送 Agent 事件到 Renderer。
   */
  private sendAgentEvent(event: AgentEventEnvelope): void {
    try {
      if (!this.win.isDestroyed()) {
        this.win.webContents.send('agent-event', event);
      }
    } catch {
      // 窗口可能已销毁
    }
  }

  /**
   * 确保数据库已初始化。
   */
  private async ensureDb(): Promise<Database> {
    if (!this.db) {
      this.db = await initDatabase({
        log: (msg: string) => console.log('[DB]', msg),
      });
      // 初始化 chat-ipc 的 orchestrator
      if (this.chatState) {
        this.chatState.orchestrator = new SessionOrchestrator(this.db);
      }
    }
    return this.db;
  }

  /**
   * 确保 Runtime Bundle 已初始化。
   */
  private async ensureRuntime(): Promise<DesktopRuntimeBundle> {
    // 检查是否需要重初始化（由 settings-ipc 回调触发）
    if (this.needsRuntimeReinit) {
      if (this.chatState) {
        this.chatState.workerBridge?.dispose();
        this.chatState.workerBridge = null;
        this.chatState.useWorkerMode = false;
      }
      this.cachedBundle = null;
      this.needsRuntimeReinit = false;
    }

    // 有缓存的 bundle 直接返回
    if (this.cachedBundle) {
      return this.cachedBundle;
    }

    const db = await this.ensureDb();

    const bundle = await createDesktopRuntimeBundle({
      db,
      autoApprovePermissions: true,
      getOpenAICompatConfig: () => this.loadOpenAICompatConfig(),
      emitEvent: (event) => this.sendAgentEvent(event),
      appDataDir: getAppDataDir(),
    });
    this.cachedBundle = bundle;

    // 初始化 Worker Bridge（首次创建 bundle 时）
    if (this.chatState && !this.chatState.workerBridge) {
      try {
        const bridge = new AgentWorkerBridge();
        const workerReady = await bridge.initialize({
          dbPath: (db as any).dbPath,
          openAICompatConfig: this.loadOpenAICompatConfig(),
        });
        if (workerReady) {
          this.chatState.workerBridge = bridge;
          this.chatState.useWorkerMode = true;
          console.log('[IpcHandlers] Worker Bridge initialized, using Worker mode');
        } else {
          this.chatState.useWorkerMode = false;
          console.log('[IpcHandlers] Worker Bridge not ready, using direct mode');
        }
      } catch (error) {
        this.chatState.useWorkerMode = false;
        console.warn('[IpcHandlers] Worker Bridge initialization failed, using direct mode:', error instanceof Error ? error.message : String(error));
      }
    }

    return bundle;
  }

  /**
   * 加载 OpenAI 兼容服务配置。
   * @returns 配置对象，未配置时返回 null。
   */
  private loadOpenAICompatConfig(): OpenAICompatConfig | null {
    if (!this.db) return null;

    try {
      const url = getSetting(this.db, 'openai_compat_url') as { value: string } | null;
      const model = getSetting(this.db, 'openai_compat_model') as { value: string } | null;
      const apiKey = getSetting(this.db, 'openai_compat_api_key') as { value: string } | null;
      const embedModel = getSetting(this.db, 'openai_compat_embed_model') as { value: string } | null;

      if (url?.value && model?.value) {
        return {
          baseUrl: url.value,
          chatModel: model.value,
          apiKey: apiKey?.value ?? undefined,
          embeddingModel: embedModel?.value ?? undefined,
        };
      }
    } catch {
      // 配置读取失败，忽略
    }

    return null;
  }

  /**
   * 清理资源。
   */
  dispose(): void {
    // 清理 chat-ipc 状态
    if (this.chatState) {
      if (this.chatState.currentIterator) {
        this.chatState.currentIterator.return?.(undefined);
        this.chatState.currentIterator = null;
      }
      if (this.chatState.workerBridge) {
        this.chatState.workerBridge.dispose();
        this.chatState.workerBridge = null;
      }
    }
    this.cachedBundle = null;

    if (this.db) {
      closeDatabase(this.db);
      this.db = null;
    }

    // 移除所有 IPC handler
    ipcMain.removeHandler('chat');
    ipcMain.removeHandler('chat-abort');
    ipcMain.removeHandler('session-create');
    ipcMain.removeHandler('session-list');
    ipcMain.removeHandler('session-delete');
    ipcMain.removeHandler('session-messages');
    ipcMain.removeHandler('session-resume');
    ipcMain.removeHandler('plan-mode');
    ipcMain.removeHandler('plan-approve');
    ipcMain.removeHandler('knowledge-add');
    ipcMain.removeHandler('knowledge-list');
    ipcMain.removeHandler('knowledge-search');
    ipcMain.removeHandler('knowledge-remove');
    ipcMain.removeHandler('workspace-list');
    ipcMain.removeHandler('workspace-create');
    ipcMain.removeHandler('workspace-update');
    ipcMain.removeHandler('workspace-delete');
    ipcMain.removeHandler('workspace-bind-session');
    ipcMain.removeHandler('workspace-unbind-session');
    ipcMain.removeHandler('workspace-session-ids');
    ipcMain.removeHandler('permission-response');
    ipcMain.removeHandler('settings-update');
    ipcMain.removeHandler('settings-get');
    ipcMain.removeHandler('models-status');
    ipcMain.removeHandler('open-file-dialog');
  }
}
