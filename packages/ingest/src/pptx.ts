/**
 * PPTX文件解析器
 * 使用Node.js内置zlib解压pptx，读取ppt/slides/slide*.xml中的<a:t>标签提取文本
 * 不依赖JSZip等第三方包
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
 * PPTX文件解析器
 * 通过解压ZIP包并解析ppt/slides/slideN.xml中的<a:t>标签提取幻灯片文本
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
   * 遍历ppt/slides/slide1.xml, slide2.xml... 提取<a:t>标签文本
   * @param filePath - pptx文件路径
   * @returns 提取的文档结构
   * @throws {FileParseError} 文件读取或解压失败时抛出
   */
  async extract(filePath: string): Promise<ExtractedDocument> {
    try {
      const buffer = await readFile(filePath);

      // 从ZIP包中提取所有幻灯片XML
      const slideEntries = await this.extractSlideXmls(buffer);

      if (slideEntries.length === 0) {
        throw new Error('pptx文件中未找到幻灯片');
      }

      // 按幻灯片编号排序
      slideEntries.sort((a, b) => a.slideNumber - b.slideNumber);

      // 解析每张幻灯片的文本
      const sections: DocumentSection[] = [];
      const allTexts: string[] = [];

      for (const entry of slideEntries) {
        const textItems = this.parseSlideXml(entry.xml);
        const slideText = textItems.join('\n');

        if (slideText.trim()) {
          sections.push({
            title: `幻灯片 ${entry.slideNumber}`,
            content: slideText.trim(),
            level: 0,
            locator: `幻灯片${entry.slideNumber}`,
          });
          allTexts.push(slideText.trim());
        }
      }

      return {
        filePath,
        fileName: path.basename(filePath),
        fileType: 'pptx',
        content: allTexts.join('\n\n'),
        sections,
        metadata: {
          slideCount: slideEntries.length,
          extractorVersion: '1.0.0-zlib',
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
   * 从pptx的ZIP包中提取所有幻灯片XML
   * 匹配文件名为ppt/slides/slideN.xml的条目
   * @param buffer - pptx文件的原始Buffer
   * @returns 幻灯片条目列表（含编号和XML内容）
   */
  private async extractSlideXmls(data: Uint8Array): Promise<SlideEntry[]> {
    const entries: SlideEntry[] = [];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const decoder = new TextDecoder();
    let offset = 0;

    while (offset < data.length - 4) {
      const sig = view.getUint32(offset, true);

      // 本地文件头签名 0x04034b50 (PK\x03\x04)
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

      // 匹配ppt/slides/slideN.xml（N为1-3位数字）
      const slideMatch = fileName.match(/^ppt\/slides\/slide(\d{1,3})\.xml$/);
      if (slideMatch) {
        const slideNumber = parseInt(slideMatch[1], 10);
        const compressedData = data.subarray(dataOffset, dataOffset + compressedSize);

        let xml: string;
        if (compressionMethod === 0) {
          xml = decoder.decode(compressedData);
        } else if (compressionMethod === 8) {
          const decompressed = await inflateRaw(compressedData);
          xml = decoder.decode(decompressed);
        } else {
          // 跳过不支持的压缩方法
          offset = dataOffset + compressedSize;
          continue;
        }

        entries.push({ slideNumber, xml });
      }

      offset = dataOffset + compressedSize;
    }

    return entries;
  }

  /**
   * 解析单张幻灯片XML，提取所有<a:t>标签文本
   * @param xml - slide XML内容
   * @returns 文本项列表
   */
  private parseSlideXml(xml: string): string[] {
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

    return texts;
  }
}

/** 幻灯片ZIP条目 */
interface SlideEntry {
  /** 幻灯片编号 */
  slideNumber: number;
  /** 幻灯片XML内容 */
  xml: string;
}
