/**
 * 文档解析器接口与解析流水线
 * 按文件扩展名路由到对应的DocumentExtractor实现
 */

import type { ExtractedDocument } from '@workagent/shared';
import { FileParseError, SUPPORTED_FILE_EXTENSIONS, SUPPORTED_FILE_TYPES } from '@workagent/shared';

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

/**
 * 解析流水线
 * 管理多个DocumentExtractor，按文件扩展名路由到对应解析器
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
