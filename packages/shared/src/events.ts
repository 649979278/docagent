/**
 * IPC事件协议 - 跨前后端共享的事件定义
 * 所有事件统一使用AgentEventEnvelope信封格式
 * 事件必须包含sessionId/turnId/sequence，支持断线恢复
 */

import type {
  AgentMode,
  Plan,
  PlanPhase,
  PlanStep,
  IndexJob,
  RetrievedChunk,
} from './types.js';

// ============================================================
// 事件信封
// ============================================================

/** 统一事件信封 */
export interface AgentEventEnvelope<T = unknown> {
  sessionId: string;
  turnId: string;
  sequence: number;
  type: AgentEventType;
  data: T;
  createdAt: number;
}

/** 所有事件类型 */
export type AgentEventType =
  // 流式文本
  | 'token'
  | 'thinking'
  // 工具执行
  | 'tool_start'
  | 'tool_result'
  // 计划模式
  | 'plan_generated'
  | 'plan_step_update'
  | 'mode_change'
  | 'phase_change'
  // 上下文管理
  | 'compact'
  | 'citation'
  | 'rag_enrich'
  // 权限
  | 'permission_request'
  | 'permission_result'
  // 索引
  | 'index_progress'
  // 草稿和输出
  | 'draft_ready'
  | 'doc_ready'
  // 模型
  | 'model_pull_progress'
  // 终止
  | 'done'
  // 错误
  | 'error'
  | 'recoverable_error';

// ============================================================
// 事件数据类型
// ============================================================

/** token事件数据 */
export interface TokenEventData {
  text: string;
}

/** thinking事件数据 */
export interface ThinkingEventData {
  text: string;
}

/** tool_start事件数据 */
export interface ToolStartEventData {
  name: string;
  input: Record<string, unknown>;
}

/** tool_result事件数据 */
export interface ToolResultEventData {
  name: string;
  output: unknown;
  isError?: boolean;
  summary?: string; // 工具结果的短摘要（压缩时替代完整输出）
}

/** plan_generated事件数据 */
export interface PlanGeneratedEventData {
  plan: Plan;
}

/** plan_step_update事件数据 */
export interface PlanStepUpdateEventData {
  step: PlanStep;
}

/** mode_change事件数据 */
export interface ModeChangeEventData {
  mode: AgentMode;
}

/** phase_change事件数据 */
export interface PhaseChangeEventData {
  phase: PlanPhase;
}

/** compact事件数据 */
export interface CompactEventData {
  level: number;
  strategy: 'micro' | 'summary';
  freedTokens: number;
}

/** citation事件数据 */
export interface CitationEventData {
  chunk: RetrievedChunk;
}

/** rag_enrich事件数据 - RAG自动上下文增强 */
export interface RagEnrichEventData {
  /** 触发检索的查询文本（截取前100字） */
  query: string;
  /** 是否成功注入了RAG上下文 */
  injected: boolean;
}

/** permission_request事件数据 */
export interface PermissionRequestEventData {
  toolName: string;
  input: Record<string, unknown>;
  safety: string;
  reason: string;
}

/** permission_result事件数据 */
export interface PermissionResultEventData {
  toolName: string;
  allowed: boolean;
  remember?: boolean;
}

/** index_progress事件数据 */
export interface IndexProgressEventData {
  job: IndexJob;
}

/** draft_ready事件数据 */
export interface DraftReadyEventData {
  content: string;   // Markdown格式草稿
  format: 'markdown';
}

/** doc_ready事件数据 */
export interface DocReadyEventData {
  filePath: string;
}

/** model_pull_progress事件数据 */
export interface ModelPullProgressEventData {
  model: string;
  status: 'pulling' | 'success' | 'failed';
  progress: number;  // 0-100
  message?: string;
}

/** error事件数据 */
export interface ErrorEventData {
  code: string;
  message: string;
  recoverable: boolean;
}

/** recoverable_error事件数据 */
export interface RecoverableErrorEventData {
  code: string;
  message: string;
  retryable: boolean;
}

// ============================================================
// 事件数据联合类型
// ============================================================

/** 所有事件数据的映射 */
export interface AgentEventDataMap {
  token: TokenEventData;
  thinking: ThinkingEventData;
  tool_start: ToolStartEventData;
  tool_result: ToolResultEventData;
  plan_generated: PlanGeneratedEventData;
  plan_step_update: PlanStepUpdateEventData;
  mode_change: ModeChangeEventData;
  phase_change: PhaseChangeEventData;
  compact: CompactEventData;
  citation: CitationEventData;
  rag_enrich: RagEnrichEventData;
  permission_request: PermissionRequestEventData;
  permission_result: PermissionResultEventData;
  index_progress: IndexProgressEventData;
  draft_ready: DraftReadyEventData;
  doc_ready: DocReadyEventData;
  model_pull_progress: ModelPullProgressEventData;
  done: null;
  error: ErrorEventData;
  recoverable_error: RecoverableErrorEventData;
}

/** 类型安全的事件 */
export type AgentEvent<T extends AgentEventType = AgentEventType> =
  AgentEventEnvelope<AgentEventDataMap[T]>;

// ============================================================
// Renderer → Main 请求
// ============================================================

/** Renderer向Main发送的请求类型 */
export type RendererRequest =
  | { type: 'chat'; data: { message: string; sessionId: string; mode?: AgentMode } }
  | { type: 'plan_mode'; data: { enabled: boolean; sessionId: string } }
  | { type: 'plan_approve'; data: { planId: string; approved: boolean; sessionId: string } }
  | { type: 'knowledge_add'; data: { filePaths: string[]; sessionId: string } }
  | { type: 'knowledge_search'; data: { query: string; topK?: number } }
  | { type: 'permission_response'; data: { toolName: string; allowed: boolean; remember?: boolean } }
  | { type: 'settings_update'; data: Record<string, unknown> }
  | { type: 'session_create'; data: { title?: string } }
  | { type: 'session_list'; data: {} }
  | { type: 'session_delete'; data: { sessionId: string } }
  | { type: 'models_status'; data: {} };
