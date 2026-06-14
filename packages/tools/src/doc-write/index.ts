/**
 * 文档生成工具 - 生成新docx文件到输出目录
 * safety=write_output, mode=execute
 */

import type {
  ToolSafety,
  ToolMode,
  PermissionDecision,
  ToolContext,
} from '@workagent/shared';
import { OUTPUT_DIR_NAME, APP_DATA_RELATIVE_PATH } from '@workagent/shared';
import type { AgentTool } from '../base.js';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

// ============================================================
// 文档生成依赖接口
// ============================================================

/** 文档生成器接口 - 由@workagent/docgen包提供实现 */
export interface DocumentGenerator {
  /** 将Markdown内容生成docx文件 */
  generateDocx(markdownContent: string, outputPath: string, templateName?: string): Promise<string>;
}

// ============================================================
// 输入/输出类型
// ============================================================

/** 文档生成输入 */
export interface DocWriteInput {
  /** Markdown格式的文档内容 */
  content: string;
  /** 输出文件名（不含路径，如"报告.docx"） */
  fileName: string;
  /** 文档模板名称（可选） */
  templateName?: string;
}

/** 文档生成输出 */
export interface DocWriteOutput {
  /** 生成的文件完整路径 */
  filePath: string;
  /** 文件大小（字节） */
  fileSize: number;
}

// ============================================================
// DocWriteTool 实现
// ============================================================

/**
 * 文档生成工具 - 生成新docx文件到输出目录
 * 首次使用需要用户确认，确认后可持久化授权
 * 仅在execute模式下可用
 */
export class DocWriteTool implements AgentTool<DocWriteInput, DocWriteOutput> {
  name = 'doc_write';
  description = '将Markdown格式的草稿内容生成为新的docx文件，保存到输出目录。不会覆盖已有文件';
  safety: ToolSafety = 'write_output';
  mode: ToolMode = 'execute';

  inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Markdown格式的文档内容',
      },
      fileName: {
        type: 'string',
        description: '输出文件名（不含路径，如"报告.docx"）',
      },
      templateName: {
        type: 'string',
        description: '文档模板名称（可选）',
      },
    },
    required: ['content', 'fileName'],
  };

  /** 文档生成器实例 */
  private docGenerator: DocumentGenerator;

  /**
   * 创建文档生成工具
   * @param docGenerator - 文档生成器实例
   */
  constructor(docGenerator: DocumentGenerator) {
    this.docGenerator = docGenerator;
  }

  /**
   * 判断工具是否为只读
   * @returns 始终为false（文件输出操作）
   */
  isReadOnly(): boolean {
    return false;
  }

  /**
   * 检查权限 - 文件输出首次确认可持久化
   * @param input - 工具输入
   * @param context - 工具执行上下文
   * @returns 权限决策
   */
  checkPermission(_input: DocWriteInput, context: ToolContext): PermissionDecision {
    if (context.permissions[this.name] === 'allowed') {
      return { allowed: true, reason: '已有持久化授权' };
    }
    return {
      allowed: false,
      reason: '文档输出操作需要确认',
      remember: true,
    };
  }

  /**
   * 执行文档生成
   * @param input - 生成输入参数
   * @param context - 工具执行上下文
   * @returns 生成结果
   */
  async call(input: DocWriteInput, _context: ToolContext): Promise<DocWriteOutput> {
    // 确保输出目录存在
    const outputDir = this.getOutputDir();
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, input.fileName);

    // 检查文件是否已存在
    if (fs.existsSync(outputPath)) {
      throw new Error(`文件已存在: ${input.fileName}，请使用doc_overwrite工具覆盖已有文件`);
    }

    // 生成docx文件
    const generatedPath = await this.docGenerator.generateDocx(
      input.content,
      outputPath,
      input.templateName,
    );

    // 获取文件大小
    const stat = fs.statSync(generatedPath);

    return {
      filePath: generatedPath,
      fileSize: stat.size,
    };
  }

  /**
   * 渲染工具调用摘要
   * @param input - 生成输入
   * @param output - 生成输出
   * @returns 简短摘要文本
   */
  renderSummary(input: DocWriteInput, output: DocWriteOutput): string {
    const sizeKB = (output.fileSize / 1024).toFixed(1);
    return `[文档生成] ${input.fileName} -> ${output.filePath} (${sizeKB}KB)`;
  }

  /**
   * 获取输出目录路径
   * @returns 输出目录的绝对路径
   */
  private getOutputDir(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, APP_DATA_RELATIVE_PATH, OUTPUT_DIR_NAME);
  }
}
