/**
 * 覆盖文档工具 - 覆盖已有的docx文件
 * safety=overwrite_output, mode=execute
 * 每次执行都需要用户确认，不可持久化
 */

import type {
  ToolSafety,
  ToolMode,
  PermissionDecision,
  ToolContext,
} from '@workagent/shared';
import type { DocumentGenerator } from '../doc-write/index.js';
import type { AgentTool } from '../base.js';
import * as fs from 'node:fs';

// ============================================================
// 输入/输出类型
// ============================================================

/** 覆盖文档输入 */
export interface DocOverwriteInput {
  /** 要覆盖的文件完整路径 */
  filePath: string;
  /** 新的Markdown格式内容 */
  content: string;
  /** 文档模板名称（可选） */
  templateName?: string;
}

/** 覆盖文档输出 */
export interface DocOverwriteOutput {
  /** 覆盖后的文件路径 */
  filePath: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** 是否为覆盖操作 */
  wasOverwritten: boolean;
}

// ============================================================
// DocOverwriteTool 实现
// ============================================================

/**
 * 覆盖文档工具 - 覆盖已有的docx文件
 * 每次执行都必须用户确认，不可持久化授权
 * 仅在execute模式下可用
 */
export class DocOverwriteTool implements AgentTool<DocOverwriteInput, DocOverwriteOutput> {
  name = 'doc_overwrite';
  description = '覆盖已有的docx文件，用新内容替换。此操作不可撤销，每次执行都需要用户确认';
  safety: ToolSafety = 'overwrite_output';
  mode: ToolMode = 'execute';

  inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: '要覆盖的文件完整路径',
      },
      content: {
        type: 'string',
        description: '新的Markdown格式内容',
      },
      templateName: {
        type: 'string',
        description: '文档模板名称（可选）',
      },
    },
    required: ['filePath', 'content'],
  };

  /** 文档生成器实例 */
  private docGenerator: DocumentGenerator;

  /**
   * 创建覆盖文档工具
   * @param docGenerator - 文档生成器实例
   */
  constructor(docGenerator: DocumentGenerator) {
    this.docGenerator = docGenerator;
  }

  /**
   * 判断工具是否为只读
   * @returns 始终为false
   */
  isReadOnly(): boolean {
    return false;
  }

  /**
   * 检查权限 - 覆盖操作每次都需要确认
   * @returns 需要确认的权限决策（remember=false）
   */
  checkPermission(_input: DocOverwriteInput, _context: ToolContext): PermissionDecision {
    return {
      allowed: false,
      reason: '覆盖已有文件操作需要每次确认，不可持久化授权',
      remember: false,
    };
  }

  /**
   * 执行文档覆盖
   * @param input - 覆盖输入参数
   * @param context - 工具执行上下文
   * @returns 覆盖结果
   */
  async call(input: DocOverwriteInput, _context: ToolContext): Promise<DocOverwriteOutput> {
    // 检查目标文件是否存在
    const exists = fs.existsSync(input.filePath);

    // 生成docx文件（覆盖已有）
    const generatedPath = await this.docGenerator.generateDocx(
      input.content,
      input.filePath,
      input.templateName,
    );

    // 获取文件大小
    const stat = fs.statSync(generatedPath);

    return {
      filePath: generatedPath,
      fileSize: stat.size,
      wasOverwritten: exists,
    };
  }

  /**
   * 渲染工具调用摘要
   * @param input - 覆盖输入
   * @param output - 覆盖输出
   * @returns 简短摘要文本
   */
  renderSummary(input: DocOverwriteInput, output: DocOverwriteOutput): string {
    const sizeKB = (output.fileSize / 1024).toFixed(1);
    const action = output.wasOverwritten ? '覆盖' : '新建';
    return `[文档${action}] ${input.filePath} (${sizeKB}KB)`;
  }
}
