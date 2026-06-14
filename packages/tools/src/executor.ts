/**
 * 工具执行器 - 只读并发/写入串行编排
 * 参考 Claude Code partitionToolCalls 模式：
 * - 只读工具并发执行（max concurrency 10）
 * - 写入工具串行执行
 * - 结果按原始调用顺序合并
 * 通过 enableConcurrent=false 可回退到全量串行
 */

import type {
  ToolCall,
  ToolContext,
} from '@workagent/shared';
import {
  MAX_TOOL_RESULT_TOKENS,
  TOOL_EXECUTION_TIMEOUT,
} from '@workagent/shared';
import {
  ToolExecutionError,
  PermissionDeniedError,
} from '@workagent/shared';
import type { AgentTool, ToolExecutionResult } from './base.js';
import { ToolRegistry } from './base.js';
import type { PermissionBroker } from './permission.js';

// ============================================================
// 执行器配置
// ============================================================

/** 工具执行器配置 */
export interface ExecutorConfig {
  /** 工具执行超时时间(ms)，默认60000 */
  timeout?: number;
  /** 工具结果最大token数，默认2000 */
  maxResultTokens?: number;
  /** 失败后是否尝试fallback解析，默认true */
  enableFallback?: boolean;
  /** 是否启用并发执行，默认true。设为false回退到全量串行 */
  enableConcurrent?: boolean;
  /** 只读工具最大并发数，默认10 */
  maxConcurrency?: number;
}

// ============================================================
// 工具调用分区
// ============================================================

/** 工具调用分区结果 */
export interface PartitionedCalls {
  /** 只读工具调用列表 */
  readOnlyCalls: ToolCall[];
  /** 写入工具调用列表 */
  writeCalls: ToolCall[];
}

/**
 * 将工具调用分为只读批和写入批
 * 参考 Claude Code partitionToolCalls
 * @param calls - 工具调用列表
 * @param registry - 工具注册中心
 * @returns 分区结果
 */
export function partitionToolCalls(
  calls: ToolCall[],
  registry: ToolRegistry,
): PartitionedCalls {
  const readOnlyCalls: ToolCall[] = [];
  const writeCalls: ToolCall[] = [];

  for (const call of calls) {
    const tool = registry.getTool(call.name);
    if (tool && tool.isReadOnly()) {
      readOnlyCalls.push(call);
    } else {
      writeCalls.push(call);
    }
  }

  return { readOnlyCalls, writeCalls };
}

// ============================================================
// ToolExecutor
// ============================================================

/**
 * 工具执行器 - 只读并发/写入串行编排
 * 支持：并发控制、超时控制、结果截断、失败fallback、权限检查
 * 通过 enableConcurrent=false 可回退到全量串行
 */
export class ToolExecutor {
  /** 工具注册中心 */
  private registry: ToolRegistry;
  /** 权限代理 */
  private permissionBroker: PermissionBroker;
  /** 执行器配置 */
  private config: Required<ExecutorConfig>;

  /**
   * 创建工具执行器
   * @param registry - 工具注册中心
   * @param permissionBroker - 权限代理
   * @param config - 执行器配置
   */
  constructor(
    registry: ToolRegistry,
    permissionBroker: PermissionBroker,
    config: ExecutorConfig = {},
  ) {
    this.registry = registry;
    this.permissionBroker = permissionBroker;
    this.config = {
      timeout: config.timeout ?? TOOL_EXECUTION_TIMEOUT,
      maxResultTokens: config.maxResultTokens ?? MAX_TOOL_RESULT_TOKENS,
      enableFallback: config.enableFallback ?? true,
      enableConcurrent: config.enableConcurrent ?? true,
      maxConcurrency: config.maxConcurrency ?? 10,
    };
  }

