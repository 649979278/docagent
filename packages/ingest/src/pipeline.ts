/**
 * 文档解析器接口与解析流水线
 * 按文件扩展名路由到对应的DocumentExtractor实现
 * 迭代6增强：幂等控制 - 同文件未变更则跳过，变更则自动reindex
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

import type { ExtractedDocument } from '@workagent/shared';
import { FileParseError, SUPPORTED_FILE_EXTENSIONS, SUPPORTED_FILE_TYPES } from '@workagent/shared';

import { computeHash } from './docx.js';

/**
 * 文档解析器接口
 * 每种文件格式实现此接口，提供格式检测和内容提取能力
 */
export interface DocumentExtractor {
  /**
   * 判断当前解析器是否支持该文件
   * @param filePath - 文件路径
   * @returns 是否支持该文件格式
   */
  supports(filePath: string): boolean;

  /**
   * 从文件中提取文档内容
   * @param filePath - 文件路径
   * @returns 提取后的文档结构
   * @throws {FileParseError} 文件解析失败时抛出
   */
  extract(filePath: string): Promise<ExtractedDocument>;
}

/** 幂等检查结果 */
export interface IdempotentCheckResult {
  /** 是否需要解析（文件新增或内容变更） */
  needsIngest: boolean;
  /** 文件的SHA-256哈希 */
  contentHash: string;
  /** 原因说明 */
  reason: string;
  /** 已有文档ID（如果文件已存在且未变更） */
  existingDocId?: string;
}

/**
 * 解析流水线
 * 管理多个DocumentExtractor，按文件扩展名路由到对应解析器
 * 支持幂等控制：同文件未变更则跳过，变更则自动reindex
 */
export class IngestPipeline {
  /** 已注册的解析器列表 */
  private extractors: DocumentExtractor[] = [];

  /**
   * 注册一个文档解析器
   * 后注册的解析器优先级更高（在列表头部插入）
   * @param extractor - 文档解析器实例
   */
  register(extractor: DocumentExtractor): void {
    this.extractors.unshift(extractor);
  }

  /**
   * 解析文件，自动路由到匹配的解析器
   * @param filePath - 待解析的文件路径
   * @returns 提取后的文档结构
   * @throws {FileParseError} 文件格式不支持或解析失败时抛出
   */
  async ingest(filePath: string): Promise<ExtractedDocument> {
    // 检查文件扩展名是否在支持列表中
    const ext = this.getFileExtension(filePath) as typeof SUPPORTED_FILE_TYPES[number];
    if (!SUPPORTED_FILE_EXTENSIONS.has(ext)) {
      throw new FileParseError(
        filePath,
        ext,
        new Error(`不支持的文件格式: .${ext}，支持的格式: ${[...SUPPORTED_FILE_EXTENSIONS].join(', ')}`),
      );
    }

    // 查找匹配的解析器
    const extractor = this.extractors.find((e) => e.supports(filePath));
    if (!extractor) {
      throw new FileParseError(
        filePath,
        ext,
        new Error(`未找到 .${ext} 格式的解析器，请检查是否已注册对应解析器`),
      );
    }

    // 执行解析
    try {
      return await extractor.extract(filePath);
    } catch (error) {
      // 如果已经是FileParseError则直接抛出
      if (error instanceof FileParseError) {
        throw error;
      }
      // 其他错误包装为FileParseError
      const parseError = error instanceof Error ? error : new Error(String(error));
      throw new FileParseError(filePath, ext, parseError);
    }
  }

  /**
   * 计算文件的SHA-256哈希（用于幂等控制）
   * 读取文件二进制内容计算hash，不依赖解析器
   * @param filePath - 文件路径
   * @returns SHA-256哈希值（十六进制字符串）
   */
  async computeFileHash(filePath: string): Promise<string> {
    const buffer = await fs.promises.readFile(filePath);
    return computeHash(new Uint8Array(buffer));
  }

  /**
   * 幂等检查：判断文件是否需要重新解析
   * 对比文件当前hash与已有记录的hash：
   * - 文件不存在于记录中 → 需要解析（新增）
   * - 文件hash与记录一致 → 跳过（未变更）
   * - 文件hash与记录不一致 → 需要解析（变更，需reindex）
   * @param filePath - 文件路径
   * @param existingHash - 已有记录的SHA-256哈希（可选，从数据库查询）
   * @param existingDocId - 已有文档ID（可选，用于reindex时标识）
   * @returns 幂等检查结果
   */
  async checkIdempotent(
    filePath: string,
    existingHash?: string,
    existingDocId?: string,
  ): Promise<IdempotentCheckResult> {
    const contentHash = await this.computeFileHash(filePath);

    // 无已有记录 → 新增
    if (!existingHash) {
      return {
        needsIngest: true,
        contentHash,
        reason: '新文件，需要解析',
      };
    }

    // hash一致 → 跳过
    if (existingHash === contentHash) {
      return {
        needsIngest: false,
        contentHash,
        reason: '文件未变更，跳过解析',
        existingDocId,
      };
    }

    // hash不一致 → 重新解析
    return {
      needsIngest: true,
      contentHash,
      reason: '文件已变更，需要重新解析',
      existingDocId,
    };
  }

  /**
   * 获取文件扩展名（不含点号，小写）
   * @param filePath - 文件路径
   * @returns 小写扩展名
   */
  private getFileExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot === -1) {
      return '';
    }
    return filePath.slice(lastDot + 1).toLowerCase();
  }
}
