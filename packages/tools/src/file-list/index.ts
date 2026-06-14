/**
 * 文件列表工具 - 列出指定目录的文件
 * safety=read_only, mode=both
 */

import type {
  ToolSafety,
  ToolMode,
  PermissionDecision,
  ToolContext,
} from '@workagent/shared';
import type { AgentTool } from '../base.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================
// 输入/输出类型
// ============================================================

/** 文件列表输入 */
export interface FileListInput {
  /** 目录路径 */
  directory: string;
  /** 是否递归列出子目录，默认false */
  recursive?: boolean;
  /** 文件扩展名过滤（如['docx', 'pdf']），为空则不过滤 */
  extensions?: string[];
}

/** 文件信息 */
export interface FileInfo {
  /** 文件/目录名称 */
  name: string;
  /** 完整路径 */
  path: string;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 文件大小（字节） */
  size: number;
  /** 修改时间 */
  modifiedAt: number;
  /** 文件扩展名 */
  extension?: string;
}

/** 文件列表输出 */
export interface FileListOutput {
  /** 目录路径 */
  directory: string;
  /** 文件列表 */
  files: FileInfo[];
  /** 总文件数 */
  total: number;
}

// ============================================================
// FileListTool 实现
// ============================================================

/**
 * 文件列表工具 - 列出指定目录的文件和子目录
 * 只读操作，在chat和plan模式下均可用
 */
export class FileListTool implements AgentTool<FileListInput, FileListOutput> {
  name = 'file_list';
  description = '列出指定目录下的文件和子目录，支持递归和扩展名过滤';
  safety: ToolSafety = 'read_only';
  mode: ToolMode = 'both';

  inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: '要列出的目录路径',
      },
      recursive: {
        type: 'boolean',
        description: '是否递归列出子目录，默认false',
      },
      extensions: {
        type: 'array',
        items: { type: 'string' },
        description: '文件扩展名过滤（如["docx", "pdf"]），为空则不过滤',
      },
    },
    required: ['directory'],
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
  checkPermission(_input: FileListInput, _context: ToolContext): PermissionDecision {
    return { allowed: true, reason: '只读操作，自动允许' };
  }

  /**
   * 执行文件列表
   * @param input - 列表输入参数
   * @param context - 工具执行上下文
   * @returns 文件列表
   */
  async call(input: FileListInput, _context: ToolContext): Promise<FileListOutput> {
    const { directory, recursive = false, extensions } = input;

    // 检查目录是否存在
    if (!fs.existsSync(directory)) {
      return {
        directory,
        files: [],
        total: 0,
      };
    }

    // 检查是否为目录
    const stat = fs.statSync(directory);
    if (!stat.isDirectory()) {
      return {
        directory,
        files: [],
        total: 0,
      };
    }

    const files = this.listFiles(directory, recursive, extensions);

    return {
      directory,
      files,
      total: files.length,
    };
  }

  /**
   * 渲染工具调用摘要
   * @param input - 列表输入
   * @param output - 列表输出
   * @returns 简短摘要文本
   */
  renderSummary(input: FileListInput, output: FileListOutput): string {
    const dirs = output.files.filter((f) => f.isDirectory).length;
    const fileCount = output.files.filter((f) => !f.isDirectory).length;
    return `[文件列表] ${input.directory}: ${fileCount}个文件, ${dirs}个目录`;
  }

  /**
   * 递归列出目录下的文件
   * @param dir - 目录路径
   * @param recursive - 是否递归
   * @param extensions - 扩展名过滤
   * @returns 文件信息列表
   */
  private listFiles(
    dir: string,
    recursive: boolean,
    extensions?: string[],
  ): FileInfo[] {
    const result: FileInfo[] = [];
    const extSet = extensions ? new Set(extensions.map((e) => e.toLowerCase())) : null;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // 目录始终列出
          const dirStat = fs.statSync(fullPath);
          result.push({
            name: entry.name,
            path: fullPath,
            isDirectory: true,
            size: 0,
            modifiedAt: dirStat.mtimeMs,
          });

          // 递归列出子目录
          if (recursive) {
            result.push(...this.listFiles(fullPath, recursive, extensions));
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).slice(1).toLowerCase();

          // 扩展名过滤
          if (extSet && !extSet.has(ext)) {
            continue;
          }

          const fileStat = fs.statSync(fullPath);
          result.push({
            name: entry.name,
            path: fullPath,
            isDirectory: false,
            size: fileStat.size,
            modifiedAt: fileStat.mtimeMs,
            extension: ext || undefined,
          });
        }
      }
    } catch {
      // 目录读取失败时返回空列表
    }

    return result;
  }
}
