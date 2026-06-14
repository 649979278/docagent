/**
 * 核心类型定义 - 跨前后端共享
 * 包含Agent模式、工具安全级别、消息、计划、会话等核心数据模型
 */

// ============================================================
// Agent模式
// ============================================================

/** Agent运行模式 */
export type AgentMode = 'chat' | 'plan' | 'execute';

/** Plan模式阶段 - 公文写作领域化 */
export type PlanPhase =
  | 'PLAN_COLLECT'    // 收集文种、对象、单位、材料、篇幅、风格
  | 'PLAN_RESEARCH'   // 只读检索和材料研读
  | 'PLAN_DRAFT'      // 生成计划和提纲
  | 'PLAN_REVIEW'     // 用户审查/编辑/批准
  | 'EXECUTE_DRAFT'   // 生成Markdown草稿
  | 'EXECUTE_EXPORT'; // 用户确认后导出docx

// ============================================================
// 工具系统
// ============================================================

/** 工具安全级别 */
export type ToolSafety =
  | 'read_only'         // 自动允许
  | 'write_index'       // 首次确认，可持久化
  | 'write_output'      // 首次确认，可持久化
  | 'overwrite_output'  // 每次确认，不可持久化
  | 'command'           // 每次确认
  | 'destructive';      // 每次确认

/** 工具可用模式 */
export type ToolMode = 'both' | 'chat' | 'plan' | 'execute';

/** 权限决策 */
export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
  remember?: boolean; // 是否持久化此决策
}

/** 工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 工具执行上下文 */
export interface ToolContext {
  sessionId: string;
  mode: AgentMode;
  permissions: Record<string, string>; // toolName → decision
}

// ============================================================
// 消息系统
// ============================================================

/** 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 消息事件类型 */
export type MessageEventType =
  | 'text'
  | 'tool_call'
  | 'tool_result'
  | 'compact_boundary'
  | 'summary';

/** 对话消息 */
export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  eventType?: MessageEventType;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string; // tool角色消息对应的工具名称（Ollama需要此字段）
  tokenCount: number;
  compactBoundaryId?: string; // 压缩边界标记
  timestamp: number;
}

/** 用户输入 */
export interface UserInput {
  content: string;
  attachments?: Attachment[];
  mode?: AgentMode;
}

/** 附件 */
export interface Attachment {
  type: 'file' | 'image';
  path: string;
  name: string;
}

// ============================================================
// 计划系统
// ============================================================

/** 计划状态 */
export type PlanStatus = 'draft' | 'approved' | 'executing' | 'completed' | 'cancelled';

/** 计划步骤 */
export interface PlanStep {
  id: string;
  description: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
}

/** 计划提纲 */
export interface PlanOutline {
  title: string;
  goal: string;
  materialBasis: string;       // 材料依据
  structure: PlanStep[];       // 结构提纲
  expectedOutput: string;      // 预计输出
  risks: string[];             // 风险提醒
  questions: string[];         // 需要用户确认的点
  citations: string[];         // 引用的chunk ID
}

/** 计划 */
export interface Plan {
  id: string;
  sessionId: string;
  status: PlanStatus;
  title: string;
  goal: string;
  outline: PlanOutline;
  approvedAt?: number;
  finalDocPath?: string;
  createdAt: number;
}

// ============================================================
// 会话上下文
// ============================================================

/** 会话上下文 */
export interface ConversationContext {
  sessionId: string;
  mode: AgentMode;
  planPhase: PlanPhase;
  activePlanId: string | null;
  knowledgeBaseIds: string[];
  activeFiles: string[];
  permissions: Record<string, string>;
}

/** Agent循环状态 */
export interface AgentState {
  messages: Message[];
  context: ConversationContext;
  tokenCount: number;
  compactCount: number;
}

// ============================================================
// RAG相关类型
// ============================================================

/** 文档块元数据 */
export interface ChunkMetadata {
  sourceFile: string;
  sourceType: string;   // docx/pptx/pdf/txt/md
  chunkIndex: number;
  locator: string;      // 页码/幻灯片/段落定位
  title?: string;
  department?: string;
  contentHash: string;  // SHA-256
}

/** 检索结果片段 */
export interface RetrievedChunk {
  content: string;
  sourceFile: string;
  sourceType: string;
  locator: string;      // 页码/幻灯片/段落
  score: number;
  chunkId: string;
}

