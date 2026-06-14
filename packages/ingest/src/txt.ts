/**
 * 纯文本/Markdown文件解析器
 * 直接使用fs.readFile读取UTF-8编码的文本内容
 */

import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { ExtractedDocument, DocumentSection } from '@workagent/shared';
import { FileParseError } from '@workagent/shared';

import type { DocumentExtractor } from './pipeline.js';
import { computeHash } from './docx.js';

const readFile = promisify(fs.readFile);

/**
 * 纯文本/Markdown文件解析器
 * 支持txt和md文件，按行检测标题结构，按段落分块
 */
export class TxtExtractor implements DocumentExtractor {
  /**
   * 判断是否为txt或md文件
   * @param filePath - 文件路径
   * @returns 文件扩展名为txt或md时返回true
   */
  supports(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.txt' || ext === '.md';
  }

  /**
   * 读取文本文件并解析为文档结构
   * Markdown文件会识别#标题层级，纯文本按空行分段
   * @param filePath - 文本文件路径
   * @returns 提取的文档结构
   * @throws {FileParseError} 文件读取失败时抛出
   */
  async extract(filePath: string): Promise<ExtractedDocument> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const ext = path.extname(filePath).toLowerCase();
      const isMarkdown = ext === '.md';

      // 计算文件内容hash
      const contentHash = computeHash(new TextEncoder().encode(content));

      // 按标题或段落分节
      const sections = isMarkdown
        ? this.parseMarkdownSections(content)
        : this.parseTextSections(content);

      return {
        filePath,
        fileName: path.basename(filePath),
        fileType: isMarkdown ? 'md' : 'txt',
        content,
        sections,
        metadata: {
          contentHash,
          outline: [],
          sectionCount: sections.length,
          paragraphCount: sections.length,
          charCount: content.length,
          lineCount: content.split('\n').length,
          extractorVersion: '1.0.0',
        },
      };
    } catch (error) {
      if (error instanceof FileParseError) {
        throw error;
      }
      const parseError = error instanceof Error ? error : new Error(String(error));
      throw new FileParseError(filePath, path.extname(filePath).slice(1) || 'txt', parseError);
    }
  }

  /**
   * 解析Markdown内容，按标题分节
   * 识别# ~ ######标题层级，每个标题下内容作为一个section
   * @param content - Markdown文本
   * @returns 文档章节列表
   */
  private parseMarkdownSections(content: string): DocumentSection[] {
    const sections: DocumentSection[] = [];
    const lines = content.split('\n');

    let currentTitle = '引言';
    let currentLevel = 0;
    let currentContent: string[] = [];
    let sectionIndex = 0;

    for (const line of lines) {
      // 检测Markdown标题
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        // 保存前一个section
        if (currentContent.length > 0 || sectionIndex > 0) {
          const text = currentContent.join('\n').trim();
          if (text || sectionIndex > 0) {
            sections.push({
              title: currentTitle,
              content: text,
              level: currentLevel,
              locator: `段落${sectionIndex + 1}`,
            });
          }
        }

        // 开始新section
        currentTitle = headingMatch[2].trim();
        currentLevel = headingMatch[1].length;
        currentContent = [];
        sectionIndex++;
      } else {
        currentContent.push(line);
      }
    }

    // 保存最后一个section
    const lastContent = currentContent.join('\n').trim();
    if (lastContent || sections.length > 0) {
      sections.push({
        title: currentTitle,
        content: lastContent,
        level: currentLevel,
        locator: `段落${sectionIndex + 1}`,
      });
    }

    return sections;
  }

  /**
   * 解析纯文本内容，按空行分段
   * 连续非空行作为同一段落，空行分隔段落
   * @param content - 纯文本内容
   * @returns 文档章节列表
   */
  private parseTextSections(content: string): DocumentSection[] {
    const sections: DocumentSection[] = [];
    const paragraphs = content.split(/\n\s*\n/);

    for (let i = 0; i < paragraphs.length; i++) {
      const text = paragraphs[i].trim();
      if (text) {
        sections.push({
          title: `段落 ${i + 1}`,
          content: text,
          level: 0,
          locator: `段落${i + 1}`,
        });
      }
    }

    return sections;
  }
}
