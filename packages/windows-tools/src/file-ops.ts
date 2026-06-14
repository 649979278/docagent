/**
 * 原生文件操作工具
 * 提供安全的文件系统访问能力
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SUPPORTED_FILE_EXTENSIONS, SUPPORTED_FILE_TYPES, LEGACY_FILE_TYPES, LEGACY_FORMAT_HINT } from '@workagent/shared';

/** 文件信息 */
export interface FileInfo {
  name: string;
  path: string;
  extension: string;
  size: number;
  modifiedAt: number;
  isDirectory: boolean;
  isSupported: boolean;
  needsConversion: boolean;
}

/**
 * 列出目录下的文件
 * @param dirPath - 目录路径
 * @param recursive - 是否递归列出
 * @returns 文件信息列表
 */
export function listFiles(dirPath: string, recursive = false): FileInfo[] {
  if (!fs.existsSync(dirPath)) return [];

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: FileInfo[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory() && recursive) {
      files.push(...listFiles(fullPath, true));
    }

    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase().slice(1);
      const stat = fs.statSync(fullPath);
      files.push({
        name: entry.name,
        path: fullPath,
        extension: ext,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        isDirectory: false,
        isSupported: SUPPORTED_FILE_EXTENSIONS.has(ext as typeof SUPPORTED_FILE_TYPES[number]),
        needsConversion: (LEGACY_FILE_TYPES as readonly string[]).includes(ext),
      });
    }
  }

  return files;
}

/**
 * 检查文件是否可读
 */
export function isFileReadable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 计算文件SHA-256哈希
 */
export function computeFileHash(filePath: string): string {
  const { createHash } = require('node:crypto');
  const content = fs.readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * 确保目录存在
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 获取应用数据目录路径
 * Windows: %USERPROFILE%/WorkAgent/
 * macOS: ~/WorkAgent/
 */
export function getAppDataDir(): string {
  return path.join(require('node:os').homedir(), 'WorkAgent');
}

/**
 * 获取默认知识库目录
 */
export function getDefaultKnowledgeDir(): string {
  const homeDir = require('node:os').homedir();
  const docsDir = path.join(homeDir, 'Documents', 'WorkAgent');
  ensureDir(docsDir);
  return docsDir;
}

/**
 * 获取输出目录
 */
export function getOutputDir(): string {
  const outputDir = path.join(getAppDataDir(), 'output');
  ensureDir(outputDir);
  return outputDir;
}
