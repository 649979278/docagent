import path from 'node:path';
import fs from 'node:fs';
import type { AgentEventEnvelope } from '@workagent/shared';
import type { ModelProvider, OpenAICompatConfig } from '@workagent/model-provider';
import { MockModelProvider, OllamaNativeProvider, OpenAICompatProvider } from '@workagent/model-provider';
import {
  createDocument,
  createIndexJob,
  getIndexJob,
  initDatabase,
  loadAllPermissionDecisions,
  removePermissionDecision,
  savePermissionDecision,
  type Database,
} from '@workagent/store';
import { AgentRuntime, resumeSession, type RunLookupStore } from '@workagent/agent-core';
import {
  bindPlanPersistenceBridge,
  persistPlanOutput,
  type PlanPersistenceBridgeOptions,
  type RetrievalDiagnosticsSnapshot,
} from './plan-persistence.js';
import {
  DocOverwriteTool,
  DocReadTool,
  DocWriteTool,
  DraftOutlineTool,
  FileListTool,
  KnowledgeAddTool,
  PermissionBroker,
  RagSearchTool,
  ToolExecutor,
  ToolRegistry,
  type DocumentGenerator,
  type IndexManager,
  type ToolExecutionObserver,
} from '@workagent/tools';
import { DocxExtractor, IngestPipeline, PdfExtractor, PptxExtractor, TxtExtractor } from '@workagent/ingest';
import {
  LanceDBVectorStore,
  MemoryVectorStore,
  OllamaEmbedder,
  RAGEngine,
  BM25Search,
  RuleBasedQueryRewriter,
  OllamaQueryRewriter,
  PassThroughReranker,
  BGEReranker,
  ScoreAndKeywordGrader,
  type KnowledgeIndex,
  type ChunkMetadataStore,
} from '@workagent/rag';
import { markdownToDocx } from '@workagent/docgen';
import { detectOllama, getAppDataDir } from '@workagent/windows-tools';
import { isModelAvailable, REQUIRED_OLLAMA_MODELS, OLLAMA_DEFAULT_BASE_URL } from '@workagent/shared';

/**
 * Runtime 工厂配置。
 */
export interface DesktopRuntimeFactoryOptions {
  /** 已初始化的数据库实例。 */
  db: Database;
  /** 是否自动允许交互式权限请求。 */
  autoApprovePermissions?: boolean;
  /** 打开兼容模型配置的回调。 */
  getOpenAICompatConfig?: () => OpenAICompatConfig | null;
  /** 事件回调，用于透传计划控制器或索引进度事件。 */
  emitEvent?: (event: AgentEventEnvelope) => void;
  /** 应用数据目录，用于落盘 transcript / session memory。 */
  appDataDir?: string;
}

/**
 * 统一 Runtime Bundle。
 */
export interface DesktopRuntimeBundle {
  /** 模型提供者。 */
  modelProvider: ModelProvider;
  /** 工具注册中心。 */
  registry: ToolRegistry;
  /** 权限代理。 */
  permissionBroker: PermissionBroker;
  /** 工具执行器。 */
  executor: ToolExecutor;
  /** 文档解析管道。 */
  ingestPipeline: IngestPipeline;
  /** RAG 引擎。 */
  ragEngine: RAGEngine;
  /** Agent 运行时。 */
  runtime: AgentRuntime;
  /** 向量存储后端。 */
  vectorStore: KnowledgeIndex;
  /** 会话恢复函数。通过 transcript + DB 恢复会话状态快照。 */
  resumeSession: (sessionId: string) => ReturnType<typeof resumeSession>;
  /** 当前检索组件诊断快照。 */
  retrievalDiagnostics: RetrievalDiagnosticsSnapshot;
}

/**
 * 创建统一的桌面运行时装配。
 * @param options - 装配配置。
 * @returns 完整运行时 Bundle。
 */
