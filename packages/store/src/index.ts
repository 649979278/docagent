/**
 * @workagent/store - 持久化层入口
 */

export { initDatabase, closeDatabase, getDefaultDbPath, Database, Statement } from './database.js';
export type { DatabaseConfig } from './database.js';

export { createSession, getSession, listSessions, updateSession, deleteSession, searchSessions } from './sessions.js';
export type { SessionRecord, CreateSessionParams } from './sessions.js';

export { createMessage, createMessagesBatch, getSessionMessages, getRecentMessages, deleteMessagesBeforeCompactBoundary, searchMessages, getMessageCount } from './messages.js';
export type { MessageRecord, CreateMessageParams } from './messages.js';

export { createPlan, getPlan, getActivePlanBySession, updatePlan, approvePlan, listPlansBySession } from './plans.js';
export type { PlanRecord, CreatePlanParams } from './plans.js';

export { createDocument, getDocument, getDocumentByPath, updateDocument, listDocuments, deleteDocument } from './documents.js';
export type { DocumentRecord, CreateDocumentParams } from './documents.js';

export { createChunk, createChunksBatch, getChunksByDocument, getChunk, updateChunkVectorId, deleteChunksByDocument } from './chunks.js';
export type { ChunkRecord, CreateChunkParams } from './chunks.js';

export { createIndexJob, getIndexJob, getIndexJobByDocument, updateIndexJob, listPendingIndexJobs, deleteIndexJob } from './index-jobs.js';
export type { IndexJobRecord, CreateIndexJobParams } from './index-jobs.js';

export { createMemory, getEnabledMemories, listMemories, updateMemory, deleteMemory } from './memories.js';
export type { MemoryRecord, CreateMemoryParams } from './memories.js';

export { savePermissionDecision, getPermissionDecision, loadAllPermissionDecisions, removePermissionDecision, isPermissionPersisted } from './permissions.js';
export type { PermissionRecord } from './permissions.js';

export { getSetting, setSetting, listSettings, deleteSetting } from './settings.js';
export type { SettingRecord } from './settings.js';

export { migrations } from './migrations/001_initial.js';
