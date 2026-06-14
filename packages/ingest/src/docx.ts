/**
 * DOCX文件解析器
 * 一期使用Node.js内置zlib解压docx的word/document.xml提取纯文本
 * 不依赖mammoth等第三方包
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

import type { ExtractedDocument, DocumentSection } from '@workagent/shared';
import { FileParseError } from '@workagent/shared';

import type { DocumentExtractor } from './pipeline.js';

const inflateRaw = promisify(zlib.inflateRaw);
const readFile = promisify(fs.readFile);

/**
 * DOCX文件解析器
 * 通过解压ZIP包并解析word/document.xml中的<w:t>标签提取文本内容
 */
export class DocxExtractor implements DocumentExtractor {
  /**
   * 判断是否为docx文件
   * @param filePath - 文件路径
   * @returns 文件扩展名为docx时返回true
   */
  supports(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.docx';
  }

  /**
   * 解析docx文件，提取文本内容
   * 解压docx的word/document.xml，提取所有<w:t>标签的文本
   * @param filePath - docx文件路径
   * @returns 提取的文档结构
   * @throws {FileParseError} 文件读取或解压失败时抛出
   */
  async extract(filePath: string): Promise<ExtractedDocument> {
    try {
      const buffer = await readFile(filePath);

      // 解压docx（本质是ZIP格式），找到word/document.xml
      const documentXml = await this.extractDocumentXml(buffer);

      // 从XML中提取文本段落
      const paragraphs = this.parseDocumentXml(documentXml);

      // 构建sections
      const sections: DocumentSection[] = paragraphs.map((p, index) => ({
        title: p.style || `段落 ${index + 1}`,
        content: p.text,
        level: p.headingLevel ?? 0,
        locator: `段落${index + 1}`,
      }));

      const fullText = paragraphs.map((p) => p.text).join('\n');

      return {
        filePath,
        fileName: path.basename(filePath),
        fileType: 'docx',
        content: fullText,
        sections,
        metadata: {
          paragraphCount: paragraphs.length,
          extractorVersion: '1.0.0-zlib',
        },
      };
    } catch (error) {
      if (error instanceof FileParseError) {
        throw error;
      }
      const parseError = error instanceof Error ? error : new Error(String(error));
      throw new FileParseError(filePath, 'docx', parseError);
    }
  }

  /**
   * 从docx的ZIP包中提取word/document.xml内容
   * 手动解析ZIP本地文件头，定位word/document.xml条目并解压
   * @param buffer - docx文件的原始Buffer
   * @returns document.xml的文本内容
   */
  private async extractDocumentXml(data: Uint8Array): Promise<string> {
    // ZIP文件由本地文件头条目组成，每个条目格式：
    // [本地文件头] + [文件数据]
    // 本地文件头签名: 0x04034b50 (PK\x03\x04)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const decoder = new TextDecoder();
    let offset = 0;

    while (offset < data.length - 4) {
      const sig = view.getUint32(offset, true);

      // 本地文件头签名
      if (sig !== 0x04034b50) {
        break;
      }

      // 解析本地文件头
      const compressionMethod = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const fileNameLen = view.getUint16(offset + 26, true);
      const extraFieldLen = view.getUint16(offset + 28, true);

      const fileNameOffset = offset + 30;
      const fileName = decoder.decode(data.subarray(fileNameOffset, fileNameOffset + fileNameLen));

      const dataOffset = fileNameOffset + fileNameLen + extraFieldLen;

      // 查找word/document.xml
      if (fileName === 'word/document.xml') {
        const compressedData = data.subarray(dataOffset, dataOffset + compressedSize);

        // 压缩方法: 0=存储(不压缩), 8=Deflate
        if (compressionMethod === 0) {
          return decoder.decode(compressedData);
        } else if (compressionMethod === 8) {
          const decompressed = await inflateRaw(compressedData);
          return decoder.decode(decompressed);
        } else {
          throw new Error(`不支持的压缩方法: ${compressionMethod}`);
        }
      }

      // 跳到下一个本地文件头
      offset = dataOffset + compressedSize;
    }

    throw new Error('docx文件中未找到word/document.xml');
  }

  /**
   * 解析document.xml，提取文本段落
   * 识别<w:p>段落和<w:t>文本标签，同时检测标题样式
   * @param xml - document.xml的文本内容
   * @returns 段落列表
   */
  private parseDocumentXml(xml: string): DocxParagraph[] {
    const paragraphs: DocxParagraph[] = [];

    // 按<w:p>...</w:p>拆分段落
    const paragraphRegex = /<w:p[\s>](.*?)<\/w:p>/gs;
    let match: RegExpExecArray | null;

    while ((match = paragraphRegex.exec(xml)) !== null) {
      const paragraphContent = match[1];

      // 提取段落样式
      const style = this.extractParagraphStyle(paragraphContent);

      // 提取<w:t>标签文本
      const textParts: string[] = [];
      const textRegex = /<w:t[^>]*>(.*?)<\/w:t>/gs;
      let textMatch: RegExpExecArray | null;
      while ((textMatch = textRegex.exec(paragraphContent)) !== null) {
        textParts.push(textMatch[1]);
      }

      const text = textParts.join('');
      if (text.trim()) {
        paragraphs.push({
          text: text.trim(),
          style: style.name,
          headingLevel: style.headingLevel,
        });
      }
    }

    return paragraphs;
  }

  /**
   * 提取段落的样式信息
   * 检测是否为标题样式（Heading1-9），返回样式名和标题层级
   * @param paragraphContent - 段落XML内容
   * @returns 样式信息
   */
  private extractParagraphStyle(paragraphContent: string): { name: string; headingLevel: number | null } {
    // 查找<w:pStyle w:val="..."/>
    const styleMatch = paragraphContent.match(/<w:pStyle\s+w:val="([^"]*)"/);
    if (!styleMatch) {
      return { name: 'Normal', headingLevel: null };
    }

    const styleName = styleMatch[1];

    // 检测标题样式（Heading1~Heading9 或 标题 1~9）
    const headingMatch = styleName.match(/Heading(\d)/i) || styleName.match(/标题\s*(\d)/);
    if (headingMatch) {
      return {
        name: styleName,
        headingLevel: parseInt(headingMatch[1], 10),
      };
    }

    return { name: styleName, headingLevel: null };
  }
}

/** DOCX段落内部结构 */
interface DocxParagraph {
  /** 段落文本 */
  text: string;
  /** 段落样式名 */
  style: string;
  /** 标题层级（仅标题样式有值） */
  headingLevel: number | null;
}