export async function createDesktopRuntimeBundle(
  options: DesktopRuntimeFactoryOptions,
): Promise<DesktopRuntimeBundle> {
  const appDataDir = options.appDataDir ?? getAppDataDir();
  const modelProvider = await createModelProvider(options.getOpenAICompatConfig);
  const ingestPipeline = createIngestPipeline();
  const vectorStore = await createVectorStore(appDataDir);
  const embedder = new OllamaEmbedder(modelProvider);

  // 构造 ChunkMetadataStore（注入到 RAGEngine，用于 BM25 全文写入）
  const chunkMetadataStore = createChunkMetadataStore(options.db);

  // 构造 BM25Search（注入 queryFn，由数据库驱动）
  const bm25Search = createBM25Search(options.db);

  // 根据 Ollama 可用性组装可降级检索组件
  const components = await createRetrievalComponents(modelProvider);

  // 构造 RAGEngine（options object 模式）
  const ragEngine = new RAGEngine({
    index: vectorStore,
    embedder,
    metadataStore: chunkMetadataStore,
    components: {
      sparseSearcher: bm25Search,
      ...components,
    },
  });
  const permissionBroker = createPermissionBroker(options.db, options.autoApprovePermissions ?? false);
  const registry = new ToolRegistry();
  let planBridgeOptions: PlanPersistenceBridgeOptions | null = null;
  const outputObserver: ToolExecutionObserver = {
    /**
     * 监听文档与草稿类工具结果，桥接到计划持久化和事件流。
     * @param result - 工具执行结果。
     * @param context - 工具执行上下文。
     */
    async onResult(result, context): Promise<void> {
      if (!planBridgeOptions || result.isError) {
        return;
      }

      if (result.call.name === 'doc_write' || result.call.name === 'doc_overwrite') {
        const output = result.output as { filePath?: string } | null;
        if (output?.filePath) {
          persistPlanOutput(planBridgeOptions, {
            sessionId: context.sessionId,
            type: 'doc_ready',
            data: { filePath: output.filePath },
          });
        }
      }
    },
  };
  const executor = new ToolExecutor(registry, permissionBroker, {
    observer: outputObserver,
  });

  registerTools(registry, {
    db: options.db,
    modelProvider,
    ingestPipeline,
    ragEngine,
    emitEvent: options.emitEvent,
  });

  const runtime = new AgentRuntime(modelProvider, registry, executor, options.db, {
    ragSearchProvider: ragEngine,
    transcriptDir: path.join(appDataDir, 'transcripts'),
    sessionMemoryDir: path.join(appDataDir, 'session-memory'),
  });

  planBridgeOptions = {
    db: options.db,
    runtime,
    emitEvent: options.emitEvent,
    retrievalDiagnostics: components.diagnostics,
  };
  bindPlanPersistenceBridge(planBridgeOptions);
  bindPlanControllerEvents(runtime, options.emitEvent);
  await reconcileDeletedKnowledge(options.db, ragEngine);

  // 构造 RunLookupStore（注入到 resumeSession，不依赖 @workagent/store）
  const runLookup = createRunLookupStore(options.db);
  const transcriptDir = path.join(appDataDir, 'transcripts');

  return {
    modelProvider,
    registry,
    permissionBroker,
    executor,
    ingestPipeline,
    ragEngine,
    runtime,
    vectorStore,
    resumeSession: (sessionId: string) => resumeSession(sessionId, transcriptDir, runLookup),
    retrievalDiagnostics: components.diagnostics,
  };
}

/**
 * 清理已从磁盘删除但仍残留在数据库和向量库中的知识条目。
 * @param db - 数据库实例。
 * @param ragEngine - RAG 引擎。
 */
async function reconcileDeletedKnowledge(db: Database, ragEngine: RAGEngine): Promise<void> {
  const documents = db.prepare(
    'SELECT id, path FROM documents',
  ).all() as Array<{ id: string; path: string }>;

  for (const document of documents) {
    if (fs.existsSync(document.path)) {
      continue;
    }

    try {
      await ragEngine.removeDocument(document.path);
    } catch {
      // 清理向量失败不应阻塞后续回收
    }

    try {
      db.prepare('DELETE FROM documents WHERE id = ?').run(document.id);
    } catch {
      // 文档记录清理失败也不阻塞
    }
  }

  db.save();
}

/**
 * 为测试创建精简的 Bundle 能力快照。
 * @param mode - 运行模式标识，仅用于测试输出标注。
 * @param options - 可选依赖配置。
 * @returns 运行时快照。
 */
