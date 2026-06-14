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
  /** 事件协议版本 */
  schemaVersion?: string;
  /** 关联的 run ID */
  runId?: string;
  /** 事件来源 */
  source?: 'runtime' | 'worker' | 'indexer';
}

/** 所有事件类型 */
export type AgentEventType =
  // 流式文本
  | 'token'
  | 'thinking'
  // 工具执行
  | 'tool_start'
  | 'tool_result'
  | 'tool_summary'
  // 计划模式
  | 'plan_generated'
  | 'plan_approved'
  | 'plan_step_update'
  | 'mode_change'
  | 'mode_suggestion'
  | 'phase_change'
  // 上下文管理
  | 'compact'
  | 'compact_boundary'
  | 'recovery'
  | 'citation'
  | 'rag_enrich'
  | 'rag_diagnostics'
  // 权限
  | 'permission_request'
  | 'permission_result'
  // 索引
  | 'index_progress'
  // 运行状态
  | 'run_status'
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
  /** 注入的chunk数 */
  chunkCount?: number;
  /** 使用的token数 */
  usedTokens?: number;
  /** 触发原因 */
  triggerReason?: 'keyword' | 'always_in_plan' | 'none';
}

/** rag_diagnostics 事件数据 - 当前检索链路组件诊断 */
export interface RagDiagnosticsEventData {
  diagnostics: {
    queryRewriter: {
      name: string;
      fallback: boolean;
    };
    reranker: {
      name: string;
      fallback: boolean;
    };
    relevanceGrader: {
      name: string;
    };
  };
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

/** compact_boundary事件数据 */
export interface CompactBoundaryEventData {
  boundaryId: string;
  strategy: 'micro' | 'summary' | 'reactive';
  freedTokens: number;
}

/** recovery事件数据 - 压缩后恢复 */
export interface RecoveryEventData {
  /** 记忆是否注入 */
  memoryInjected: boolean;
  /** RAG 引用是否重水合 */
  ragRehydrated: boolean;
  /** 计划摘要是否注入 */
  planInjected: boolean;
  /** 恢复使用的总 token 数 */
  totalRecoveryTokens: number;
}

/** tool_summary事件数据 */
export interface ToolSummaryEventData {
  toolName: string;
  callId: string;
  summary: string;
  retention: 'full' | 'summary' | 'drop_after_turn';
}

/** run_status事件数据 */
export interface RunStatusEventData {
  runId: string;
  status: 'running' | 'completed' | 'aborted' | 'failed';
  terminalReason?: string;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

/** mode_suggestion事件数据 - 自动检测到复杂任务时建议切换模式 */
export interface ModeSuggestionEventData {
  suggestedMode: AgentMode;
  reason: string;
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
  tool_summary: ToolSummaryEventData;
  plan_generated: PlanGeneratedEventData;
  plan_approved: PlanGeneratedEventData;
  plan_step_update: PlanStepUpdateEventData;
  mode_change: ModeChangeEventData;
  mode_suggestion: ModeSuggestionEventData;
  phase_change: PhaseChangeEventData;
  compact: CompactEventData;
  compact_boundary: CompactBoundaryEventData;
  recovery: RecoveryEventData;
  citation: CitationEventData;
  rag_enrich: RagEnrichEventData;
  rag_diagnostics: RagDiagnosticsEventData;
  permission_request: PermissionRequestEventData;
  permission_result: PermissionResultEventData;
  index_progress: IndexProgressEventData;
  run_status: RunStatusEventData;
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
