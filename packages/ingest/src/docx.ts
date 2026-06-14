/**
 * DOCX文件解析器（迭代6升级版）
 * 使用fflate替代手写ZIP解析，fast-xml-parser替代正则解析XML
 * 支持central directory、ZIP64、data descriptor等标准ZIP特性
 * 按段落样式识别标题层级(Heading1-6)，产出带outline的结构化文档
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

import type { ExtractedDocument, DocumentSection } from '@workagent/shared';
import { FileParseError } from '@workagent/shared';

import type { DocumentExtractor } from './pipeline.js';

/** XML解析器实例（复用） */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => {
    // w:p 和 w:r 在 document.xml 中是数组
    return name === 'w:p' || name === 'w:r';
  },
});

/** 读取文件 Promise 封装 */
const readFile = fs.promises.readFile;

/** DOCX段落内部结构 */
interface DocxParagraph {
  /** 段落文本 */
  text: string;
  /** 段落样式名 */
  style: string;
  /** 标题层级（仅标题样式有值） */
  headingLevel: number | null;
}

/**
 * DOCX文件解析器
 * 使用fflate解压ZIP，fast-xml-parser解析XML
 * 支持标题层级检测和outline生成
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
   * 使用fflate解压docx的word/document.xml，使用fast-xml-parser解析XML
   * 按段落样式识别标题层级(Heading1-6)，生成outline大纲
   * @param filePath - docx文件路径
   * @returns 提取的文档结构
   * @throws {FileParseError} 文件读取或解析失败时抛出
   */
  async extract(filePath: string): Promise<ExtractedDocument> {
    try {
      const buffer = await readFile(filePath);

      // 计算文件内容hash（用于幂等控制）
      const contentHash = computeHash(buffer);

      // 使用fflate解压docx
      const unzipped = unzipSync(new Uint8Array(buffer));

      // 读取word/document.xml
      const documentXmlBytes = unzipped['word/document.xml'];
      if (!documentXmlBytes) {
        throw new Error('docx文件中未找到word/document.xml');
      }

      const documentXml = new TextDecoder().decode(documentXmlBytes);

      // 使用fast-xml-parser解析XML
      const paragraphs = this.parseDocumentXml(documentXml);

      // 构建sections
      const sections: DocumentSection[] = paragraphs.map((p, index) => ({
        title: p.style || `段落 ${index + 1}`,
        content: p.text,
        level: p.headingLevel ?? 0,
        locator: `段落${index + 1}`,
      }));

      // 生成outline大纲（仅包含标题段落）
      const outline = this.buildOutline(paragraphs);

      const fullText = paragraphs.map((p) => p.text).join('\n');

      return {
        filePath,
        fileName: path.basename(filePath),
        fileType: 'docx',
        content: fullText,
        sections,
        metadata: {
          contentHash,
          outline,
          sectionCount: sections.length,
          paragraphCount: paragraphs.length,
          extractorVersion: '2.0.0-fflate',
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
   * 使用fast-xml-parser解析document.xml
   * 解析<w:p>段落，提取<w:pStyle>样式和<w:t>文本
   * @param xml - document.xml的文本内容
   * @returns 段落列表
   */
  private parseDocumentXml(xml: string): DocxParagraph[] {
    const paragraphs: DocxParagraph[] = [];

    try {
      const parsed = xmlParser.parse(xml);

      // 导航到 w:document > w:body > w:p
      const body = parsed?.['w:document']?.['w:body'];
      if (!body) return paragraphs;

      const paraElements = body['w:p'];
      if (!paraElements) return paragraphs;

      // 确保是数组
      const paraArray = Array.isArray(paraElements) ? paraElements : [paraElements];

      for (const para of paraArray) {
        const text = this.extractParagraphText(para);
        if (!text.trim()) continue;

        const style = this.extractParagraphStyle(para);
        paragraphs.push({
          text: text.trim(),
          style: style.name,
          headingLevel: style.headingLevel,
        });
      }
    } catch {
      // XML解析失败时回退到正则解析
      return this.parseDocumentXmlFallback(xml);
    }

    return paragraphs;
  }

  /**
   * 从解析后的段落对象中提取文本
   * 遍历 w:p > w:r > w:t 路径
   * @param para - 解析后的段落对象
   * @returns 段落文本
   */
  private extractParagraphText(para: Record<string, unknown>): string {
    const textParts: string[] = [];

    // w:p > w:r 是运行（run），每个run包含一段连续相同样式的文本
    const runs = para['w:r'];
    if (!runs) return '';

    const runArray = Array.isArray(runs) ? runs : [runs];

    for (const run of runArray) {
      if (!run || typeof run !== 'object') continue;

      // w:t 包含实际文本
      const t = (run as Record<string, unknown>)['w:t'];
      if (t !== undefined && t !== null) {
        // fast-xml-parser: 如果w:t有属性，内容在#text中；否则直接是字符串
        if (typeof t === 'string') {
          textParts.push(t);
        } else if (typeof t === 'object' && t !== null) {
          const text = (t as Record<string, unknown>)['#text'];
          if (typeof text === 'string') {
            textParts.push(text);
          }
        }
      }
    }

    return textParts.join('');
  }

  /**
   * 从解析后的段落对象中提取样式
   * 检测w:pPr > w:pStyle的val属性，识别标题层级
   * @param para - 解析后的段落对象
   * @returns 样式信息
   */
  private extractParagraphStyle(para: Record<string, unknown>): { name: string; headingLevel: number | null } {
    // w:p > w:pPr > w:pStyle
    const pPr = para['w:pPr'];
    if (!pPr || typeof pPr !== 'object') {
      return { name: 'Normal', headingLevel: null };
    }

    const pStyle = (pPr as Record<string, unknown>)['w:pStyle'];
    if (!pStyle || typeof pStyle !== 'object') {
      // 可能pStyle直接是字符串（无属性时）
      if (typeof pStyle === 'string') {
        return this.classifyStyle(pStyle);
      }
      return { name: 'Normal', headingLevel: null };
    }

    // 从pStyle对象中取@_w:val属性
    const val = (pStyle as Record<string, unknown>)['@_w:val'];
    if (typeof val === 'string') {
      return this.classifyStyle(val);
    }

    return { name: 'Normal', headingLevel: null };
  }

  /**
   * 根据样式名分类标题层级
   * 支持 Heading1-9 和中文"标题 1-9"格式
   * @param styleName - 样式名
   * @returns 样式信息
   */
  private classifyStyle(styleName: string): { name: string; headingLevel: number | null } {
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

  /**
   * 从段落列表生成outline大纲
   * 仅包含标题段落，保留层级关系
   * @param paragraphs - 段落列表
   * @returns outline大纲数组
   */
  private buildOutline(paragraphs: DocxParagraph[]): string[] {
    const outline: string[] = [];
    for (const p of paragraphs) {
      if (p.headingLevel !== null && p.headingLevel >= 1 && p.headingLevel <= 6) {
        const indent = '  '.repeat(p.headingLevel - 1);
        outline.push(`${indent}${p.text}`);
      }
    }
    return outline;
  }

  /**
   * XML解析失败时的回退方案：使用正则解析
   * 保留与旧版一致的解析逻辑，确保兼容性
   * @param xml - document.xml的文本内容
   * @returns 段落列表
   */
  private parseDocumentXmlFallback(xml: string): DocxParagraph[] {
    const paragraphs: DocxParagraph[] = [];

    // 按<w:p>...</w:p>拆分段落
    const paragraphRegex = /<w:p[\s>](.*?)<\/w:p>/gs;
    let match: RegExpExecArray | null;

    while ((match = paragraphRegex.exec(xml)) !== null) {
      const paragraphContent = match[1];

      // 提取段落样式
      const style = this.extractParagraphStyleRegex(paragraphContent);

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
   * 正则方式提取段落样式（回退方案）
   * @param paragraphContent - 段落XML内容
   * @returns 样式信息
   */
  private extractParagraphStyleRegex(paragraphContent: string): { name: string; headingLevel: number | null } {
    const styleMatch = paragraphContent.match(/<w:pStyle\s+w:val="([^"]*)"/);
    if (!styleMatch) {
      return { name: 'Normal', headingLevel: null };
    }

    const styleName = styleMatch[1];
    return this.classifyStyle(styleName);
  }
}

/**
 * 计算文件Buffer的SHA-256哈希
 * @param data - 文件二进制数据
 * @returns SHA-256哈希值（十六进制字符串）
 */
export function computeHash(data: Uint8Array | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
