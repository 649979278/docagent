import path from 'node:path';
import type { AgentEventEnvelope, PermissionDecision, ToolSafety } from '@workagent/shared';
import type { ModelProvider, OpenAICompatConfig } from '@workagent/model-provider';
import { MockModelProvider, OllamaNativeProvider, OpenAICompatProvider } from '@workagent/model-provider';
import {
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
} from '@workagent/rag';
import { markdownToDocx } from '@workagent/docgen';
import { detectOllama, getAppDataDir } from '@workagent/windows-tools';
import { isModelAvailable, REQUIRED_OLLAMA_MODELS, OLLAMA_DEFAULT_BASE_URL } from '@workagent/shared';
import { KnowledgeService } from './services/knowledge-service.js';
import { PlanService } from './services/plan-service.js';

/** 工具权限审批策略。 */
export type PermissionApprovalPolicy = 'ask_every_time' | 'ask_dangerous' | 'full_access';

/** 工具权限请求回调。 */
export type RuntimePermissionRequestCallback = (
  toolName: string,
  input: Record<string, unknown>,
  safety: ToolSafety,
  reason: string,
) => Promise<PermissionDecision>;

/**
 * Runtime 工厂配置。
 */
export interface DesktopRuntimeFactoryOptions {
  /** 已初始化的数据库实例。 */
  db: Database;
  /** 是否自动允许交互式权限请求。 */
  autoApprovePermissions?: boolean;
  /** 用户选择的工具权限审批策略。 */
  permissionPolicy?: PermissionApprovalPolicy;
  /** 真实权限请求回调，用于每次询问或危险操作询问。 */
  permissionRequestCallback?: RuntimePermissionRequestCallback;
  /** 打开兼容模型配置的回调。 */
  getOpenAICompatConfig?: () => OpenAICompatConfig | null;
  /** 事件回调，用于透传计划控制器或索引进度事件。 */
  emitEvent?: (event: AgentEventEnvelope) => void;
  /** 应用数据目录，用于落盘 transcript / session memory。 */
  appDataDir?: string;
  /** 测试或特殊场景注入的模型提供者。 */
  modelProvider?: ModelProvider;
  /** 测试或诊断场景覆盖检索组件。 */
  retrievalComponentsOverride?: Partial<{
    queryRewriter: RuleBasedQueryRewriter | OllamaQueryRewriter;
    reranker: PassThroughReranker | BGEReranker;
    relevanceGrader: ScoreAndKeywordGrader;
  }>;
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
  /** 知识库应用服务。 */
  knowledgeService: KnowledgeService;
  /** 计划应用服务。 */
  planService: PlanService;
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
  const modelProvider = options.modelProvider ?? await createModelProvider(options.getOpenAICompatConfig);
  const ingestPipeline = createIngestPipeline();
  const vectorStore = await createVectorStore(appDataDir);
  const embedder = new OllamaEmbedder(modelProvider);

  // 构造 BM25Search（注入 queryFn，由数据库驱动）
  const bm25Search = createBM25Search(options.db);

  // 根据 Ollama 可用性组装可降级检索组件
  const components = options.modelProvider
    ? createMockRetrievalComponents()
    : await createRetrievalComponents(modelProvider);
  const retrievalComponents = {
    ...components,
    ...options.retrievalComponentsOverride,
  };
  retrievalComponents.diagnostics = createRetrievalDiagnostics(
    retrievalComponents.queryRewriter,
    retrievalComponents.reranker,
    retrievalComponents.relevanceGrader,
  );

  // 构造 RAGEngine（options object 模式）
  const ragEngine = new RAGEngine({
    index: vectorStore,
    embedder,
    components: {
      sparseSearcher: bm25Search,
      ...retrievalComponents,
    },
  });
  const permissionBroker = createPermissionBroker(
    options.db,
    options.permissionPolicy ?? (options.autoApprovePermissions ? 'full_access' : 'ask_every_time'),
    options.permissionRequestCallback,
  );
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

  const knowledgeService = new KnowledgeService({
    db: options.db,
    ingestPipeline,
    ragEngine,
    modelProvider,
  });

  registerTools(registry, {
    db: options.db,
    modelProvider,
    ingestPipeline,
    ragEngine,
    knowledgeService,
    retrievalDiagnostics: retrievalComponents.diagnostics,
    emitEvent: options.emitEvent,
  });

  const runtime = new AgentRuntime(modelProvider, registry, executor, options.db, {
    ragSearchProvider: ragEngine,
    transcriptDir: path.join(appDataDir, 'transcripts'),
    sessionMemoryDir: path.join(appDataDir, 'session-memory'),
  });
  const planService = new PlanService({ db: options.db, runtime });