  /**
   * 执行一组工具调用 - 只读并发/写入串行编排
   * 参考 Claude Code partitionToolCalls 模式
   * @param calls - 工具调用列表
   * @param context - 工具执行上下文
   * @returns 执行结果列表，与输入调用一一对应
   */
  async executeAll(
    calls: ToolCall[],
    context: ToolContext,
  ): Promise<ToolExecutionResult[]> {
    // 串行回退路径
    if (!this.config.enableConcurrent) {
      return this.executeAllSerial(calls, context);
    }

    // 分区：只读 vs 写入
    const { readOnlyCalls, writeCalls } = partitionToolCalls(calls, this.registry);

    // 如果全是写入或全是只读，走简化路径
    if (readOnlyCalls.length === 0) {
      return this.executeAllSerial(calls, context);
    }
    if (writeCalls.length === 0) {
      const results = await this.executeConcurrent(readOnlyCalls, context);
      return this.mergeResultsInOrder(calls, readOnlyCalls, [], results, []);
    }

    // 混合模式：只读并发 + 写入串行
    const readOnlyResults = await this.executeConcurrent(readOnlyCalls, context);
    const writeResults = await this.executeAllSerial(writeCalls, context);

    // 按原始调用顺序合并结果
    return this.mergeResultsInOrder(calls, readOnlyCalls, writeCalls, readOnlyResults, writeResults);
  }

  /**
   * 串行执行一组工具调用（全量串行回退路径）
   * @param calls - 工具调用列表
   * @param context - 工具执行上下文
   * @returns 执行结果列表，与输入调用一一对应
   */
  private async executeAllSerial(
    calls: ToolCall[],
    context: ToolContext,
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];

    for (const call of calls) {
      const result = await this.executeOne(call, context);
      results.push(result);

      // 如果权限被拒绝，仍然记录结果但不中止后续工具
      // 让runtime层决定如何处理
    }