export async function createRuntimeBundleForTest(
  mode: 'direct' | 'worker',
  options?: Partial<DesktopRuntimeFactoryOptions>,
): Promise<{
  mode: 'direct' | 'worker';
  tools: string[];
  hasRagProvider: boolean;
  providerKind: string;
  hasPlanController: boolean;
}> {
  const db = options?.db ?? await initDatabase({
    dbPath: path.join(getAppDataDir(), `.test-${mode}-runtime.db`),
  });
  const bundle = await createDesktopRuntimeBundle({
    db,
    autoApprovePermissions: true,
    getOpenAICompatConfig: options?.getOpenAICompatConfig,
    emitEvent: options?.emitEvent,
    appDataDir: options?.appDataDir ?? getAppDataDir(),
  });

  return {
    mode,
    tools: bundle.registry.getToolNames().sort(),
    hasRagProvider: true,
    providerKind: bundle.modelProvider.constructor.name,
    hasPlanController: Boolean(bundle.runtime.getPlanController()),
  };
}

/**
 * 创建模型提供者。
 * @param getOpenAICompatConfig - OpenAI 兼容配置获取函数。
 * @returns 模型提供者实例。
 */
async function createModelProvider(
  getOpenAICompatConfig?: () => OpenAICompatConfig | null,
): Promise<ModelProvider> {
  const status = await detectOllama();
  if (status.running) {
    return new OllamaNativeProvider();
  }

  const compatConfig = getOpenAICompatConfig?.() ?? null;
  if (compatConfig) {
    const compatProvider = new OpenAICompatProvider(compatConfig);
    if (await compatProvider.isAvailable()) {
      return compatProvider;
    }
  }

  return new MockModelProvider();
}

/**
 * 创建统一的文档解析流水线。
 * @returns 解析流水线实例。
 */
function createIngestPipeline(): IngestPipeline {
  const pipeline = new IngestPipeline();
  pipeline.register(new DocxExtractor());
  pipeline.register(new PptxExtractor());
  pipeline.register(new PdfExtractor());
  pipeline.register(new TxtExtractor());
  return pipeline;
}

/**
 * 创建向量存储。
 * 优先使用 LanceDB，失败时自动降级到带持久化的内存实现。
 * @returns 向量存储实例。
 */
async function createVectorStore(appDataDir: string): Promise<KnowledgeIndex> {
  try {
    const lancedbDir = path.join(appDataDir, 'vectors');
    const store = new LanceDBVectorStore(lancedbDir);
    await store.initialize();
    return store;
  } catch {
    const fallbackDir = path.join(appDataDir, 'vectors-memory');
    const fallback = new MemoryVectorStore(fallbackDir);
    await fallback.initialize();
    return fallback;
  }
}

/**
 * 创建权限代理。
 * @param db - 数据库实例。
 * @param autoApprovePermissions - 是否自动批准。
 * @returns 权限代理。
 */
function createPermissionBroker(db: Database, autoApprovePermissions: boolean): PermissionBroker {
  const broker = new PermissionBroker({
    saveDecision(toolName, inputPattern, decision) {
      savePermissionDecision(db, { toolName, inputPattern, decision });
    },
    loadDecisions() {
      return loadAllPermissionDecisions(db).map((item) => ({
        toolName: item.toolName,
        inputPattern: item.inputPattern,
        decision: item.decision,
      }));
    },
    removeDecision(toolName, inputPattern) {
      removePermissionDecision(db, toolName, inputPattern);
    },
  });

  if (autoApprovePermissions) {
    broker.setRequestCallback(async () => ({ allowed: true, remember: false, reason: '自动授权' }));
  }

  return broker;
}

/**
 * 注册统一工具集。
 * @param registry - 工具注册中心。
 * @param deps - 依赖对象。
 */
