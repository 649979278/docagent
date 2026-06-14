/**
 * 类型化错误体系 - 每类错误有专用恢复策略
 * 参考Open WebUI的错误分类模式
 */

// ============================================================
// 错误基类
// ============================================================

/** Agent错误基类 */
export class AgentError extends Error {
  /** 错误码，用于程序化判断 */
  public readonly code: string;
  /** 是否可自动恢复 */
  public readonly recoverable: boolean;

  constructor(message: string, code: string, recoverable: boolean) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.recoverable = recoverable;
  }
}

// ============================================================
// 具体错误类型
// ============================================================

/** Ollama连接错误 - 自动重试60s */
export class OllamaConnectionError extends AgentError {
  constructor(public readonly cause?: Error) {
    super('Ollama服务不可用', 'OLLAMA_UNAVAILABLE', true);
    this.name = 'OllamaConnectionError';
  }
}

/** 上下文超限错误 - 截断后重试 */
export class ContextLengthExceededError extends AgentError {
  constructor(public readonly exceededTokens: number) {
    super('上下文长度超限', 'CONTEXT_LENGTH_EXCEEDED', true);
    this.name = 'ContextLengthExceededError';
  }
}

/** 模型不可用错误 - 自动拉取或提示 */
export class ModelNotAvailableError extends AgentError {
  constructor(public readonly modelName: string) {
    super(`模型 ${modelName} 不可用`, 'MODEL_NOT_AVAILABLE', true);
    this.name = 'ModelNotAvailableError';
  }
}

/** 工具执行错误 - 报告用户并提供重试选项 */
export class ToolExecutionError extends AgentError {
  constructor(
    public readonly toolName: string,
    public readonly toolError: Error,
    public readonly input?: unknown,
  ) {
    super(`工具 ${toolName} 执行失败: ${toolError.message}`, 'TOOL_EXECUTION_FAILED', true);
    this.name = 'ToolExecutionError';
  }
}

/** 权限被拒绝错误 - 不可自动恢复 */
export class PermissionDeniedError extends AgentError {
  constructor(toolName: string, reason?: string) {
    super(
      `工具 ${toolName} 权限不足${reason ? `: ${reason}` : ''}`,
      'PERMISSION_DENIED',
      false,
    );
    this.name = 'PermissionDeniedError';
  }
}

/** 索引任务错误 */
export class IndexJobError extends AgentError {
  constructor(
    public readonly documentId: string,
    public readonly stage: string,
    public readonly jobError: Error,
  ) {
    super(
      `文档索引失败 (${stage}): ${jobError.message}`,
      'INDEX_JOB_FAILED',
      true,
    );
    this.name = 'IndexJobError';
  }
}

/** 文件解析错误 */
export class FileParseError extends AgentError {
  constructor(
    public readonly filePath: string,
    public readonly fileType: string,
    public readonly parseError: Error,
  ) {
    super(
      `文件解析失败 (${fileType}): ${parseError.message}`,
      'FILE_PARSE_FAILED',
      true,
    );
    this.name = 'FileParseError';
  }
}

/** 会话不存在错误 */
export class SessionNotFoundError extends AgentError {
  constructor(public readonly sessionId: string) {
    super(`会话 ${sessionId} 不存在`, 'SESSION_NOT_FOUND', false);
    this.name = 'SessionNotFoundError';
  }
}

// ============================================================
// 恢复策略
// ============================================================

/** 恢复动作类型 */
export type RecoveryActionType =
  | 'retry'               // 定时重试
  | 'compact_and_retry'   // 压缩后重试
  | 'prompt_pull_model'   // 提示拉取模型
  | 'report_and_offer_retry' // 报告用户并提供重试
  | 'abort';              // 中止

/** 恢复策略 */
export interface RecoveryStrategy {
  action: RecoveryActionType;
  /** 重试间隔(ms) */
  interval?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 是否显示进度 */
  showProgress?: boolean;
}

/**
 * 获取错误的恢复策略
 * 每类错误有专用恢复方式，避免统一处理
 * @param error - Agent错误实例
 * @returns 对应的恢复策略
 */
export function getRecoveryStrategy(error: AgentError): RecoveryStrategy {
  switch (error.code) {
    case 'OLLAMA_UNAVAILABLE':
      // 自动重试，5秒间隔，最多12次(共60秒)
      return { action: 'retry', interval: 5000, maxRetries: 12, showProgress: true };

    case 'CONTEXT_LENGTH_EXCEEDED':
      // 压缩上下文后重试，最多3次
      return { action: 'compact_and_retry', maxRetries: 3 };

    case 'MODEL_NOT_AVAILABLE':
      // 提示用户拉取模型
      return { action: 'prompt_pull_model' };

    case 'TOOL_EXECUTION_FAILED':
      // 报告用户，提供重试选项
      return { action: 'report_and_offer_retry' };

    case 'INDEX_JOB_FAILED':
      // 报告用户，提供重试选项
      return { action: 'report_and_offer_retry' };

    case 'FILE_PARSE_FAILED':
      // 报告用户，不自动重试
      return { action: 'report_and_offer_retry' };

    case 'PERMISSION_DENIED':
    case 'SESSION_NOT_FOUND':
      // 不可恢复，中止
      return { action: 'abort' };

    default:
      return { action: 'abort' };
  }
}

/**
 * 判断错误是否为Ollama连接相关
 * 用于心跳检查逻辑
 */
export function isOllamaError(error: unknown): boolean {
  return error instanceof OllamaConnectionError;
}

/**
 * 判断错误是否为上下文超限
 * 用于reactiveCompact判断
 */
export function isContextOverflowError(error: unknown): boolean {
  return error instanceof ContextLengthExceededError;
}
