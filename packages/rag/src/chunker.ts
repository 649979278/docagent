/**
 * 文档分块器
 * 按标题/段落分块，支持重叠，保留metadata定位信息
 */

import crypto from 'node:crypto';

import type { ExtractedDocument, DocumentSection, ChunkMetadata } from '@workagent/shared';
import { CHUNK_SIZE, CHUNK_OVERLAP } from '@workagent/shared';

/** 文档分块结果 */
export interface DocumentChunk {
  /** 块ID */
  chunkId: string;
  /** 块内容 */
  content: string;
  /** 块元数据 */
  metadata: ChunkMetadata;
}

/**
 * 文档分块器
 * 将ExtractedDocument按标题/段落分块，每块300-500字，重叠50字
 * 保留来源文件、页码/段落定位等metadata
 */
export class DocumentChunker {
  /** 块大小上限（字符数） */
  private chunkSize: number;

  /** 块重叠大小（字符数） */
  private chunkOverlap: number;

  /**
   * 创建文档分块器
   * @param chunkSize - 块大小上限，默认使用shared中定义的CHUNK_SIZE
   * @param chunkOverlap - 块重叠大小，默认使用shared中定义的CHUNK_OVERLAP
   */
  constructor(chunkSize: number = CHUNK_SIZE, chunkOverlap: number = CHUNK_OVERLAP) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
  }

  /**
   * 将提取的文档分块
   * 优先按标题/section边界分块，过长section按段落再分
   * @param document - 提取的文档
   * @returns 文档块列表
   */
  chunk(document: ExtractedDocument): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let chunkIndex = 0;

    for (const section of document.sections) {
      // 如果section内容在块大小范围内，直接作为一个块
      if (section.content.length <= this.chunkSize) {
        chunks.push(this.createChunk(document, section, section.content, chunkIndex++));
        continue;
      }

      // 过长的section按段落拆分
      const subChunks = this.splitLongSection(document, section, chunkIndex);
      chunks.push(...subChunks);
      chunkIndex += subChunks.length;
    }

    // 如果没有sections，按全文内容分块
    if (chunks.length === 0 && document.content) {
      const textChunks = this.splitText(document.content);
      for (let i = 0; i < textChunks.length; i++) {
        chunks.push(
          this.createChunkFromText(document, textChunks[i], i),
        );
      }
    }

    return chunks;
  }

  /**
   * 拆分过长的section为多个块
   * 尝试按段落边界分割，保持重叠
   * @param document - 源文档
   * @param section - 过长的section
   * @param startIndex - 起始块索引
   * @returns 拆分后的块列表
   */
  private splitLongSection(
    document: ExtractedDocument,
    section: DocumentSection,
    startIndex: number,
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const paragraphs = this.splitIntoParagraphs(section.content);
    let currentText = '';
    let chunkIndex = startIndex;

    for (const paragraph of paragraphs) {
      // 如果加上这个段落不超限，继续累加
      if (currentText.length + paragraph.length + 1 <= this.chunkSize) {
        currentText = currentText ? `${currentText}\n${paragraph}` : paragraph;
      } else {
        // 当前累加文本已达上限，保存为块
        if (currentText) {
          chunks.push(this.createChunk(document, section, currentText, chunkIndex++));
        }

        // 开始新块，添加重叠内容
        if (this.chunkOverlap > 0 && currentText.length > this.chunkOverlap) {
          const overlapText = currentText.slice(-this.chunkOverlap);
          currentText = `${overlapText}\n${paragraph}`;
        } else {
          currentText = paragraph;
        }
      }
    }

    // 保存最后一个块
    if (currentText) {
      chunks.push(this.createChunk(document, section, currentText, chunkIndex));
    }

    return chunks;
  }

  /**
   * 按固定大小分块纯文本（无section结构时的回退方案）
   * @param text - 纯文本
   * @returns 文本块列表
   */
  private splitText(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + this.chunkSize;

      // 尝试在句子边界处分割
      if (end < text.length) {
        const lastPeriod = text.lastIndexOf('。', end);
        const lastNewline = text.lastIndexOf('\n', end);
        const boundary = Math.max(lastPeriod, lastNewline);

        if (boundary > start) {
          end = boundary + 1;
        }
      }

      chunks.push(text.slice(start, end).trim());
      start = end - this.chunkOverlap;

      if (start <= end - this.chunkSize) {
        // 防止无限循环（overlap过大时）
        start = end;
      }
    }

    return chunks.filter((c) => c.length > 0);
  }

  /**
   * 将文本按段落分割
   * 以连续换行或中文句号作为段落边界
   * @param text - 文本内容
   * @returns 段落列表
   */
  private splitIntoParagraphs(text: string): string[] {
    // 先按空行分段
    const paragraphs = text.split(/\n\s*\n/);

    // 如果只有一段，按单换行分段
    if (paragraphs.length <= 1) {
      return text.split('\n').filter((p) => p.trim().length > 0);
    }

    return paragraphs.filter((p) => p.trim().length > 0);
  }

  /**
   * 从section创建文档块
   * @param document - 源文档
   * @param section - 源section
   * @param content - 块内容
   * @param chunkIndex - 块索引
   * @returns 文档块
   */
  private createChunk(
    document: ExtractedDocument,
    section: DocumentSection,
    content: string,
    chunkIndex: number,
  ): DocumentChunk {
    return {
      chunkId: this.generateChunkId(document.filePath, chunkIndex),
      content,
      metadata: {
        sourceFile: document.filePath,
        sourceType: document.fileType,
        chunkIndex,
        locator: section.locator,
        title: section.title,
        contentHash: this.hashContent(content),
      },
    };
  }

  /**
   * 从纯文本创建文档块（无section信息）
   * @param document - 源文档
   * @param content - 块内容
   * @param chunkIndex - 块索引
   * @returns 文档块
   */
  private createChunkFromText(
    document: ExtractedDocument,
    content: string,
    chunkIndex: number,
  ): DocumentChunk {
    return {
      chunkId: this.generateChunkId(document.filePath, chunkIndex),
      content,
      metadata: {
        sourceFile: document.filePath,
        sourceType: document.fileType,
        chunkIndex,
        locator: `段落${chunkIndex + 1}`,
        contentHash: this.hashContent(content),
      },
    };
  }

  /**
   * 生成文档块ID
   * 格式: chunk_{文件路径hash}_{块索引}
   * @param filePath - 文件路径
   * @param chunkIndex - 块索引
   * @returns 块ID
   */
  private generateChunkId(filePath: string, chunkIndex: number): string {
    const pathHash = this.hashContent(filePath).slice(0, 8);
    return `chunk_${pathHash}_${chunkIndex}`;
  }

  /**
   * 计算文本的SHA-256哈希
   * @param content - 文本内容
   * @returns 哈希值（十六进制字符串）
   */
  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
