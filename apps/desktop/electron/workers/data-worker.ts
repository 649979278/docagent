/**
 * DataWorker - 数据库操作Worker线程入口
 * 将SQLite的长事务、migration、批量写入移入Worker
 * 避免主进程阻塞
 */

import { parentPort } from 'node:worker_threads';
import {
  initDatabase,
  closeDatabase,
  createSession,
  listSessions,
  deleteSession,
  getSession,
  updateSession,
  createMessage,
  createMessagesBatch,
  getSessionMessages,
  getRecentMessages,
  createPlan,
  getPlan,
  getActivePlanBySession,
  approvePlan as approvePlanDb,
  createDocument,
  getDocumentByPath,
  updateDocument,
  createIndexJob,
  updateIndexJob,
  createMemory,
  getEnabledMemories,
  listMemories,
  savePermissionDecision,
  loadAllPermissionDecisions,
  getSetting,
  setSetting,
} from '@workagent/store';
import type { Database } from '@workagent/store';

/** Worker接收的消息类型 */
type DataWorkerMessage =
  | { type: 'init'; dbPath?: string }
  | { type: 'dispose' }
  | { type: 'save' }
  | { type: 'session-create'; params: { id: string; title: string; mode?: string } }
  | { type: 'session-list'; limit?: number }
  | { type: 'session-delete'; sessionId: string }
  | { type: 'session-get'; sessionId: string }
  | { type: 'session-update'; sessionId: string; updates: Record<string, unknown> }
  | { type: 'messages-create'; params: Record<string, unknown> }
  | { type: 'messages-get'; sessionId: string; limit?: number }
  | { type: 'messages-recent'; sessionId: string; count?: number }
  | { type: 'plan-create'; params: Record<string, unknown> }
  | { type: 'plan-get'; planId: string }
  | { type: 'plan-approve'; planId: string; updatedOutlineJson?: string }
  | { type: 'document-create'; params: Record<string, unknown> }
  | { type: 'document-get-by-path'; filePath: string }
  | { type: 'document-update'; docId: string; updates: Record<string, unknown> }
  | { type: 'index-job-create'; params: Record<string, unknown> }
  | { type: 'index-job-update'; jobId: string; updates: Record<string, unknown> }
  | { type: 'memory-create'; params: Record<string, unknown> }
  | { type: 'memory-list' }
  | { type: 'memory-enabled' }
  | { type: 'permission-save'; record: Record<string, unknown> }
  | { type: 'permission-list' }
  | { type: 'setting-get'; key: string; defaultValue?: unknown }
  | { type: 'setting-set'; key: string; value: unknown };

/** Worker发送的消息类型 */
type DataWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; requestId: string; data: unknown }
  | { type: 'error'; requestId: string; message: string };

/** DataWorker运行时状态 */
let db: Database | null = null;
let requestId = 0;

/**
 * 初始化数据库
 */
