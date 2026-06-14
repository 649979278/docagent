/**
 * 文档读取工具 - 解析指定文件或目录并返回结构化内容
 * safety=read_only, mode=both
 * 支持传入文件路径或目录路径：
 * - 文件路径：直接解析该文件
 * - 目录路径：自动扫描目录下所有支持的文件并批量读取
 */

import type {
  ToolSafety,
  ToolMode,
  PermissionDecision,
  ToolContext,
  ExtractedDocument,
} from '@workagent/shared';
import { SUPPORTED_FILE_EXTENSIONS, SUPPORTED_FILE_TYPES } from '@workagent/shared';
import { FileParseError } from '@workagent/shared';
import type { AgentTool } from '../base.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================
// 文档解析依赖接口
// ============================================================

/** 文档解析管道接口 - 由@workagent/ingest包提供实现 */
export interface IngestPipeline {
  /** 解析文件，返回结构化文档内容 */
  parseFile(filePath: string): Promise<ExtractedDocument>;
  /** 解析文件（ingest别名） */
  ingest(filePath: string): Promise<ExtractedDocument>;
}

// ============================================================
// 输入/输出类型
// ============================================================

/** 单个文档的读取结果 */
export interface DocReadItem {
  /** 文件名 */
  fileName: string;
  /** 文件类型 */
  fileType: string;
  /** 解析后的纯文本内容 */
  content: string;
  /** 文档章节列表 */
  sections: ExtractedDocument['sections'];
  /** 文档元数据 */
  metadata: Record<string, unknown>;
  /** 错误信息（解析失败时） */
  error?: string;
}

/** 文档读取输入 */
export interface DocReadInput {
  /** 文件路径或目录路径 */
  filePath: string;
  /** 当路径为目录时，是否递归扫描子目录，默认false */
  recursive?: boolean;
}

/** 文档读取输出 */
export interface DocReadOutput {
  /** 读取的文档列表（单文件时只有一个元素，目录时可能有多个） */
  documents: DocReadItem[];
  /** 成功解析的文档数 */
  successCount: number;
  /** 解析失败的文档数 */
  failCount: number;
  /** 输入路径类型：file 或 directory */
  pathType: 'file' | 'directory';
}

// ============================================================
// DocReadTool 实现
// ============================================================

/**
 * 文档读取工具 - 解析指定文件或目录并返回结构化内容
 * 只读操作，在chat和plan模式下均可用
 * 支持传入目录路径，会自动扫描目录下所有支持的文档文件
 */
export class DocReadTool implements AgentTool<DocReadInput, DocReadOutput> {
  name = 'doc_read';
  description = '读取并解析指定文件或目录（docx/pptx/pdf/txt/md）。传入文件路径则解析单个文件；传入目录路径则自动扫描目录下所有支持的文档文件并批量读取。返回结构化的文档内容和章节信息';
  safety: ToolSafety = 'read_only';
  mode: ToolMode = 'both';

  inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: '要读取的文件路径或目录路径。传入目录时会自动扫描其中的文档文件',
      },
      recursive: {
        type: 'boolean',
        description: '当路径为目录时，是否递归扫描子目录，默认false',
      },
    },
    required: ['filePath'],
  };

  /** 文档解析管道实例 */
  private ingestPipeline: IngestPipeline;

  /**
   * 创建文档读取工具
   * @param ingestPipeline - 文档解析管道实例
   */
  constructor(ingestPipeline: IngestPipeline) {
    this.ingestPipeline = ingestPipeline;
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
  checkPermission(_input: DocReadInput, _context: ToolContext): PermissionDecision {
    return { allowed: true, reason: '只读操作，自动允许' };
  }

  /**
   * 执行文档读取
   * 支持文件路径和目录路径：
   * - 文件路径：直接解析该文件
   * - 目录路径：自动扫描目录下所有支持的文档文件并批量读取
   * @param input - 读取输入参数
   * @param context - 工具执行上下文
   * @returns 文档内容列表
   */
  async call(input: DocReadInput, _context: ToolContext): Promise<DocReadOutput> {
    const filePath = input.filePath;

    // 判断路径类型
    if (!fs.existsSync(filePath)) {
      // 路径不存在，尝试作为文件处理（可能IngestPipeline有远程逻辑）
      return this.readSingleFile(filePath);
    }

    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // 目录路径：扫描并批量读取
      return this.readDirectory(filePath, input.recursive ?? false);
    } else {
      // 文件路径：直接读取
      return this.readSingleFile(filePath);
    }
  }

  /**
   * 读取单个文件
   * @param filePath - 文件路径
   * @returns 读取结果
   */
  private async readSingleFile(filePath: string): Promise<DocReadOutput> {
    const docItem: DocReadItem = {
      fileName: path.basename(filePath),
      fileType: this.getFileExtension(filePath) || 'unknown',
      content: '',
      sections: [],
      metadata: {},
    };

    try {
      // 校验文件类型
      const ext = this.getFileExtension(filePath);
      if (ext && !SUPPORTED_FILE_EXTENSIONS.has(ext as (typeof SUPPORTED_FILE_TYPES)[number])) {
        throw new FileParseError(
          filePath,
          ext,
          new Error(`不支持的文件类型: ${ext}`),
        );
      }

      // 调用解析管道 — 兼容ingest和parseFile两种方法名
      const doc = await (this.ingestPipeline.ingest
        ? this.ingestPipeline.ingest(filePath)
        : this.ingestPipeline.parseFile(filePath));

      docItem.fileName = doc.fileName;
      docItem.fileType = doc.fileType;
      docItem.content = doc.content;
      docItem.sections = doc.sections;
      docItem.metadata = doc.metadata;

      return {
        documents: [docItem],
        successCount: 1,
        failCount: 0,
        pathType: 'file',
      };
    } catch (err) {
      docItem.error = err instanceof Error ? err.message : String(err);
      return {
        documents: [docItem],
        successCount: 0,
        failCount: 1,
        pathType: 'file',
      };
    }
  }

  /**
   * 扫描目录并批量读取所有支持的文档文件
   * @param dirPath - 目录路径
   * @param recursive - 是否递归扫描子目录
   * @returns 批量读取结果
   */
  private async readDirectory(dirPath: string, recursive: boolean): Promise<DocReadOutput> {
    // 扫描目录下所有支持的文档文件
    const filePaths = this.scanDirectory(dirPath, recursive);

    if (filePaths.length === 0) {
      return {
        documents: [],
        successCount: 0,
        failCount: 0,
        pathType: 'directory',
      };
    }

    // 批量解析文件
    const documents: DocReadItem[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const fp of filePaths) {
      const docItem: DocReadItem = {
        fileName: path.basename(fp),
        fileType: this.getFileExtension(fp),
        content: '',
        sections: [],
        metadata: {},
      };

      try {
        const doc = await (this.ingestPipeline.ingest
          ? this.ingestPipeline.ingest(fp)
          : this.ingestPipeline.parseFile(fp));

        docItem.fileName = doc.fileName;
        docItem.fileType = doc.fileType;
        docItem.content = doc.content;
        docItem.sections = doc.sections;
        docItem.metadata = doc.metadata;
        successCount++;
      } catch (err) {
        docItem.error = err instanceof Error ? err.message : String(err);
        failCount++;
      }

      documents.push(docItem);
    }

    return {
      documents,
      successCount,
      failCount,
      pathType: 'directory',
    };
  }

  /**
   * 扫描目录，返回所有支持的文档文件路径
   * @param dirPath - 目录路径
   * @param recursive - 是否递归扫描
   * @returns 文件路径列表
   */
  private scanDirectory(dirPath: string, recursive: boolean): string[] {
    const result: string[] = [];

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory() && recursive) {
          result.push(...this.scanDirectory(fullPath, recursive));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).slice(1).toLowerCase();
          if (SUPPORTED_FILE_EXTENSIONS.has(ext as (typeof SUPPORTED_FILE_TYPES)[number])) {
            result.push(fullPath);
          }
        }
      }
    } catch {
      // 目录扫描失败时返回空列表
    }

    return result;
  }

  /**
   * 渲染工具调用摘要
   * @param input - 读取输入
   * @param output - 读取输出
   * @returns 简短摘要文本
   */
  renderSummary(input: DocReadInput, output: DocReadOutput): string {
    if (output.pathType === 'directory') {
      return `[文档读取] 目录 ${input.filePath}: 扫描到${output.documents.length}个文档, 成功${output.successCount}个, 失败${output.failCount}个`;
    }
    const doc = output.documents[0];
    if (!doc) return `[文档读取] ${input.filePath}: 无结果`;
    if (doc.error) return `[文档读取] ${doc.fileName}: 解析失败 - ${doc.error}`;
    const sectionCount = doc.sections?.length ?? 0;
    const contentPreview = (doc.content ?? '').slice(0, 50).replace(/\n/g, ' ');
    return `[文档读取] ${doc.fileName} (${doc.fileType}), ${sectionCount}个章节, 内容预览: ${contentPreview}...`;
  }

  /**
   * 从文件路径中提取扩展名
   * @param filePath - 文件路径
   * @returns 小写扩展名
   */
  private getFileExtension(filePath: string): string {
    const parts = filePath.split('.');
    if (parts.length < 2) return '';
    return parts[parts.length - 1].toLowerCase();
  }
}