  planBridgeOptions = {
    db: options.db,
    runtime,
    emitEvent: options.emitEvent,
    retrievalDiagnostics: components.diagnostics,
  };
  bindPlanPersistenceBridge(planBridgeOptions);
  bindPlanControllerEvents(runtime, options.emitEvent);
  await knowledgeService.reconcileDeletedKnowledge();

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
    knowledgeService,
    planService,
    resumeSession: (sessionId: string) => resumeSession(sessionId, transcriptDir, runLookup),
    retrievalDiagnostics: retrievalComponents.diagnostics,
  };
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
  const db = options?.db ?? initDatabase({
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
  const compatConfig = getOpenAICompatConfig?.() ?? null;
  if (status.running) {
    return new OllamaNativeProvider(compatConfig ? {
      chatModel: compatConfig.chatModel,
      embeddingModel: compatConfig.embeddingModel,
      baseUrl: compatConfig.baseUrl,
      temperature: compatConfig.temperature,
      maxTokens: compatConfig.maxTokens,
    } : undefined);
  }

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
function createPermissionBroker(
  db: Database,
  policy: PermissionApprovalPolicy,
  permissionRequestCallback?: RuntimePermissionRequestCallback,
): PermissionBroker {
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

  if (policy === 'full_access') {
    broker.setRequestCallback(async () => ({ allowed: true, remember: false, reason: '完全访问权限：自动授权' }));
  } else if (policy === 'ask_dangerous') {
    broker.setRequestCallback(async (toolName, input, safety, reason) => {
      const dangerous = safety === 'overwrite_output' || safety === 'command' || safety === 'destructive';
      if (dangerous && permissionRequestCallback) {
        return permissionRequestCallback(toolName, input, safety, reason);
      }
      return {
        allowed: !dangerous,
        remember: false,
        reason: dangerous ? reason || '危险操作需要用户批准' : '仅危险询问：非危险操作自动允许',
      };
    });
  } else if (permissionRequestCallback) {
    broker.setRequestCallback(permissionRequestCallback);
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
    knowledgeService: KnowledgeService;
    retrievalDiagnostics: RetrievalDiagnosticsSnapshot;
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
      const result = await deps.knowledgeService.addDocument(filePath);
      if (result.status === 'failed' || !result.documentId) {
        throw new Error(result.error ?? '知识库索引失败');
      }
      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const job = createIndexJob(deps.db, { id: jobId, documentId: result.documentId });
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
  if (deps.emitEvent) {
    const ragSearchTool = registry.getTool('rag_search');
    const originalCall = ragSearchTool?.call.bind(ragSearchTool);
    if (ragSearchTool && originalCall) {
      ragSearchTool.call = async (input, context) => {
        const result = await originalCall(input, context);
        deps.emitEvent?.({
          sessionId: context.sessionId,
          turnId: '',
          sequence: Date.now(),
          type: 'rag_diagnostics',
          data: { diagnostics: deps.retrievalDiagnostics },
          createdAt: Date.now(),
          source: 'runtime',
        } as AgentEventEnvelope);
        return result;
      };
    }
  }
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
    } else if (event.type === 'plan_cancelled') {
      emitEvent({
        ...base,
        type: 'mode_change',
        data: { mode: 'chat' },
      });
      emitEvent({
        ...base,
        type: 'phase_change',
        data: { phase: 'PLAN_COLLECT' },
      });
    }
  });
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
    diagnostics: createRetrievalDiagnostics(queryRewriter, reranker, relevanceGrader),
  };
}

/**
 * 创建可反映实时 fallback 状态的检索诊断快照。
 * @param queryRewriter - 查询重写器。
 * @param reranker - 重排器。
 * @param relevanceGrader - 相关性评分器。
 * @returns 检索组件诊断对象。
 */
function createRetrievalDiagnostics(
  queryRewriter: RuleBasedQueryRewriter | OllamaQueryRewriter,
  reranker: PassThroughReranker | BGEReranker,
  relevanceGrader: ScoreAndKeywordGrader,
): RetrievalDiagnosticsSnapshot {
  return {
      queryRewriter: {
        name: queryRewriter.constructor.name,
        get fallback() {
          return queryRewriter.getDiagnostics?.().fallback ?? queryRewriter instanceof RuleBasedQueryRewriter;
        },
      },
      reranker: {
        name: reranker.constructor.name,
        get fallback() {
          return reranker.getDiagnostics?.().fallback ?? reranker instanceof PassThroughReranker;
        },
      },
      relevanceGrader: {
        name: relevanceGrader.constructor.name,
      },
  };
}

/**
 * 创建测试注入模型时使用的快速检索组件，避免普通 E2E 探测真实 Ollama。
 * @returns 可插拔检索组件。
 */
function createMockRetrievalComponents(): {
  queryRewriter: RuleBasedQueryRewriter;
  reranker: PassThroughReranker;
  relevanceGrader: ScoreAndKeywordGrader;
  diagnostics: RetrievalDiagnosticsSnapshot;
} {
  const queryRewriter = new RuleBasedQueryRewriter();
  const reranker = new PassThroughReranker();
  const relevanceGrader = new ScoreAndKeywordGrader();
  return {
    queryRewriter,
    reranker,
    relevanceGrader,
    diagnostics: createRetrievalDiagnostics(queryRewriter, reranker, relevanceGrader),
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