async function initialize(dbPath?: string): Promise<void> {
  try {
    db = await initDatabase({
      dbPath,
      log: (msg: string) => console.log('[DataWorker]', msg),
    });
    send({ type: 'ready' });
  } catch (error) {
    send({ type: 'error', requestId: 'init', message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 保存数据库到磁盘
 */
function saveDb(): void {
  if (db) {
    db.save();
  }
}

/**
 * 处理数据库操作
 */
function handleMessage(msg: DataWorkerMessage): void {
  if (!db && msg.type !== 'init') {
    send({ type: 'error', requestId: String(requestId++), message: '数据库未初始化' });
    return;
  }

  const id = String(requestId++);

  try {
    switch (msg.type) {
      case 'init':
        initialize(msg.dbPath);
        break;

      case 'dispose':
        if (db) {
          closeDatabase(db);
          db = null;
        }
        break;

      case 'save':
        saveDb();
        send({ type: 'result', requestId: id, data: { saved: true } });
        break;

      case 'session-create': {
        const session = createSession(db!, msg.params as any);
        send({ type: 'result', requestId: id, data: session });
        break;
      }

      case 'session-list': {
        const sessions = listSessions(db!, msg.limit);
        send({ type: 'result', requestId: id, data: sessions });
        break;
      }

      case 'session-delete': {
        deleteSession(db!, msg.sessionId);
        send({ type: 'result', requestId: id, data: { success: true } });
        break;
      }

      case 'session-get': {
        const session = getSession(db!, msg.sessionId);
        send({ type: 'result', requestId: id, data: session });
        break;
      }

      case 'session-update': {
        updateSession(db!, msg.sessionId, msg.updates as any);
        send({ type: 'result', requestId: id, data: { success: true } });
        break;
      }

      case 'messages-create': {
        const msgRecord = createMessage(db!, msg.params as any);
        send({ type: 'result', requestId: id, data: msgRecord });
        break;
      }

      case 'messages-get': {
        const messages = getSessionMessages(db!, msg.sessionId, msg.limit);
        send({ type: 'result', requestId: id, data: messages });
        break;
      }

      case 'messages-recent': {
        const messages = getRecentMessages(db!, msg.sessionId, msg.count);
        send({ type: 'result', requestId: id, data: messages });
        break;
      }

      case 'plan-create': {
        const plan = createPlan(db!, msg.params as any);
        send({ type: 'result', requestId: id, data: plan });
        break;
      }

      case 'plan-get': {
        const plan = getPlan(db!, msg.planId);
        send({ type: 'result', requestId: id, data: plan });
        break;
      }

      case 'plan-approve': {
        approvePlanDb(db!, msg.planId, msg.updatedOutlineJson);
        send({ type: 'result', requestId: id, data: { success: true } });
        break;
      }

      case 'document-create': {
        const doc = createDocument(db!, msg.params as any);
        send({ type: 'result', requestId: id, data: doc });
        break;
      }

      case 'document-get-by-path': {
        const doc = getDocumentByPath(db!, msg.filePath);
        send({ type: 'result', requestId: id, data: doc });
        break;
      }

      case 'document-update': {
        updateDocument(db!, msg.docId, msg.updates as any);
        send({ type: 'result', requestId: id, data: { success: true } });
        break;
      }

      case 'index-job-create': {
        const job = createIndexJob(db!, msg.params as any);
        send({ type: 'result', requestId: id, data: job });
        break;
      }

      case 'index-job-update': {
        updateIndexJob(db!, msg.jobId, msg.updates as any);
        send({ type: 'result', requestId: id, data: { success: true } });
        break;
      }

      case 'memory-create': {
        const memory = createMemory(db!, msg.params as any);
        send({ type: 'result', requestId: id, data: memory });
        break;
      }

      case 'memory-list': {
        const memories = listMemories(db!);
        send({ type: 'result', requestId: id, data: memories });
        break;
      }

      case 'memory-enabled': {
        const memories = getEnabledMemories(db!);
        send({ type: 'result', requestId: id, data: memories });
        break;
      }

      case 'permission-save': {
        savePermissionDecision(db!, msg.record as any);
        send({ type: 'result', requestId: id, data: { success: true } });
        break;
      }

      case 'permission-list': {
        const permissions = loadAllPermissionDecisions(db!);
        send({ type: 'result', requestId: id, data: permissions });
        break;
      }

      case 'setting-get': {
        const value = getSetting(db!, msg.key, msg.defaultValue);
        send({ type: 'result', requestId: id, data: value });
        break;
      }

      case 'setting-set': {
        setSetting(db!, msg.key, msg.value);
        send({ type: 'result', requestId: id, data: { success: true } });
        break;
      }
    }
  } catch (error) {
    send({ type: 'error', requestId: id, message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 发送消息到主线程
 */
function send(response: DataWorkerResponse): void {
  parentPort?.postMessage(response);
}

// 监听主线程消息
parentPort?.on('message', handleMessage);
