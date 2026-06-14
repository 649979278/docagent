/**
 * PPTX文件解析器（迭代6升级版）
 * 使用fflate替代手写ZIP解析，fast-xml-parser替代正则解析XML
 * 支持central directory、ZIP64、data descriptor等标准ZIP特性
 * 从ppt/slides/slideN.xml提取标题、shape文本和notes
 * locator格式为"幻灯片N"
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

import type { ExtractedDocument, DocumentSection } from '@workagent/shared';
import { FileParseError } from '@workagent/shared';

import type { DocumentExtractor } from './pipeline.js';
import { computeHash } from './docx.js';

/** XML解析器实例（复用） */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => {
    // a:r 在幻灯片XML中是数组
    return name === 'a:r' || name === 'p:sp' || name === 'p:cxnSp';
  },
});

/** 读取文件 Promise 封装 */
const readFile = fs.promises.readFile;

/** 幻灯片ZIP条目 */
interface SlideEntry {
  /** 幻灯片编号 */
  slideNumber: number;
  /** 幻灯片XML内容 */
  xml: string;
  /** 备注XML内容（可选） */
  notesXml?: string;
}

/** 幻灯片解析结果 */
interface SlideContent {
  /** 幻灯片编号 */
  slideNumber: number;
  /** 提取的文本项 */
  texts: string[];
  /** 标题文本（如果有） */
  title?: string;
}

/**
 * PPTX文件解析器
 * 使用fflate解压ZIP，fast-xml-parser解析slide XML
 * 从ppt/slides/slideN.xml提取标题、shape文本和notes
 */
export class PptxExtractor implements DocumentExtractor {
  /**
   * 判断是否为pptx文件
   * @param filePath - 文件路径
   * @returns 文件扩展名为pptx时返回true
   */
  supports(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.pptx';
  }

  /**
   * 解析pptx文件，提取所有幻灯片文本
   * 使用fflate解压，fast-xml-parser解析XML
   * 按幻灯片编号排序，提取标题/shape文本/notes
   * @param filePath - pptx文件路径
   * @returns 提取的文档结构
   * @throws {FileParseError} 文件读取或解析失败时抛出
   */
  async extract(filePath: string): Promise<ExtractedDocument> {
    try {
      const buffer = await readFile(filePath);

      // 计算文件内容hash
      const contentHash = computeHash(new Uint8Array(buffer));

      // 使用fflate解压pptx
      const unzipped = unzipSync(new Uint8Array(buffer));

      // 从ZIP包中提取所有幻灯片XML
      const slideEntries = this.extractSlideXmls(unzipped);

      if (slideEntries.length === 0) {
        throw new Error('pptx文件中未找到幻灯片');
      }

      // 按幻灯片编号排序
      slideEntries.sort((a, b) => a.slideNumber - b.slideNumber);

      // 解析每张幻灯片的文本
      const sections: DocumentSection[] = [];
      const allTexts: string[] = [];
      const outline: string[] = [];

      for (const entry of slideEntries) {
        const content = this.parseSlideXml(entry.xml, entry.notesXml);
        const slideText = content.texts.join('\n');

        if (slideText.trim()) {
          sections.push({
            title: content.title ?? `幻灯片 ${entry.slideNumber}`,
            content: slideText.trim(),
            level: 0,
            locator: `幻灯片${entry.slideNumber}`,
          });
          allTexts.push(slideText.trim());

          // 如果有标题，加入outline
          if (content.title) {
            outline.push(content.title);
          }
        }
      }

      return {
        filePath,
        fileName: path.basename(filePath),
        fileType: 'pptx',
        content: allTexts.join('\n\n'),
        sections,
        metadata: {
          contentHash,
          outline,
          sectionCount: sections.length,
          slideCount: slideEntries.length,
          extractorVersion: '2.0.0-fflate',
        },
      };
    } catch (error) {
      if (error instanceof FileParseError) {
        throw error;
      }
      const parseError = error instanceof Error ? error : new Error(String(error));
      throw new FileParseError(filePath, 'pptx', parseError);
    }
  }

  /**
   * 从fflate解压结果中提取所有幻灯片XML
   * 匹配文件名为ppt/slides/slideN.xml的条目
   * 同时尝试提取ppt/notesSlides/notesSlideN.xml
   * @param unzipped - fflate解压后的文件映射
   * @returns 幻灯片条目列表
   */
  private extractSlideXmls(unzipped: Record<string, Uint8Array>): SlideEntry[] {
    const entries: SlideEntry[] = [];
    const decoder = new TextDecoder();

    // 提取幻灯片
    for (const [fileName, data] of Object.entries(unzipped)) {
      const slideMatch = fileName.match(/^ppt\/slides\/slide(\d{1,3})\.xml$/);
      if (slideMatch) {
        const slideNumber = parseInt(slideMatch[1], 10);
        const xml = decoder.decode(data);

        // 尝试查找对应的备注
        const notesKey = `ppt/notesSlides/notesSlide${slideNumber}.xml`;
        const notesXml = unzipped[notesKey]
          ? decoder.decode(unzipped[notesKey])
          : undefined;

        entries.push({ slideNumber, xml, notesXml });
      }
    }

    return entries;
  }

