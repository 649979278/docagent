/**
 * AgentWorker - Agent运行时Worker线程入口
 * 在独立线程中运行AgentRuntime，避免阻塞主进程
 * 主进程通过MessagePort与AgentWorker通信
 */

import { parentPort, workerData } from 'node:worker_threads';
import type { AgentEventEnvelope, AgentMode } from '@workagent/shared';
import { AgentRuntime, SessionOrchestrator } from '@workagent/agent-core';
import { ToolRegistry, ToolExecutor, PermissionBroker } from '@workagent/tools';
import { OllamaNativeProvider, MockModelProvider } from '@workagent/model-provider';
import type { ModelProvider } from '@workagent/model-provider';
import { initDatabase, closeDatabase } from '@workagent/store';
import type { Database } from '@workagent/store';
import { IngestPipeline, DocxExtractor, PptxExtractor, PdfExtractor, TxtExtractor } from '@workagent/ingest';
import { MemoryVectorStore, OllamaEmbedder, RAGEngine } from '@workagent/rag';
import { detectOllama } from '@workagent/windows-tools';

/** Worker接收的消息类型 */
type AgentWorkerMessage =
  | { type: 'init' }
  | { type: 'chat'; message: string; sessionId: string; mode?: AgentMode }
  | { type: 'abort' }
  | { type: 'plan-approve'; planId: string; approved: boolean }
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
let provider: ModelProvider | null = null;
let runtime: AgentRuntime | null = null;
let currentIterator: AsyncGenerator<AgentEventEnvelope> | null = null;

/**
 * 初始化Agent运行时
 */
async function initialize(): Promise<void> {
  try {
    // 1. 初始化数据库
    db = await initDatabase({
      log: (msg: string) => send({ type: 'event', event: { sessionId: '', turnId: '', sequence: 0, type: 'error', data: { code: 'LOG', message: msg, recoverable: true }, createdAt: Date.now() } }),
    });

    // 2. 初始化模型提供者
    const status = await detectOllama();
    if (status.running) {
      provider = new OllamaNativeProvider();
    } else {
      provider = new MockModelProvider();
    }

    // 3. 初始化工具和运行时
    const registry = new ToolRegistry();
    const ingestPipeline = new IngestPipeline();
    ingestPipeline.register(new DocxExtractor());
    ingestPipeline.register(new PptxExtractor());
    ingestPipeline.register(new PdfExtractor());
    ingestPipeline.register(new TxtExtractor());

    const vectorStore = new MemoryVectorStore();
    const embedder = new OllamaEmbedder(provider);
    const ragEngine = new RAGEngine(vectorStore, embedder);

    const permissionBroker = new PermissionBroker({
      saveDecision() {},
      loadDecisions() { return []; },
      removeDecision() {},
    });
    permissionBroker.setRequestCallback(async () => ({ allowed: true, reason: '自动授权' }));

    const executor = new ToolExecutor(registry, permissionBroker);

    runtime = new AgentRuntime(provider, registry, executor, db);

    send({ type: 'ready' });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 处理对话请求
 */
async function handleChat(message: string, sessionId: string, mode?: AgentMode): Promise<void> {
  if (!runtime) {
    send({ type: 'chat-result', success: false, error: 'AgentRuntime未初始化' });
    return;
  }

  try {
    const effectiveMode = mode ?? 'chat';
    const iterator = runtime.runTurn(sessionId, message, effectiveMode);
    currentIterator = iterator;

    for await (const event of iterator) {
      send({ type: 'event', event });
    }

    currentIterator = null;
    send({ type: 'chat-result', success: true });
  } catch (error) {
    currentIterator = null;
    send({ type: 'chat-result', success: false, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 中断当前对话
 */
function handleAbort(): void {
  if (currentIterator) {
    currentIterator.return?.(undefined);
    currentIterator = null;
  }
}

/**
 * 批准计划
 */
function handlePlanApprove(planId: string, approved: boolean): void {
  if (!runtime) return;
  if (approved) {
    runtime.getPlanController().approvePlan();
  } else {
    runtime.getPlanController().cancelPlan();
  }
}

/**
 * 取消计划
 */
function handlePlanCancel(): void {
  if (!runtime) return;
  runtime.getPlanController().cancelPlan();
}

/**
 * 清理资源
 */
function dispose(): void {
  handleAbort();
  runtime = null;
  if (db) {
    closeDatabase(db);
    db = null;
  }
}

/**
 * 发送消息到主线程
 */
function send(response: AgentWorkerResponse): void {
  parentPort?.postMessage(response);
}

// 监听主线程消息
parentPort?.on('message', async (msg: AgentWorkerMessage) => {
  switch (msg.type) {
    case 'init':
      await initialize();
      break;
    case 'chat':
      await handleChat(msg.message, msg.sessionId, msg.mode);
      break;
    case 'abort':
      handleAbort();
      break;
    case 'plan-approve':
      handlePlanApprove(msg.planId, msg.approved);
      break;
    case 'plan-cancel':
      handlePlanCancel();
      break;
    case 'dispose':
      dispose();
      break;
  }
});
