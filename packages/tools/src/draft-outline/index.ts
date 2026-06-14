/**
 * 提纲生成工具 - 让模型根据收集的材料生成公文提纲
 * safety=read_only, mode=plan
 */

import type {
  ToolSafety,
  ToolMode,
  PermissionDecision,
  ToolContext,
  PlanOutline,
} from '@workagent/shared';
import type { AgentTool } from '../base.js';

// ============================================================
// 输入/输出类型
// ============================================================

/** 提纲生成输入 */
export interface DraftOutlineInput {
  /** 公文标题 */
  title: string;
  /** 公文目标/目的 */
  goal: string;
  /** 材料依据（已检索的相关材料摘要） */
  materialBasis: string;
  /** 文种（如：通知、报告、请示等） */
  documentType: string;
  /** 预期篇幅（字数范围） */
  expectedLength?: string;
  /** 额外格式要求 */
  formatRequirements?: string;
  /** 引用的RAG片段ID列表 */
  citationIds?: string[];
}

/** 提纲生成输出 */
export interface DraftOutlineOutput {
  /** 生成的提纲 */
  outline: PlanOutline;
  /** 是否需要用户进一步确认 */
  needsConfirmation: boolean;
}

// ============================================================
// DraftOutlineTool 实现
// ============================================================

/**
 * 提纲生成工具 - 根据收集的材料和文种要求生成公文提纲
 * 只读操作（不修改任何状态），仅在plan模式下可用
 * 提纲生成后需用户审查确认，模型不能自行决定执行
 */
export class DraftOutlineTool implements AgentTool<DraftOutlineInput, DraftOutlineOutput> {
  name = 'draft_outline';
  description = '根据收集的材料和文种要求生成公文提纲，包含标题、结构、材料依据、风险提示等。生成的提纲需用户审查确认';
  safety: ToolSafety = 'read_only';
  mode: ToolMode = 'plan';

  inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: '公文标题',
      },
      goal: {
        type: 'string',
        description: '公文目标/目的',
      },
      materialBasis: {
        type: 'string',
        description: '材料依据（已检索的相关材料摘要）',
      },
      documentType: {
        type: 'string',
        description: '文种（如：通知、报告、请示等）',
      },
      expectedLength: {
        type: 'string',
        description: '预期篇幅（字数范围）',
      },
      formatRequirements: {
        type: 'string',
        description: '额外格式要求',
      },
      citationIds: {
        type: 'array',
        items: { type: 'string' },
        description: '引用的RAG片段ID列表',
      },
    },
    required: ['title', 'goal', 'materialBasis', 'documentType'],
  };

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
  checkPermission(_input: DraftOutlineInput, _context: ToolContext): PermissionDecision {
    return { allowed: true, reason: '只读操作，自动允许' };
  }

  /**
   * 执行提纲生成
   * @param input - 提纲生成输入
   * @param context - 工具执行上下文
   * @returns 提纲生成结果
   */
  async call(input: DraftOutlineInput, _context: ToolContext): Promise<DraftOutlineOutput> {
    // 构建公文提纲
    const outline = this.buildOutline(input);

    return {
      outline,
      needsConfirmation: true,
    };
  }

  /**
   * 渲染工具调用摘要
   * @param input - 提纲输入
   * @param output - 提纲输出
   * @returns 简短摘要文本
   */
  renderSummary(input: DraftOutlineInput, output: DraftOutlineOutput): string {
    const stepCount = output.outline.structure.length;
    return `[提纲生成] "${input.title}" (${input.documentType}), ${stepCount}个步骤, ${output.needsConfirmation ? '待确认' : '已确认'}`;
  }

  /**
   * 根据输入构建公文提纲
   * 实际提纲内容由模型在plan模式的system prompt中生成
   * 此处构建提纲框架，模型填充具体内容
   * @param input - 提纲输入
   * @returns 提纲
   */
  private buildOutline(input: DraftOutlineInput): PlanOutline {
    return {
      title: input.title,
      goal: input.goal,
      materialBasis: input.materialBasis,
      structure: [
        {
          id: 'step-1',
          description: `生成${input.documentType}的开头/缘由部分`,
          status: 'pending',
        },
        {
          id: 'step-2',
          description: `生成${input.documentType}的主体内容`,
          status: 'pending',
        },
        {
          id: 'step-3',
          description: `生成${input.documentType}的结尾/要求部分`,
          status: 'pending',
        },
      ],
      expectedOutput: `${input.documentType}：${input.title}`,
      risks: [
        '生成的提纲可能需要根据实际情况调整',
        '材料依据可能不够充分，需用户补充',
      ],
      questions: [
        input.expectedLength ? `篇幅要求${input.expectedLength}是否合适？` : '请确认预期篇幅',
        '公文的具体行文风格是否有特殊要求？',
      ],
      citations: input.citationIds ?? [],
    };
  }
}