    return results;
  }

  /**
   * 并发执行只读工具
   * 使用 worker pool 模式控制并发度
   * @param calls - 只读工具调用列表
   * @param context - 工具执行上下文
   * @returns 执行结果列表，与输入调用一一对应
   */
  private async executeConcurrent(
    calls: ToolCall[],
    context: ToolContext,
  ): Promise<ToolExecutionResult[]> {
    if (calls.length === 0) return [];

    const results = new Map<string, ToolExecutionResult>();
    let index = 0;

    const runNext = async (): Promise<void> => {
      while (index < calls.length) {
        const i = index++;
        const result = await this.executeOne(calls[i], context);
        results.set(calls[i].id, result);
      }
    };

    const workers = Math.min(this.config.maxConcurrency, calls.length);
    await Promise.all(Array.from({ length: workers }, () => runNext()));

    return calls.map(c => results.get(c.id)!);
  }

  /**
   * 按原始调用顺序合并只读和写入的结果
   * @param originalCalls - 原始调用顺序
   * @param readOnlyCalls - 只读调用列表
   * @param writeCalls - 写入调用列表
   * @param readOnlyResults - 只读执行结果
   * @param writeResults - 写入执行结果
   * @returns 按原始顺序合并的结果列表
   */
  private mergeResultsInOrder(
    originalCalls: ToolCall[],
    readOnlyCalls: ToolCall[],
    writeCalls: ToolCall[],
    readOnlyResults: ToolExecutionResult[],
    writeResults: ToolExecutionResult[],
  ): ToolExecutionResult[] {
    // 构建 id -> result 的查找表
    const readOnlyMap = new Map<string, ToolExecutionResult>();
    readOnlyCalls.forEach((call, i) => readOnlyMap.set(call.id, readOnlyResults[i]));

    const writeMap = new Map<string, ToolExecutionResult>();
    writeCalls.forEach((call, i) => writeMap.set(call.id, writeResults[i]));

    // 按原始顺序合并
    return originalCalls.map(call => {
      const readOnlyResult = readOnlyMap.get(call.id);
      if (readOnlyResult) return readOnlyResult;
      const writeResult = writeMap.get(call.id);
      if (writeResult) return writeResult;
      // 不应到达这里，但做防御性处理
      return {
        call,
        output: null,
        isError: true,
        summary: '结果合并时未找到对应调用',
      };
    });
  }

  /**
   * 执行单个工具调用
   * @param call - 工具调用信息
   * @param context - 工具执行上下文
   * @returns 工具执行结果
   */
  async executeOne(
    call: ToolCall,
    context: ToolContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.registry.getTool(call.name);

    // 工具未找到
    if (!tool) {
      return {
        call,
        output: null,
        isError: true,
        summary: `工具 "${call.name}" 未注册`,
      };
    }

    // 权限检查
    try {
      const decision = await this.permissionBroker.check(
        tool,
        call.arguments,
        context,
      );

      if (!decision.allowed) {
        return {
          call,
          output: null,
          isError: true,
          summary: `权限被拒绝: ${decision.reason ?? '未授权'}`,
        };
      }
    } catch (error) {
      // 权限检查本身出错，视为拒绝
      return {
        call,
        output: null,
        isError: true,
        summary: `权限检查失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // 执行工具（带超时）
    try {
      const output = await this.executeWithTimeout(
        tool,
        call.arguments,
        context,
      );

      // 截断结果
      const truncatedOutput = this.truncateResult(output);
      const summary = tool.renderSummary(call.arguments, truncatedOutput);

      return {
        call,
        output: truncatedOutput,
        isError: false,
        summary,
      };
    } catch (error) {
      // 失败后尝试一次fallback解析
      if (this.config.enableFallback && error instanceof ToolExecutionError) {
        const fallbackResult = this.attemptFallback(call, error);
        if (fallbackResult) {
          return fallbackResult;
        }
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        call,
        output: null,
        isError: true,
        summary: `执行失败: ${errorMessage}`,
      };
    }
  }

  /**
   * 带超时执行工具
   * @param tool - 工具实例
   * @param input - 工具输入
   * @param context - 执行上下文
   * @returns 工具输出
   */
  private async executeWithTimeout(
    tool: AgentTool,
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new ToolExecutionError(
          tool.name,
          new Error(`工具执行超时（${this.config.timeout}ms）`),
          input,
        ));
      }, this.config.timeout);

      tool.call(input, context)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(
            error instanceof ToolExecutionError
              ? error
              : new ToolExecutionError(tool.name, error, input),
          );
        });
    });
  }

  /**
   * 截断工具执行结果，防止单个结果占用过多上下文
   * @param output - 原始输出
   * @returns 截断后的输出
   */
  private truncateResult(output: unknown): unknown {
    if (output === null || output === undefined) {
      return output;
    }

    const str = typeof output === 'string' ? output : JSON.stringify(output);
    if (str === undefined) return output;

    // 粗略估算：1个token约1.5个中文字符或4个英文字符
    const maxChars = this.config.maxResultTokens * 1.5;

    if (str.length > maxChars) {
      const truncated = str.slice(0, Math.floor(maxChars));
      // 尝试保持JSON完整
      if (typeof output !== 'string') {
        try {
          return JSON.parse(truncated + '"}');
        } catch {
          return truncated + '\n...[结果已截断]';
        }
      }
      return truncated + '\n...[结果已截断]';
    }

    return output;
  }

  /**
   * 失败后尝试一次fallback解析
   * 尝试从错误信息中提取有用的部分结果
   * @param call - 工具调用
   * @param error - 工具执行错误
   * @returns fallback结果，或null表示无法恢复
   */
  private attemptFallback(
    call: ToolCall,
    error: ToolExecutionError,
  ): ToolExecutionResult | null {
    // 对于解析类工具，如果部分结果可用，尝试返回部分结果
    const errorOutput = error.toolError.message;

    // 如果错误信息中包含可用的部分结果（如JSON解析部分成功）
    if (errorOutput.includes('部分结果')) {
      return {
        call,
        output: { partial: true, error: errorOutput },
        isError: false,
        summary: `部分成功: ${errorOutput.slice(0, 100)}`,
      };
    }

    return null;
  }
}
