/**
 * 知识库添加工具 - 将文件添加到知识库索引
 * safety=write_index, mode=chat
 */

import type {
  ToolSafety,
  ToolMode,
  PermissionDecision,
  ToolContext,
  IndexJob,
} from '@workagent/shared';
import type { AgentTool } from '../base.js';

// ============================================================
// 知识库索引依赖接口
// ============================================================

/** 索引管理器接口 - 由@workagent/rag包提供实现 */
export interface IndexManager {
  /** 创建索引任务 */
  createIndexJob(filePath: string): Promise<IndexJob>;
  /** 获取索引任务状态 */
  getIndexJob(jobId: string): Promise<IndexJob | null>;
}

// ============================================================
// 输入/输出类型
// ============================================================

/** 知识库添加输入 */
export interface KnowledgeAddInput {
  /** 要添加到知识库的文件路径列表 */
  filePaths: string[];
}

/** 知识库添加输出 */
export interface KnowledgeAddOutput {
  /** 创建的索引任务列表 */
  jobs: Array<{
    jobId: string;
    filePath: string;
    status: string;
  }>;
  /** 成功创建的任务数 */
  successCount: number;
  /** 失败的文件数 */
  failCount: number;
}

// ============================================================
// KnowledgeAddTool 实现
// ============================================================

/**
 * 知识库添加工具 - 将文件添加到知识库并创建索引任务
 * 首次使用需要用户确认，确认后可持久化授权
 * 仅在chat模式下可用
 */
export class KnowledgeAddTool implements AgentTool<KnowledgeAddInput, KnowledgeAddOutput> {
  name = 'knowledge_add';
  description = '将指定的文件添加到知识库，创建索引任务。添加后可使用rag_search工具检索相关内容';
  safety: ToolSafety = 'write_index';
  mode: ToolMode = 'chat';

  inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      filePaths: {
        type: 'array',
        items: { type: 'string' },
        description: '要添加到知识库的文件路径列表',
      },
    },
    required: ['filePaths'],
  };

  /** 索引管理器实例 */
  private indexManager: IndexManager;

  /**
   * 创建知识库添加工具
   * @param indexManager - 索引管理器实例
   */
  constructor(indexManager: IndexManager) {
    this.indexManager = indexManager;
  }

  /**
   * 判断工具是否为只读
   * @returns 始终为false（索引写入操作）
   */
  isReadOnly(): boolean {
    return false;
  }

  /**
   * 检查权限 - 索引写入首次确认可持久化
   * @param input - 工具输入
   * @param context - 工具执行上下文
   * @returns 权限决策
   */
  checkPermission(_input: KnowledgeAddInput, context: ToolContext): PermissionDecision {
    if (context.permissions[this.name] === 'allowed') {
      return { allowed: true, reason: '已有持久化授权' };
    }
    return {
      allowed: false,
      reason: '知识库索引写入操作需要确认',
      remember: true,
    };
  }

  /**
   * 执行知识库添加
   * @param input - 添加输入参数
   * @param context - 工具执行上下文
   * @returns 添加结果
   */
  async call(input: KnowledgeAddInput, _context: ToolContext): Promise<KnowledgeAddOutput> {
    const jobs: KnowledgeAddOutput['jobs'] = [];
    let successCount = 0;
    let failCount = 0;

    for (const filePath of input.filePaths) {
      try {
        const job = await this.indexManager.createIndexJob(filePath);
        jobs.push({
          jobId: job.id,
          filePath,
          status: job.status,
        });
        successCount++;
      } catch {
        jobs.push({
          jobId: '',
          filePath,
          status: 'failed',
        });
        failCount++;
      }
    }

    return {
      jobs,
      successCount,
      failCount,
    };
  }

  /**
   * 渲染工具调用摘要
   * @param input - 添加输入
   * @param output - 添加输出
   * @returns 简短摘要文本
   */
  renderSummary(input: KnowledgeAddInput, output: KnowledgeAddOutput): string {
    return `[知识库添加] 提交${input.filePaths.length}个文件, 成功${output.successCount}个, 失败${output.failCount}个`;
  }
}
