/**
 * IPC处理器 - 桥接Renderer和AgentRuntime/Store/ModelProvider
 * 所有业务逻辑在此调度，Renderer只做UI展示
 */

import { ipcMain, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import type { AgentEventEnvelope, AgentMode } from '@workagent/shared';
import { MockModelProvider, OllamaNativeProvider, OpenAICompatProvider } from '@workagent/model-provider';
import type { ModelProvider } from '@workagent/model-provider';
import type { OpenAICompatConfig } from '@workagent/model-provider';
import { initDatabase, closeDatabase, createSession, listSessions, deleteSession, getSession, updateSession, createMessage, getSessionMessages, createDocument, getDocumentByPath, updateDocument, createIndexJob, updateIndexJob, getIndexJob, createPlan, getActivePlanBySession, approvePlan, updatePlan, listDocuments } from '@workagent/store';
import { getSetting, setSetting, listSettings } from '@workagent/store';
import type { Database } from '@workagent/store';
import { detectOllama } from '@workagent/windows-tools';
import { AgentRuntime, SessionOrchestrator } from '@workagent/agent-core';
import { ToolRegistry, ToolExecutor, PermissionBroker } from '@workagent/tools';
import { RagSearchTool, DocReadTool, FileListTool, KnowledgeAddTool, DraftOutlineTool, DocWriteTool, DocOverwriteTool } from '@workagent/tools';
import { IngestPipeline, DocxExtractor, PptxExtractor, PdfExtractor, TxtExtractor } from '@workagent/ingest';
import { MemoryVectorStore, OllamaEmbedder, RAGEngine, LanceDBVectorStore } from '@workagent/rag';
import { generateMarkdown, markdownToDocx } from '@workagent/docgen';
import type { IndexManager } from '@workagent/tools';
import type { DocumentGenerator } from '@workagent/tools';
import type { KnowledgeIndex } from '@workagent/rag';

/**
 * IPC处理器
 * 管理AgentRuntime、数据库、模型提供者的生命周期
 */
export class IpcHandlers {
  private win: BrowserWindow;
  private db: Database | null = null;
  private modelProvider: ModelProvider | null = null;
  private orchestrator: SessionOrchestrator | null = null;
  private runtime: AgentRuntime | null = null;
  private ingestPipeline: IngestPipeline | null = null;
  private ragEngine: RAGEngine | null = null;
  private eventSeq = 0;
  /** 当前正在对话的会话ID，切换会话时用于判断是否应继续发送事件 */
  private activeChatSessionId: string | null = null;
  /** 当前正在执行的runtime迭代器，用于取消 */
  private currentIterator: AsyncGenerator<AgentEventEnvelope> | null = null;

  constructor(win: BrowserWindow) {
    this.win = win;
  }

  /**
   * 注册所有IPC处理程序
   */
  register(): void {
    // 对话（接入AgentRuntime）
    ipcMain.handle('chat', async (_ev, message: string, sessionId: string, mode?: string) => {
      return this.handleChat(message, sessionId, mode as AgentMode);
    });

    // 中断当前对话
    ipcMain.handle('chat-abort', async () => {
      return this.handleAbort();
    });

    // 会话管理
    ipcMain.handle('session-create', async (_ev, title?: string) => {
      await this.ensureDb();
      const id = `session_${Date.now()}`;
      const session = createSession(this.db!, { id, title: title ?? '新对话' });
      this.db!.save();
      return session;
    });

    ipcMain.handle('session-list', async () => {
      await this.ensureDb();
      return listSessions(this.db!);
    });

    ipcMain.handle('session-delete', async (_ev, sessionId: string) => {
      await this.ensureDb();
      if (this.orchestrator?.getCurrentSessionId() === sessionId) {
        this.runtime = null;
      }
      deleteSession(this.db!, sessionId);
      this.db!.save();
      return { success: true };
    });

    ipcMain.handle('session-messages', async (_ev, sessionId: string) => {
      await this.ensureDb();
      return getSessionMessages(this.db!, sessionId);
    });

    // Plan模式
    ipcMain.handle('plan-mode', async (_ev, enabled: boolean, sessionId: string) => {
      await this.ensureDb();
      const mode = enabled ? 'plan' : 'chat';
      updateSession(this.db!, sessionId, { mode });
      this.db!.save();
      if (this.orchestrator) {
        this.orchestrator.updateMode(sessionId, mode);
      }
      return { mode };
    });

    ipcMain.handle('plan-approve', async (_ev, planId: string, approved: boolean, sessionId: string) => {
      await this.ensureDb();
      if (!approved) {
        // 用户拒绝计划，取消
        if (this.runtime) {
          this.runtime.getPlanController().cancelPlan();
        }
        return { planId, approved: false, sessionId };
      }
      // 用户批准计划
      if (this.runtime) {
        this.runtime.getPlanController().approvePlan();
      }
      // 更新数据库
      approvePlan(this.db!, planId);
      this.db!.save();
      return { planId, approved: true, sessionId };
    });

    // 知识库 - 接入IngestPipeline + RAGEngine
    ipcMain.handle('knowledge-add', async (_ev, filePaths: string[], sessionId: string) => {
      await this.ensureDb();
      await this.ensureRuntime();

      const results: Array<{ filePath: string; status: string; documentId?: string; error?: string }> = [];

      for (const filePath of filePaths) {
        try {
          // 检查是否已索引
          const existingDoc = getDocumentByPath(this.db!, filePath);
          if (existingDoc && existingDoc.status === 'indexed') {
            results.push({ filePath, status: 'already_indexed', documentId: existingDoc.id });
            continue;
          }

          // 1. 解析文件
          const doc = await this.ingestPipeline!.ingest(filePath);

          // 2. 创建/更新文档记录
          const docId = existingDoc?.id ?? `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          if (!existingDoc) {
            createDocument(this.db!, {
              id: docId,
              path: filePath,
              fileName: doc.fileName,
              fileType: doc.fileType,
              sha256: doc.metadata.contentHash as string ?? '',
              fileSize: (doc.content.length * 2), // 估算
              embeddingModel: this.modelProvider!.getConfig().embeddingModel,
            });
          }
          updateDocument(this.db!, docId, { status: 'extracting' });

          // 3. 通过RAGEngine索引
          await this.ragEngine!.indexDocument(doc, (progress) => {
            this.sendAgentEvent({
              sessionId,
              turnId: `index_${docId}`,
              sequence: this.eventSeq++,
              type: 'index_progress',
              data: {
                job: {
                  id: docId,
                  documentId: docId,
                  status: progress < 100 ? 'embedding' : 'indexed',
                  progress,
                  error: null,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                },
              },
              createdAt: Date.now(),
            });
          });

          // 4. 更新文档状态为已索引
          updateDocument(this.db!, docId, { status: 'indexed', indexedAt: Date.now() });
          this.db!.save();

          results.push({ filePath, status: 'indexed', documentId: docId });
        } catch (error) {
          results.push({
            filePath,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return { filePaths, sessionId, results };
    });

    ipcMain.handle('knowledge-search', async (_ev, query: string, topK?: number) => {
      await this.ensureRuntime();

      try {
        const results = await this.ragEngine!.search(query, { topK: topK ?? 5 });
        return { query, topK: topK ?? 5, results };
      } catch (error) {
        return { query, topK: topK ?? 5, results: [], error: error instanceof Error ? error.message : String(error) };
      }
    });

    // 权限
    ipcMain.handle('permission-response', async (_ev, toolName: string, allowed: boolean, remember?: boolean) => {
      return { toolName, allowed, remember };
    });

    // 设置
    ipcMain.handle('settings-update', async (_ev, settings: Record<string, unknown>) => {
      await this.ensureDb();
      for (const [key, value] of Object.entries(settings)) {
        setSetting(this.db!, key, value);
      }
      this.db!.save();

      // 如果更新了OpenAI兼容配置，重新初始化模型提供者
      if ('openai_compat_url' in settings || 'openai_compat_model' in settings) {
        this.modelProvider = null; // 强制重新初始化
      }

      return { success: true };
    });

    ipcMain.handle('settings-get', async (_ev, key?: string) => {
      await this.ensureDb();
      if (key) {
        return getSetting(this.db!, key);
      }
      return listSettings(this.db!);
    });

    // 模型状态
    ipcMain.handle('models-status', async () => {
      await this.ensureModelProvider();
      return this.modelProvider!.getModelsStatus();
    });

    // 文件对话框
    ipcMain.handle('open-file-dialog', async (_ev, options?: { multiple?: boolean; filters?: Array<{ name: string; extensions: string[] }> }) => {
      const result = await dialog.showOpenDialog(this.win, {
        properties: options?.multiple ? ['multiSelections'] : [],
        filters: options?.filters,
      });
      return result.filePaths;
    });
  }

  /**
   * 处理对话请求 - 接入AgentRuntime的agentic loop
   */
  private async handleChat(message: string, sessionId: string, mode?: AgentMode): Promise<{ success: boolean }> {
    await this.ensureDb();
    await this.ensureModelProvider();
    await this.ensureRuntime();

    // 确保会话存在
    let session = getSession(this.db!, sessionId);
    if (!session) {
      session = createSession(this.db!, { id: sessionId, title: message.slice(0, 30) });
    }
    // 无论新建还是已有，都确保orchestrator加载了该会话
    this.orchestrator?.load(sessionId);

    // 用户消息由runtime内部持久化（buildMessages + persistMessages），此处不再重复写入

    try {
      const effectiveMode = mode ?? 'chat';
      const iterator = this.runtime!.runTurn(sessionId, message, effectiveMode);
      this.currentIterator = iterator;
      this.activeChatSessionId = sessionId;

      // thinking事件节流：qwen3.5等模型会输出大量thinking chunk，
      // 逐条IPC发送会压垮前端渲染，此处合并后批量发送
      let thinkingBuffer = '';
      let thinkingFlushTimer: ReturnType<typeof setTimeout> | null = null;
      const THINKING_FLUSH_INTERVAL = 200; // 每200ms批量发送一次thinking

      const flushThinking = () => {
        if (thinkingBuffer && this.activeChatSessionId === sessionId) {
          this.sendAgentEvent({
            sessionId,
            turnId: '',
            sequence: this.eventSeq++,
            type: 'thinking',
            data: { text: thinkingBuffer },
            createdAt: Date.now(),
          });
          thinkingBuffer = '';
        }
        thinkingFlushTimer = null;
      };

      for await (const event of iterator) {
        // 如果用户已切换到其他会话，停止发送事件但仍让runtime完成持久化
        if (this.activeChatSessionId !== sessionId) {
          // 切换了会话，中断当前迭代器
          iterator.return?.(undefined);
          break;
        }

        if (event.type === 'thinking') {
          // thinking事件走节流缓冲
          const data = event.data as { text: string };
          thinkingBuffer += data.text ?? '';
          if (!thinkingFlushTimer) {
            thinkingFlushTimer = setTimeout(flushThinking, THINKING_FLUSH_INTERVAL);
          }
        } else {
          // 遇到非thinking事件，先刷新缓冲的thinking
          if (thinkingFlushTimer) {
            clearTimeout(thinkingFlushTimer);
            thinkingFlushTimer = null;
          }
          flushThinking();
          this.sendAgentEvent(event);
        }
        if (event.type === 'done') {
          this.db!.save();
          break;  // runtime已发送done事件，无需再发
        }
      }

      // 清理：刷新剩余的thinking缓冲
      if (thinkingFlushTimer) {
        clearTimeout(thinkingFlushTimer);
        thinkingFlushTimer = null;
      }
      flushThinking();

      this.currentIterator = null;
      this.activeChatSessionId = null;

      return { success: true };
    } catch (error) {
      this.currentIterator = null;
      this.activeChatSessionId = null;
      const errorTurnId = `turn_${Date.now()}`;
      this.sendAgentEvent({
        sessionId,
        turnId: errorTurnId,
        sequence: this.eventSeq++,
        type: 'error',
        data: {
          code: 'AGENT_ERROR',
          message: error instanceof Error ? error.message : String(error),
          recoverable: true,
        },
        createdAt: Date.now(),
      });
      return { success: false };
    }
  }

  /**
   * 中断当前对话
   */
  private async handleAbort(): Promise<{ success: boolean }> {
    if (this.currentIterator) {
      this.currentIterator.return?.(undefined);
      this.currentIterator = null;
    }
    // 发送done事件确保前端状态重置
    this.sendAgentEvent({
      sessionId: '',
      turnId: '',
      sequence: this.eventSeq++,
      type: 'done',
      data: null,
      createdAt: Date.now(),
    });
    return { success: true };
  }

  /**
   * 发送Agent事件到Renderer
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
   * 确保数据库已初始化
   */
  private async ensureDb(): Promise<void> {
    if (!this.db) {
      this.db = await initDatabase({
        log: (msg: string) => console.log('[DB]', msg),
      });
      this.orchestrator = new SessionOrchestrator(this.db);
    }
  }

  /**
   * 确保模型提供者已初始化
   * 优先检测Ollama本地服务，其次检查是否配置了局域网OpenAI兼容服务
   */
  private async ensureModelProvider(): Promise<void> {
    if (this.modelProvider) return;
    const status = await detectOllama();
    if (status.running) {
      this.modelProvider = new OllamaNativeProvider();
    } else {
      // 检查是否配置了局域网OpenAI兼容服务
      const compatConfig = this.loadOpenAICompatConfig();
      if (compatConfig) {
        console.log(`Using OpenAI-compatible provider: ${compatConfig.baseUrl}`);
        this.modelProvider = new OpenAICompatProvider(compatConfig);
        const available = await this.modelProvider.isAvailable();
        if (!available) {
          console.log('OpenAI-compatible service not available, falling back to MockProvider');
          this.modelProvider = new MockModelProvider();
        }
      } else {
        console.log('Ollama not available, using MockProvider');
        this.modelProvider = new MockModelProvider();
      }
    }
  }

  /**
   * 加载OpenAI兼容服务配置
   * 从数据库settings表读取，支持运行时配置
   * @returns 配置对象，未配置时返回null
   */
  private loadOpenAICompatConfig(): OpenAICompatConfig | null {
    if (!this.db) return null;

    try {
      const url = getSetting(this.db!, 'openai_compat_url') as { value: string } | null;
      const model = getSetting(this.db!, 'openai_compat_model') as { value: string } | null;
      const apiKey = getSetting(this.db!, 'openai_compat_api_key') as { value: string } | null;
      const embedModel = getSetting(this.db!, 'openai_compat_embed_model') as { value: string } | null;

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
   * 创建向量存储实例
   * 优先使用LanceDB（高性能、持久化），降级使用内存存储
   * @returns KnowledgeIndex实例
   */
  private async createVectorStore(): Promise<KnowledgeIndex> {
    try {
      // 尝试使用LanceDB
      const { getAppDataDir } = await import('@workagent/windows-tools');
      const appDir = getAppDataDir();
      const lancedbDir = path.join(appDir, 'vectors');

      const store = new LanceDBVectorStore(lancedbDir);
      await store.initialize();
      console.log('LanceDB vector store initialized');
      return store;
    } catch (error) {
      // LanceDB初始化失败（可能native模块不兼容），降级到内存存储
      console.log('LanceDB unavailable, falling back to MemoryVectorStore:', error instanceof Error ? error.message : String(error));
      const { getAppDataDir: getAppDataDir2 } = await import('@workagent/windows-tools');
      const fallbackDir = path.join(getAppDataDir2(), 'vectors-memory');
      const memoryStore = new MemoryVectorStore(fallbackDir);
      await memoryStore.initialize();
      return memoryStore;
    }
  }

  /**
   * 确保AgentRuntime已初始化
   * 注册所有工具、创建执行器和运行时
   */
  private async ensureRuntime(): Promise<void> {
    if (this.runtime) return;
    if (!this.db || !this.modelProvider) {
      throw new Error('数据库和模型提供者必须先初始化');
    }

    // 1. 工具注册中心
    const registry = new ToolRegistry();

    // 解析管道
    this.ingestPipeline = new IngestPipeline();
    this.ingestPipeline.register(new DocxExtractor());
    this.ingestPipeline.register(new PptxExtractor());
    this.ingestPipeline.register(new PdfExtractor());
    this.ingestPipeline.register(new TxtExtractor());

    // RAG向量库 - 优先使用LanceDB，降级使用内存存储
    const vectorStore: KnowledgeIndex = await this.createVectorStore();
    const embedder = new OllamaEmbedder(this.modelProvider);
    this.ragEngine = new RAGEngine(vectorStore, embedder);

    // DocumentGenerator适配器 - 将docgen的markdownToDocx包装为DocumentGenerator接口
    const docGenerator: DocumentGenerator = {
      async generateDocx(markdownContent: string, outputPath: string, templateName?: string): Promise<string> {
        const result = await markdownToDocx(markdownContent, outputPath);
        return result.outputPath;
      },
    };

    // IndexManager适配器 - 接入RAGEngine和数据库
    // 使用箭头函数捕获IpcHandlers的this，避免object literal中this指向错误
    const ipcHandlers = this;
    const indexManager: IndexManager = {
      async createIndexJob(filePath: string) {
        await ipcHandlers.ensureDb();
        const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const jobId = `job_${Date.now()}`;

        // 创建文档记录
        createDocument(ipcHandlers.db!, {
          id: docId,
          path: filePath,
          fileName: filePath.split(/[\\/]/).pop() ?? filePath,
          fileType: filePath.split('.').pop() ?? '',
          sha256: '',
        });

        // 创建索引任务
        const job = createIndexJob(ipcHandlers.db!, { id: jobId, documentId: docId });
        ipcHandlers.db!.save();

        return {
          id: job.id,
          documentId: job.documentId,
          status: job.status as 'queued',
          progress: job.progress,
          error: job.error,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        };
      },
      async getIndexJob(jobId: string) {
        await ipcHandlers.ensureDb();
        const job = getIndexJob(ipcHandlers.db!, jobId);
        if (!job) return null;
        return {
          id: job.id,
          documentId: job.documentId,
          status: job.status as 'queued',
          progress: job.progress,
          error: job.error,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        };
      },
    };

    // 注册7个一期工具（类型断言绕过泛型协变问题，运行时行为正确）
    registry.register(new DocReadTool(this.ingestPipeline as any) as any);
    registry.register(new FileListTool() as any);
    registry.register(new RagSearchTool(this.ragEngine as any) as any);
    registry.register(new KnowledgeAddTool(indexManager as any) as any);
    registry.register(new DraftOutlineTool() as any);
    registry.register(new DocWriteTool(docGenerator) as any);
    registry.register(new DocOverwriteTool(docGenerator) as any);

    // 2. 权限代理（一期桌面单用户，自动授权）
    const permissionBroker = new PermissionBroker({
      saveDecision() { /* 一期不持久化 */ },
      loadDecisions() { return []; },
      removeDecision() { /* 一期不持久化 */ },
    });
    // 一期自动授权所有操作
    permissionBroker.setRequestCallback(async (_toolName, _input, _safety, _reason) => {
      return { allowed: true, reason: '一期自动授权' };
    });

    // 3. 工具执行器
    const executor = new ToolExecutor(registry, permissionBroker);

    // 4. 创建AgentRuntime，注入RAG搜索引擎实现自动上下文增强
    this.runtime = new AgentRuntime(
      this.modelProvider,
      registry,
      executor,
      this.db,
      {
        ragSearchProvider: this.ragEngine ?? undefined,
      },
    );
  }

  /**
   * 清理资源
   */
  dispose(): void {
    if (this.currentIterator) {
      this.currentIterator.return?.(undefined);
      this.currentIterator = null;
    }
    this.runtime = null;

    if (this.db) {
      closeDatabase(this.db);
      this.db = null;
    }

    ipcMain.removeHandler('chat');
    ipcMain.removeHandler('chat-abort');
    ipcMain.removeHandler('session-create');
    ipcMain.removeHandler('session-list');
    ipcMain.removeHandler('session-delete');
    ipcMain.removeHandler('session-messages');
    ipcMain.removeHandler('plan-mode');
    ipcMain.removeHandler('plan-approve');
    ipcMain.removeHandler('knowledge-add');
    ipcMain.removeHandler('knowledge-search');
    ipcMain.removeHandler('permission-response');
    ipcMain.removeHandler('settings-update');
    ipcMain.removeHandler('settings-get');
    ipcMain.removeHandler('models-status');
    ipcMain.removeHandler('open-file-dialog');
  }
}
