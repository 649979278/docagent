/**
 * 工具执行器 - 串行执行工具调用，带超时和结果截断
 * 一期不做并发，所有工具按顺序执行
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
}

// ============================================================
// ToolExecutor
// ============================================================

/**
 * 工具执行器 - 负责串行执行工具调用
 * 支持：超时控制、结果截断、失败fallback、权限检查
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
    };
  }

  /**
   * 串行执行一组工具调用
   * @param calls - 工具调用列表
   * @param context - 工具执行上下文
   * @returns 执行结果列表，与输入调用一一对应
   */
  async executeAll(
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
