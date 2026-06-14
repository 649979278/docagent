/**
 * IndexWorker - 索引任务Worker线程入口
 * 处理文件解析、分块、embedding、向量存储等耗时操作
 * 不阻塞主进程和Agent对话
 */

import { parentPort } from 'node:worker_threads';
import type { AgentEventEnvelope } from '@workagent/shared';
import { IngestPipeline, DocxExtractor, PptxExtractor, PdfExtractor, TxtExtractor } from '@workagent/ingest';
import { MemoryVectorStore, OllamaEmbedder, RAGEngine } from '@workagent/rag';
import { OllamaNativeProvider, MockModelProvider } from '@workagent/model-provider';
import type { ModelProvider } from '@workagent/model-provider';
import { detectOllama } from '@workagent/windows-tools';

/** Worker接收的消息类型 */
type IndexWorkerMessage =
  | { type: 'init' }
  | { type: 'index-file'; filePath: string; documentId: string; sessionId: string }
  | { type: 'search'; query: string; topK?: number; sessionId: string }
  | { type: 'dispose' };

/** Worker发送的消息类型 */
type IndexWorkerResponse =
  | { type: 'ready' }
  | { type: 'event'; event: AgentEventEnvelope }
  | { type: 'index-result'; documentId: string; status: string; chunkCount?: number; error?: string }
  | { type: 'search-result'; query: string; results: unknown[] }
  | { type: 'error'; message: string };

/** IndexWorker运行时状态 */
let provider: ModelProvider | null = null;
let ingestPipeline: IngestPipeline | null = null;
let ragEngine: RAGEngine | null = null;
let eventSeq = 0;

/**
 * 初始化索引Worker
 */
async function initialize(): Promise<void> {
  try {
    // 1. 初始化模型提供者
    const status = await detectOllama();
    if (status.running) {
      provider = new OllamaNativeProvider();
    } else {
      provider = new MockModelProvider();
    }

    // 2. 初始化解析管道
    ingestPipeline = new IngestPipeline();
    ingestPipeline.register(new DocxExtractor());
    ingestPipeline.register(new PptxExtractor());
    ingestPipeline.register(new PdfExtractor());
    ingestPipeline.register(new TxtExtractor());

    // 3. 初始化RAG引擎
    const vectorStore = new MemoryVectorStore();
    const embedder = new OllamaEmbedder(provider);
    ragEngine = new RAGEngine(vectorStore, embedder);

    send({ type: 'ready' });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 处理文件索引请求
 */
async function handleIndexFile(filePath: string, documentId: string, sessionId: string): Promise<void> {
  if (!ingestPipeline || !ragEngine) {
    send({ type: 'index-result', documentId, status: 'failed', error: '索引引擎未初始化' });
    return;
  }

  try {
    // 1. 解析文件
    const doc = await ingestPipeline.ingest(filePath);

    // 2. 索引文档（分块+向量化+存储）
    const chunks = await ragEngine.indexDocument(doc, (progress) => {
      send({
        type: 'event',
        event: {
          sessionId,
          turnId: `index_${documentId}`,
          sequence: eventSeq++,
          type: 'index_progress',
          data: {
            job: {
              id: documentId,
              documentId,
              status: progress < 100 ? 'embedding' : 'indexed',
              progress,
              error: null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          },
          createdAt: Date.now(),
        },
      });
    });

    send({
      type: 'index-result',
      documentId,
      status: 'indexed',
      chunkCount: chunks.length,
    });
  } catch (error) {
    send({
      type: 'index-result',
      documentId,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 处理知识库搜索请求
 */
async function handleSearch(query: string, topK?: number): Promise<void> {
  if (!ragEngine) {
    send({ type: 'search-result', query, results: [] });
    return;
  }

  try {
    const results = await ragEngine.search(query, { topK: topK ?? 5 });
    send({ type: 'search-result', query, results });
  } catch {
    send({ type: 'search-result', query, results: [] });
  }
}

/**
 * 清理资源
 */
function dispose(): void {
  ingestPipeline = null;
  ragEngine = null;
  provider = null;
}

/**
 * 发送消息到主线程
 */
function send(response: IndexWorkerResponse): void {
  parentPort?.postMessage(response);
}

// 监听主线程消息
parentPort?.on('message', async (msg: IndexWorkerMessage) => {
  switch (msg.type) {
    case 'init':
      await initialize();
      break;
    case 'index-file':
      await handleIndexFile(msg.filePath, msg.documentId, msg.sessionId);
      break;
    case 'search':
      await handleSearch(msg.query, msg.topK);
      break;
    case 'dispose':
      dispose();
      break;
  }
});