function registerTools(
  registry: ToolRegistry,
  deps: {
    db: Database;
    modelProvider: ModelProvider;
    ingestPipeline: IngestPipeline;
    ragEngine: RAGEngine;
    emitEvent?: (event: AgentEventEnvelope) => void;
  },
): void {
  const docGenerator: DocumentGenerator = {
    /**
     * 生成 docx 文档。
     * @param markdownContent - Markdown 内容。
     * @param outputPath - 输出路径。
     * @returns 生成后的文件路径。
     */
    async generateDocx(markdownContent: string, outputPath: string): Promise<string> {
      const result = await markdownToDocx(markdownContent, outputPath);
      return result.outputPath;
    },
  };

  const indexManager: IndexManager = {
    /**
     * 创建索引任务并立即开始当前版本的索引流程。
     * @param filePath - 文件路径。
     * @returns 索引任务。
     */
    async createIndexJob(filePath) {
      const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      createDocument(deps.db, {
        id: docId,
        path: filePath,
        fileName: path.basename(filePath),
        fileType: path.extname(filePath).slice(1).toLowerCase(),
        sha256: '',
        embeddingModel: deps.modelProvider.getConfig().embeddingModel,
      });
      const job = createIndexJob(deps.db, { id: jobId, documentId: docId });
      deps.db.save();
      return {
        id: job.id,
        documentId: job.documentId,
        status: job.status,
        progress: job.progress,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };
    },
    /**
     * 获取索引任务状态。
     * @param jobId - 索引任务 ID。
     * @returns 索引任务或空。
     */
    async getIndexJob(jobId) {
      const job = getIndexJob(deps.db, jobId);
      if (!job) return null;
      return {
        id: job.id,
        documentId: job.documentId,
        status: job.status,
        progress: job.progress,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };
    },
  };

  registry.register(new RagSearchTool(deps.ragEngine) as any);
  registry.register(new DocReadTool(deps.ingestPipeline as any) as any);
  registry.register(new FileListTool() as any);
  registry.register(new KnowledgeAddTool(indexManager as any) as any);
  registry.register(new DraftOutlineTool() as any);
  registry.register(new DocWriteTool(docGenerator) as any);
  registry.register(new DocOverwriteTool(docGenerator) as any);
}

/**
 * 绑定计划控制器事件到统一事件出口。
 * @param runtime - Agent 运行时。
 * @param emitEvent - 事件发送函数。
 */
function bindPlanControllerEvents(
  runtime: AgentRuntime,
  emitEvent?: (event: AgentEventEnvelope) => void,
): void {
  if (!emitEvent) {
    return;
  }

  runtime.getPlanController().onEvent((event) => {
    const base = {
      sessionId: event.type === 'plan_generated' || event.type === 'plan_approved'
        ? event.plan.sessionId
        : runtime.getPlanController().getActivePlan()?.sessionId ?? '',
      turnId: '',
      sequence: Date.now(),
      createdAt: Date.now(),
      source: 'runtime' as const,
    };

    if (event.type === 'plan_generated') {
      emitEvent({
        ...base,
        type: 'plan_generated',
        data: { plan: event.plan },
      });
    } else if (event.type === 'plan_approved') {
      emitEvent({
        ...base,
        type: 'plan_approved',
        data: { plan: event.plan },
      });
    } else if (event.type === 'phase_change') {
      emitEvent({
        ...base,
        type: 'phase_change',
        data: { phase: event.to },
      });
    } else if (event.type === 'execution_started') {
      emitEvent({
        ...base,
        type: 'mode_change',
        data: { mode: 'execute' },
      });
    }
  });
}

/**
 * 创建 ChunkMetadataStore 实现。
 * 向 chunks 表写入全文内容和来源文件路径，供 BM25 检索使用。
 * @param db - 数据库实例。
 * @returns ChunkMetadataStore 实现。
 */
