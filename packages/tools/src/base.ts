/**
 * 工具系统基础定义 - AgentTool接口、ToolRegistry注册中心
 * 提供统一的工具抽象，支持安全级别、模式过滤、权限检查
 */

import type {
  ToolSafety,
  ToolMode,
  PermissionDecision,
  ToolCall,
  ToolContext,
} from '@workagent/shared';

// ============================================================
// AgentTool 接口
// ============================================================

/**
 * Agent工具接口 - 所有工具必须实现此接口
 * @typeParam Input - 工具输入类型
 * @typeParam Output - 工具输出类型
 */
export interface AgentTool<Input = Record<string, unknown>, Output = unknown> {
  /** 工具唯一名称 */
  name: string;

  /** 工具描述（供模型理解用途） */
  description: string;

  /** 输入参数的JSON Schema */
  inputSchema: Record<string, unknown>;

  /** 安全级别 */
  safety: ToolSafety;

  /** 可用模式 */
  mode: ToolMode;

  /**
   * 判断工具是否为只读
   * @returns 安全级别为read_only时返回true
   */
  isReadOnly(): boolean;

  /**
   * 检查权限，根据安全级别决定是否需要用户确认
   * @param input - 工具输入参数
   * @param context - 工具执行上下文
   * @returns 权限决策结果
   */
  checkPermission(input: Input, context: ToolContext): PermissionDecision;

  /**
   * 执行工具
   * @param input - 工具输入参数
   * @param context - 工具执行上下文
   * @returns 工具执行结果
   */
  call(input: Input, context: ToolContext): Promise<Output>;

  /**
   * 渲染工具调用的简短摘要（用于上下文压缩时替代完整输出）
   * @param input - 工具输入参数
   * @param output - 工具执行结果
   * @returns 摘要文本
   */
  renderSummary(input: Input, output: Output): string;
}

// ============================================================
// 权限自动决策规则
// ============================================================

/**
 * 根据安全级别生成默认权限决策
 * - read_only: 自动允许
 * - write_index / write_output: 首次确认后可持久化
 * - overwrite_output / command / destructive: 每次都需确认
 * @param safety - 工具安全级别
 * @param toolName - 工具名称
 * @param context - 工具执行上下文（检查是否已有持久化决策）
 * @returns 权限决策结果
 */
export function getDefaultPermissionDecision(
  safety: ToolSafety,
  toolName: string,
  context: ToolContext,
): PermissionDecision {
  switch (safety) {
    case 'read_only':
      return { allowed: true, reason: '只读操作，自动允许' };

    case 'write_index':
    case 'write_output':
      // 检查是否已有持久化决策
      if (context.permissions[toolName] === 'allowed') {
        return { allowed: true, reason: '已有持久化授权' };
      }
      return {
        allowed: false,
        reason: `${safety === 'write_index' ? '索引写入' : '文件输出'}操作需要确认`,
        remember: true,
      };

    case 'overwrite_output':
      return {
        allowed: false,
        reason: '覆盖已有文件，每次都需要确认',
        remember: false,
      };

    case 'command':
      return {
        allowed: false,
        reason: '命令执行操作，每次都需要确认',
        remember: false,
      };

    case 'destructive':
      return {
        allowed: false,
        reason: '破坏性操作，每次都需要确认',
        remember: false,
      };

    default:
      return { allowed: false, reason: '未知安全级别' };
  }
}

// ============================================================
// ToolRegistry 注册中心
// ============================================================

/**
 * 工具注册中心 - 管理所有可用工具的注册和查询
 * 支持按模式过滤工具列表
 */
export class ToolRegistry {
  /** 工具注册表，name -> AgentTool */
  private tools: Map<string, AgentTool> = new Map();

  /**
   * 注册一个工具
   * @param tool - 要注册的工具实例
   * @throws 如果同名工具已注册
   */
  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具 "${tool.name}" 已注册，不能重复注册`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 根据模式获取可用工具列表
   * @param mode - Agent运行模式
   * @returns 符合该模式的工具列表
   */
  getTools(mode: 'chat' | 'plan' | 'execute'): AgentTool[] {
    const result: AgentTool[] = [];
    for (const tool of this.tools.values()) {
      // 'both' 模式在所有模式下可用，否则必须精确匹配
      if (tool.mode === 'both' || tool.mode === mode) {
        result.push(tool);
      }
    }
    return result;
  }

  /**
   * 根据名称获取工具
   * @param name - 工具名称
   * @returns 工具实例，未找到时返回undefined
   */
  getTool(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有已注册工具的名称列表
   * @returns 工具名称数组
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 检查指定工具是否已注册
   * @param name - 工具名称
   * @returns 是否已注册
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}

// ============================================================
// 工具调用辅助类型
// ============================================================

/** 工具执行结果 */
export interface ToolExecutionResult {
  /** 工具调用信息 */
  call: ToolCall;
  /** 执行输出 */
  output: unknown;
  /** 是否执行出错 */
  isError: boolean;
  /** 结果摘要 */
  summary: string;
}

/**
 * 将AgentTool转换为模型可识别的ToolDefinition格式
 * @param tool - Agent工具实例
 * @returns 模型用的工具定义
 */
export function toToolDefinition(tool: AgentTool): {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
} {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}
