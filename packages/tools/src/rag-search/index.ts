/**
 * RAG检索工具 - 从知识库中检索相关文档片段
 * safety=read_only, mode=both（chat和plan模式均可用）
 */

import type {
  ToolSafety,
  ToolMode,
  PermissionDecision,
  ToolContext,
  RetrievedChunk,
  SearchOptions,
} from '@workagent/shared';
import { DEFAULT_RAG_TOP_K } from '@workagent/shared';
import type { AgentTool } from '../base.js';

// ============================================================
// RAG检索依赖接口
// ============================================================

/** RAG引擎接口 - 由@workagent/rag包的RAGEngine提供实现 */
export interface RAGSearchProvider {
  /** 搜索知识库（接受文本查询，内部完成向量化+检索） */
  search(query: string, options?: SearchOptions): Promise<RetrievedChunk[]>;
}

// ============================================================
// 输入/输出类型
// ============================================================

/** RAG检索输入 */
export interface RagSearchInput {
  /** 检索查询文本 */
  query: string;
  /** 返回结果数量，默认5 */
  topK?: number;
  /** 最低相关性分数阈值 */
  minScore?: number;
}

/** RAG检索输出 */
export interface RagSearchOutput {
  /** 检索到的文档片段列表 */
  chunks: RetrievedChunk[];
  /** 实际使用的查询文本 */
  query: string;
  /** 结果数量 */
  count: number;
}

// ============================================================
// RagSearchTool 实现
// ============================================================

/**
 * RAG检索工具 - 从知识库中检索相关文档片段
 * 只读操作，在chat和plan模式下均可用
 * 依赖RAGSearchProvider（即RAGEngine），由引擎负责查询向量化+向量搜索
 */
export class RagSearchTool implements AgentTool<RagSearchInput, RagSearchOutput> {
  name = 'rag_search';
  description = '从知识库中检索与查询相关的文档片段，返回带来源引用的文本内容';
  safety: ToolSafety = 'read_only';
  mode: ToolMode = 'both';

  inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '检索查询文本',
      },
      topK: {
        type: 'number',
        description: '返回结果数量，默认5',
      },
      minScore: {
        type: 'number',
        description: '最低相关性分数阈值',
      },
    },
    required: ['query'],
  };

  /** RAG引擎实例（负责向量化+检索） */
  private ragEngine: RAGSearchProvider;

  /**
   * 创建RAG检索工具
   * @param ragEngine - RAG引擎实例（RAGEngine），负责查询文本向量化+向量搜索
   */
  constructor(ragEngine: RAGSearchProvider) {
    this.ragEngine = ragEngine;
  }

  /**
   * 判断工具是否为只读
   * @returns 始终为true
   */
  isReadOnly(): boolean {
    return true;
  }

  /**
   * 检查权限 - 只读工具自动允许
   * @returns 自动允许的权限决策
   */
  checkPermission(_input: RagSearchInput, _context: ToolContext): PermissionDecision {
    return { allowed: true, reason: '只读操作，自动允许' };
  }

  /**
   * 执行RAG检索
   * @param input - 检索输入参数
   * @param context - 工具执行上下文
   * @returns 检索结果
   */
  async call(input: RagSearchInput, _context: ToolContext): Promise<RagSearchOutput> {
    const options: SearchOptions = {
      topK: input.topK ?? DEFAULT_RAG_TOP_K,
      minScore: input.minScore,
    };

    const chunks = await this.ragEngine.search(input.query, options);

    return {
      chunks,
      query: input.query,
      count: chunks.length,
    };
  }

  /**
   * 渲染工具调用摘要
   * @param input - 检索输入
   * @param output - 检索输出
   * @returns 简短摘要文本
   */
  renderSummary(input: RagSearchInput, output: RagSearchOutput): string {
    const sources = output.chunks
      .map((c) => `${c.sourceFile}(${c.locator})`)
      .join(', ');
    return `[RAG检索] query="${input.query}", 找到${output.count}条结果, 来源: ${sources || '无'}`;
  }
}
