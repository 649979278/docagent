/**
 * PDF文件解析器
 * 使用pdf-parse库提取PDF中的文本内容
 * 支持多页PDF，按页分段返回
 */

import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { ExtractedDocument, DocumentSection } from '@workagent/shared';
import { FileParseError } from '@workagent/shared';

import type { DocumentExtractor } from './pipeline.js';
import { computeHash } from './docx.js';

const readFile = promisify(fs.readFile);

/** PDF文件头魔数 */
const PDF_MAGIC = '%PDF-';

/**
 * PDF文件解析器
 * 使用pdf-parse库提取文本，支持多页PDF
 * 如果pdf-parse不可用，回退到基础解析（提取文本流）
 */
export class PdfExtractor implements DocumentExtractor {
  /**
   * 判断是否为pdf文件
   * @param filePath - 文件路径
   * @returns 文件扩展名为pdf时返回true
   */
  supports(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.pdf';
  }

  /**
   * 解析pdf文件，提取文本内容
   * 优先使用pdf-parse库，不可用时回退到基础文本流提取
   * @param filePath - pdf文件路径
   * @returns 提取的文档结构
   * @throws {FileParseError} 文件不是有效PDF或解析失败时抛出
   */
  async extract(filePath: string): Promise<ExtractedDocument> {
    try {
      const fileBuffer = await readFile(filePath);

      // 计算文件内容hash
      const contentHash = computeHash(new Uint8Array(fileBuffer));

      // 检测PDF魔数
      const headerSlice = fileBuffer.subarray(0, Math.min(fileBuffer.length, 5));
      const header = headerSlice.toString('utf-8');
      if (header !== PDF_MAGIC) {
        throw new Error('文件不是有效的PDF格式');
      }

      // 尝试使用pdf-parse提取文本
      let fullText = '';
      let pageCount = 0;
      let usedFallback = false;

      try {
        const pdfParse = await import('pdf-parse');
        const data = await pdfParse.default(fileBuffer);
        fullText = data.text;
        pageCount = data.numpages;
      } catch (importError) {
        // pdf-parse不可用，使用基础文本流提取
        usedFallback = true;
        const result = this.extractTextFromPdfStream(fileBuffer);
        fullText = result.text;
        pageCount = result.pageCount;
      }

      // 按页分段（如果文本中有分页标记）
      const sections = this.splitIntoSections(fullText, pageCount);

      return {
        filePath,
        fileName: path.basename(filePath),
        fileType: 'pdf',
        content: fullText,
        sections,
        metadata: {
          contentHash,
          outline: [],
          sectionCount: sections.length,
          pageCount,
          fileSize: fileBuffer.length,
          extractorVersion: usedFallback ? '1.0.0-fallback' : '1.0.0-pdf-parse',
          usedFallback,
        },
      };
    } catch (error) {
      if (error instanceof FileParseError) {
        throw error;
      }
      const parseError = error instanceof Error ? error : new Error(String(error));
      throw new FileParseError(filePath, 'pdf', parseError);
    }
  }

  /**
   * 将提取的文本按页分段
   * @param text - 完整文本
   * @param pageCount - 总页数
   * @returns 文档章节列表
   */
  private splitIntoSections(text: string, pageCount: number): DocumentSection[] {
    const sections: DocumentSection[] = [];

    if (pageCount <= 1) {
      // 单页PDF，整体作为一个section
      sections.push({
        title: 'PDF内容',
        content: text,
        level: 0,
        locator: '第1页',
      });
      return sections;
    }

    // 尝试按换页符分页
    // pdf-parse可能在页之间插入 \n\n 或 \f
    const pages = text.split(/\f/).filter(p => p.trim());

    if (pages.length > 1) {
      pages.forEach((pageText, index) => {
        sections.push({
          title: `第${index + 1}页`,
          content: pageText.trim(),
          level: 0,
          locator: `第${index + 1}页`,
        });
      });
    } else {
      // 无法按页分割，按固定字符数分段
      const CHUNK_SIZE = 3000;
      for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        const chunk = text.slice(i, i + CHUNK_SIZE);
        const pageNum = Math.floor(i / CHUNK_SIZE) + 1;
        sections.push({
          title: `第${pageNum}段`,
          content: chunk,
          level: 0,
          locator: `第${pageNum}段`,
        });
      }
    }

    return sections;
  }

  /**
   * 基础PDF文本流提取（回退方案）
   * 从PDF的字节流中提取BT...ET之间的文本内容
   * 适用于简单文本PDF，不支持复杂排版
   * @param buffer - PDF文件buffer
   * @returns 提取的文本和页数
   */
  private extractTextFromPdfStream(buffer: Buffer): { text: string; pageCount: number } {
    // 使用Buffer.toString而非TextDecoder，避免TypeScript lib兼容问题
    const content = buffer.toString('utf-8');

    // 统计页数
    const pageCountMatch = content.match(/\/Type\s*\/Page[^s]/g);
    const pageCount = pageCountMatch?.length ?? 1;

    // 提取文本内容：在BT...ET块中查找Tj和TJ操作符
    const textParts: string[] = [];

    // 匹配文本显示操作 (Tj)
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let match: RegExpExecArray | null;
    while ((match = tjRegex.exec(content)) !== null) {
      if (match[1] && !this.isControlString(match[1])) {
        textParts.push(match[1]);
      }
    }

    // 匹配数组文本显示操作 (TJ)
    const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
    while ((match = tjArrayRegex.exec(content)) !== null) {
      if (match[1]) {
        const items = match[1].match(/\(([^)]*)\)/g);
        if (items) {
          for (const item of items) {
            const text = item.slice(1, -1);
            if (text && !this.isControlString(text)) {
              textParts.push(text);
            }
          }
        }
      }
    }

    const text = textParts.join('');
    return { text, pageCount };
  }

  /**
   * 判断字符串是否为PDF控制字符串（非显示文本）
   * @param str - 待检测字符串
   * @returns 是否为控制字符串
   */
  private isControlString(str: string): boolean {
    // 过滤PDF内部标识符（如Font名称、编码等）
    if (/^[A-Z][a-z]\d*$/.test(str)) return true;  // 如 "Helv", "Tx1"
    if (/^\/\w+$/.test(str)) return true;            // 如 "/Type", "/Font"
    if (str.length <= 1) return true;                  // 单字符
    return false;
  }
}