function createChunkMetadataStore(db: Database): ChunkMetadataStore {
  return {
    /**
     * 批量写入块元数据。
     * 使用 INSERT OR REPLACE 确保 upsert 语义。
     * documentId 由调用方从外部上下文提供。
     */
    upsertChunkMetadata(chunks) {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO chunks (id, document_id, chunk_index, content_preview, source_locator, content, source_file, token_count, created_at)
         VALUES (?, ?, 0, ?, '', ?, ?, 0, strftime('%s','now') * 1000)`,
      );
      for (const c of chunks) {
        stmt.run(c.chunkId, c.documentId ?? '', c.content.slice(0, 100), c.content, c.sourceFile);
      }
      db.save();
    },
    /**
     * 删除指定文档的所有块元数据。
     */
    deleteChunkMetadata(documentId) {
      db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);
      db.save();
    },
  };
}

/**
 * 创建 BM25Search 实例。
 * 注入数据库查询函数和 FTS5 可用性检测。
 * @param db - 数据库实例。
 * @returns BM25Search 实例，FTS5 不可用时自动降级到 LIKE。
 */
function createBM25Search(db: Database): BM25Search {
  /** 注入的查询函数 */
  const queryFn = (sql: string, params: unknown[]) => {
    return db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  };

  /** 检测 FTS5 是否可用 */
  let fts5Available = false;
  try {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'",
    ).get();
    fts5Available = Boolean(tables);
  } catch {
    fts5Available = false;
  }

  return new BM25Search(queryFn, fts5Available);
}

/**
 * 根据 Ollama 可用性自动组装可降级检索组件。
 * - reranker 模型可用 → BGEReranker，否则 → PassThroughReranker
 * - chat 模型可用 → OllamaQueryRewriter，否则 → RuleBasedQueryRewriter
 * - 所有组件均内置降级：3 次连续失败后自动禁用
 *
 * @param modelProvider - 模型提供者实例。
 * @returns 可插拔检索组件。
 */
async function createRetrievalComponents(modelProvider: ModelProvider): Promise<{
  queryRewriter: RuleBasedQueryRewriter | OllamaQueryRewriter;
  reranker: PassThroughReranker | BGEReranker;
  relevanceGrader: ScoreAndKeywordGrader;
  diagnostics: RetrievalDiagnosticsSnapshot;
}> {
  let rerankerAvailable = false;
  let chatAvailable = false;

  try {
    const available = await modelProvider.isAvailable();
    if (available) {
      // 检查已安装的模型列表
      const tagsResp = await fetch(`${OLLAMA_DEFAULT_BASE_URL}/api/tags`);
      if (tagsResp.ok) {
        const tags = await tagsResp.json() as { models?: Array<{ name: string }> };
        const modelNames = tags.models?.map((m) => m.name) ?? [];

        // 精确匹配 + alias 白名单
        rerankerAvailable = isModelAvailable(REQUIRED_OLLAMA_MODELS.reranker, modelNames);
        chatAvailable = isModelAvailable(REQUIRED_OLLAMA_MODELS.chat, modelNames);
      }
    }
  } catch {
    // Ollama 不可用，使用规则降级
  }

  const queryRewriter = chatAvailable
    ? new OllamaQueryRewriter()
    : new RuleBasedQueryRewriter();
  const reranker = rerankerAvailable
    ? new BGEReranker()
    : new PassThroughReranker();
  const relevanceGrader = new ScoreAndKeywordGrader();

  return {
    queryRewriter,
    reranker,
    relevanceGrader,
    diagnostics: {
      queryRewriter: {
        name: queryRewriter.constructor.name,
        fallback: queryRewriter instanceof RuleBasedQueryRewriter,
      },
      reranker: {
        name: reranker.constructor.name,
        fallback: reranker instanceof PassThroughReranker,
      },
      relevanceGrader: {
        name: relevanceGrader.constructor.name,
      },
    },
  };
}

/**
 * 创建 RunLookupStore 实现。
 * 从 agent_runs 表查找指定 session 最新的 run 信息。
 * @param db - 数据库实例。
 * @returns RunLookupStore 实现。
 */
function createRunLookupStore(db: Database): RunLookupStore {
  return {
    /**
     * 查找指定 session 最新的 run。
     * @param sessionId - 会话 ID。
     * @returns 最新 run 的 ID 和状态，或 null。
     */
    getLatestRun(sessionId: string) {
      const row = db.prepare(
        'SELECT id, status, terminal_reason FROM agent_runs WHERE session_id = ? ORDER BY started_at DESC LIMIT 1',
      ).get(sessionId) as { id: string; status: string; terminal_reason: string | null } | undefined;
      return row
        ? { runId: row.id, status: row.status, terminalReason: row.terminal_reason }
        : null;
    },
  };
}