/** 检索选项 */
export interface SearchOptions {
  topK?: number;        // 默认5
  metadataFilter?: Record<string, unknown>;
  minScore?: number;
  budgetTokens?: number; // 上下文预算限制
}

/** 文档解析结果 */
export interface ExtractedDocument {
  filePath: string;
  fileName: string;
  fileType: string;
  content: string;      // 解析后的纯文本/Markdown
  sections: DocumentSection[];
  metadata: Record<string, unknown>;
}

/** 文档章节 */
export interface DocumentSection {
  title: string;
  content: string;
  level: number;        // 标题层级
  locator: string;      // 页码/幻灯片编号
}

// ============================================================
// 模型相关类型
// ============================================================

/** 模型信息 */
export interface ModelInfo {
  name: string;
  size: number;         // 字节
  family: string;
  parameterSize: string;
  quantizationLevel: string;
  contextLength?: number;
}

/** 模型配置 */
export interface ModelConfig {
  chatModel: string;       // 默认qwen3.5:9b
  embeddingModel: string;  // 默认bge-m3
  baseUrl: string;         // 默认http://localhost:11434
  lanBaseUrl?: string;     // 局域网地址(可选)
  temperature: number;
  maxTokens: number;
}

// ============================================================
// 索引任务
// ============================================================

/** 索引任务状态 */
export type IndexJobStatus =
  | 'queued'
  | 'hashing'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'indexing'
  | 'indexed'
  | 'failed';

/** 索引任务 */
export interface IndexJob {
  id: string;
  documentId: string;
  status: IndexJobStatus;
  progress: number;     // 0-100
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

// ============================================================
// 显式记忆
// ============================================================

/** 记忆类型 */
export type MemoryType =
  | 'user_requirement'     // 用户明确要求
  | 'style_preference'     // 风格偏好
  | 'format_constraint'    // 格式约束
  | 'banned_expression'    // 禁用表达
  | 'custom_terminology';  // 自定义术语

/** 显式记忆 */
export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  source: string;       // 会话ID或手动添加
  enabled: boolean;
  createdAt: number;
}

// ============================================================
// 上下文预算
// ============================================================

/** 上下文预算分配 */
export interface ContextBudget {
  systemPrompt: number;
  conversationHistory: number;
  ragResults: number;
  toolResults: number;
  maxCompletionTokens: number;
  total: number;
}

// ============================================================
// 运行时扩展类型
// ============================================================

/** 工具结果保留策略 */
export type ToolResultRetention = 'full' | 'summary' | 'drop_after_turn';

/** 运行终止原因 */
export type RunTerminalReason =
  | 'completed'
  | 'prompt_too_long'
  | 'aborted_streaming'
  | 'aborted_tools'
  | 'max_turns'
  | 'model_error';

/** Compact 边界记录 */
export interface CompactBoundary {
  id: string;
  strategy: 'micro' | 'summary' | 'reactive';
  messageCountBefore: number;
  messageCountAfter: number;
  freedTokens: number;
  timestamp: number;
}

/** Prompt 诊断数据 */
export interface PromptDiagnostics {
  triggeredSections: string[];
  historyTokens: number;
  ragTokens: number;
  toolTokens: number;
  completionTokens: number;
  hadToolCall: boolean;
  toolParseFailed: boolean;
  compactOccurred: boolean;
  compactFreedTokens: number;
  terminalReason: RunTerminalReason | null;
  planTransition: string | null;
  ragHitCount: number;
  ragInjectedTokens: number;
}

/** 知识库检索响应 */
export interface KnowledgeSearchResponse {
  query: string;
  topK: number;
  results: RetrievedChunk[];
  error?: string;
}

/** Workspace 实体 */
export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
  updatedAt: number;
}

/** Agent 运行记录 */
export interface AgentRun {
  id: string;
  sessionId: string;
  mode: AgentMode;
  status: 'running' | 'completed' | 'aborted' | 'failed';
  startedAt: number;
  endedAt?: number;
  lastSequence: number;
  tokenUsage: { prompt: number; completion: number; total: number };
  error?: string;
  terminalReason?: RunTerminalReason;
  diagnostics?: PromptDiagnostics;
}

/** Agent 事件记录 */
export interface AgentEventRecord {
  id: number;
  runId: string;
  sequence: number;
  type: string;
  data: string;
  promptTokens?: number;
  completionTokens?: number;
  toolName?: string;
  isError?: boolean;
  createdAt: number;
}