  /**
   * 使用fast-xml-parser解析单张幻灯片XML
   * 从<a:t>标签提取文本，尝试识别标题占位符
   * @param xml - slide XML内容
   * @param notesXml - 备注XML内容（可选）
   * @returns 幻灯片内容
   */
  private parseSlideXml(xml: string, notesXml?: string): SlideContent {
    try {
      const parsed = xmlParser.parse(xml);

      // 导航到 p:sld > p:cSld > p:spTree
      const spTree = parsed?.['p:sld']?.['p:cSld']?.['p:spTree'];
      if (!spTree) {
        return this.parseSlideXmlFallback(xml);
      }

      const texts: string[] = [];
      let title: string | undefined;

      // 提取所有shape中的文本
      const shapes = spTree['p:sp'];
      if (shapes) {
        const shapeArray = Array.isArray(shapes) ? shapes : [shapes];

        for (const shape of shapeArray) {
          if (!shape || typeof shape !== 'object') continue;

          const shapeText = this.extractShapeText(shape as Record<string, unknown>);
          if (shapeText.trim()) {
            texts.push(shapeText.trim());

            // 检测是否为标题占位符
            if (this.isTitlePlaceholder(shape as Record<string, unknown>)) {
              title = shapeText.trim();
            }
          }
        }
      }

      // 如果有备注，追加到文本
      if (notesXml) {
        const notesText = this.extractNotesText(notesXml);
        if (notesText.trim()) {
          texts.push(`[备注] ${notesText.trim()}`);
        }
      }

      // 如果未检测到标题，取第一个文本项
      if (!title && texts.length > 0) {
        title = texts[0].slice(0, 50); // 截取前50字符作为标题
      }

      return { slideNumber: 0, texts, title };
    } catch {
      // XML解析失败时回退到正则解析
      return this.parseSlideXmlFallback(xml);
    }
  }

  /**
   * 从shape对象中提取文本
   * 遍历 a:r > a:t 路径
   * @param shape - 解析后的shape对象
   * @returns 文本内容
   */
  private extractShapeText(shape: Record<string, unknown>): string {
    const textParts: string[] = [];

    // p:sp > p:txBody > a:p > a:r > a:t
    const txBody = shape['p:txBody'];
    if (!txBody || typeof txBody !== 'object') return '';

    const paragraphs = (txBody as Record<string, unknown>)['a:p'];
    if (!paragraphs) return '';

    const paraArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];

    for (const para of paraArray) {
      if (!para || typeof para !== 'object') continue;

      const runs = (para as Record<string, unknown>)['a:r'];
      if (!runs) continue;

      const runArray = Array.isArray(runs) ? runs : [runs];

      for (const run of runArray) {
        if (!run || typeof run !== 'object') continue;

        const t = (run as Record<string, unknown>)['a:t'];
        if (typeof t === 'string') {
          textParts.push(t);
        } else if (typeof t === 'object' && t !== null) {
          const text = (t as Record<string, unknown>)['#text'];
          if (typeof text === 'string') {
            textParts.push(text);
          }
        }
      }

      // 段落之间加换行
      if (textParts.length > 0) {
        textParts.push('\n');
      }
    }

    return textParts.join('').trim();
  }

  /**
   * 判断shape是否为标题占位符
   * 通过检查 p:nvSpPr > p:nvPr > p:ph 的type属性判断
   * @param shape - 解析后的shape对象
   * @returns 是否为标题占位符
   */
  private isTitlePlaceholder(shape: Record<string, unknown>): boolean {
    try {
      const nvSpPr = shape['p:nvSpPr'];
      if (!nvSpPr || typeof nvSpPr !== 'object') return false;

      const nvPr = (nvSpPr as Record<string, unknown>)['p:nvPr'];
      if (!nvPr || typeof nvPr !== 'object') return false;

      const ph = (nvPr as Record<string, unknown>)['p:ph'];
      if (!ph || typeof ph !== 'object') return false;

      // 检查type属性：title、ctrTitle
      const type = (ph as Record<string, unknown>)['@_type'];
      return type === 'title' || type === 'ctrTitle';
    } catch {
      return false;
    }
  }

  /**
   * 从备注XML中提取文本
   * @param notesXml - 备注XML内容
   * @returns 文本内容
   */
  private extractNotesText(notesXml: string): string {
    try {
      const parsed = xmlParser.parse(notesXml);
      const spTree = parsed?.['p:notes']?.['p:cSld']?.['p:spTree'];
      if (!spTree) return '';

      const texts: string[] = [];
      const shapes = spTree['p:sp'];
      if (!shapes) return '';

      const shapeArray = Array.isArray(shapes) ? shapes : [shapes];
      for (const shape of shapeArray) {
        if (!shape || typeof shape !== 'object') continue;
        const text = this.extractShapeText(shape as Record<string, unknown>);
        if (text.trim()) {
          texts.push(text.trim());
        }
      }

      return texts.join('\n');
    } catch {
      return '';
    }
  }

  /**
   * XML解析失败时的回退方案：使用正则解析
   * 保留与旧版一致的解析逻辑
   * @param xml - slide XML内容
   * @returns 幻灯片内容
   */
  private parseSlideXmlFallback(xml: string): SlideContent {
    const texts: string[] = [];

    // 提取<a:t>标签内容
    const textRegex = /<a:t>(.*?)<\/a:t>/gs;
    let match: RegExpExecArray | null;
    while ((match = textRegex.exec(xml)) !== null) {
      const text = match[1].trim();
      if (text) {
        texts.push(text);
      }
    }

    let title: string | undefined;
    if (texts.length > 0) {
      title = texts[0].slice(0, 50);
    }

    return { slideNumber: 0, texts, title };
  }
}
