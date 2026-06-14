/**
 * Markdown草稿生成器与docx文档输出
 * 先生成Markdown草稿，再通过docx npm包生成真正的.docx文件
 * 支持GB/T 9704标准公文格式
 */

import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { PlanOutline } from '@workagent/shared';

import { OFFICIAL_DOC_STYLE, MARKDOWN_HEADING_MAP } from './styles.js';
import type { DocumentTemplate, TemplateData } from './templates.js';
import { fillTemplate } from './templates.js';

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

/**
 * 文档生成结果
 */
export interface GenerateResult {
  /** 生成的Markdown内容 */
  markdown: string;
  /** 输出文件路径 */
  outputPath: string;
  /** 生成摘要（供上层显示） */
  summary: string;
}

/**
 * 根据计划和内容生成Markdown草稿
 * 按计划提纲结构组织内容，填充各章节
 * @param plan - 计划提纲
 * @param contentSections - 各章节内容映射 stepId -> content
 * @returns 生成的Markdown文本
 */
export function generateMarkdown(
  plan: PlanOutline,
  contentSections: Record<string, string>,
): string {
  const lines: string[] = [];

  // 标题
  lines.push(`# ${plan.title}`);
  lines.push('');

  // 目标概述
  if (plan.goal) {
    lines.push(plan.goal);
    lines.push('');
  }

  // 材料依据
  if (plan.materialBasis) {
    lines.push(`**材料依据**：${plan.materialBasis}`);
    lines.push('');
  }

  // 各章节内容
  for (const step of plan.structure) {
    const content = contentSections[step.id];

    if (step.description && content) {
      const headingLevel = detectHeadingLevel(step.description);
      if (headingLevel > 0) {
        const hashes = '#'.repeat(Math.min(headingLevel + 1, 4));
        lines.push(`${hashes} ${step.description}`);
      } else {
        lines.push(`## ${step.description}`);
      }
      lines.push('');
      lines.push(content);
      lines.push('');
    } else if (step.description) {
      lines.push(`## ${step.description}`);
      lines.push('');
    }
  }

  // 风险提醒
  if (plan.risks.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('**风险提醒**：');
    for (const risk of plan.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push('');
  }

  // 引用来源
  if (plan.citations.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('**引用来源**：');
    for (const citation of plan.citations) {
      lines.push(`- ${citation}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 根据模板和数据生成Markdown文档
 * @param template - 文档模板
 * @param data - 填充数据
 * @returns 生成的Markdown文本
 */
export function generateFromTemplate(template: DocumentTemplate, data: TemplateData): string {
  return fillTemplate(template, data);
}

/**
 * 将Markdown内容输出为docx文件
 * 使用docx npm包生成符合GB/T 9704标准的公文格式.docx
 * @param markdown - Markdown内容
 * @param outputPath - 输出路径（.docx）
 * @returns 生成结果
 */
export async function markdownToDocx(markdown: string, outputPath: string): Promise<GenerateResult> {
  // 确保输出目录存在
  const dir = path.dirname(outputPath);
  await mkdir(dir, { recursive: true });

  // 确定最终输出路径
  let actualOutputPath = outputPath;
  if (path.extname(outputPath).toLowerCase() !== '.docx') {
    actualOutputPath = outputPath + '.docx';
  }

  try {
    // 动态导入docx包（可能未安装，需用户先pnpm add docx）
    const docx = await import('docx');
    const paragraphs = parseMarkdownToDocxParagraphs(markdown, docx);

    const doc = new docx.Document({
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: {
              top: mmToTwip(OFFICIAL_DOC_STYLE.page.marginTop),
              bottom: mmToTwip(OFFICIAL_DOC_STYLE.page.marginBottom),
              left: mmToTwip(OFFICIAL_DOC_STYLE.page.marginLeft),
              right: mmToTwip(OFFICIAL_DOC_STYLE.page.marginRight),
            },
          },
        },
        children: paragraphs,
      }],
    });

    const buffer = await docx.Packer.toBuffer(doc);
    await writeFile(actualOutputPath, Buffer.from(buffer));

    return {
      markdown,
      outputPath: actualOutputPath,
      summary: renderSummary(markdown, actualOutputPath),
    };
  } catch (importError) {
    // docx包未安装时回退到输出.md文件
    console.warn('[docgen] docx包未安装，回退输出.md文件:', importError);
    const mdPath = actualOutputPath.replace(/\.docx$/i, '.md');
    await writeFile(mdPath, markdown, 'utf-8');

    return {
      markdown,
      outputPath: mdPath,
      summary: renderSummary(markdown, mdPath) + '（未安装docx包，已输出.md）',
    };
  }
}

/**
 * 将Markdown文本解析为docx段落数组
 * 支持：标题(#/##/###/####)、正文段落、粗体、列表
 * @param markdown - Markdown文本
 * @param docx - docx模块引用
 * @returns docx段落对象数组
 */
function parseMarkdownToDocxParagraphs(markdown: string, docx: typeof import('docx')): any[] {
  const lines = markdown.split('\n');
  const paragraphs: any[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行跳过
    if (!trimmed) continue;

    // 标题行
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const styleMap = MARKDOWN_HEADING_MAP[level as keyof typeof MARKDOWN_HEADING_MAP];
      const style = styleMap?.style as { fontSize?: number; fontFamily?: string; textAlign?: string; lineHeight?: number } | undefined;

      paragraphs.push(new docx.Paragraph({
        children: [new docx.TextRun({
          text,
          bold: true,
          size: ptToHalfPt(style?.fontSize ?? 16),
          font: style?.fontFamily ?? '仿宋',
        })],
        heading: level <= 4 ? (`Heading${level}` as 'Heading1' | 'Heading2' | 'Heading3' | 'Heading4') : undefined,
        alignment: style?.textAlign === 'center'
          ? docx.AlignmentType.CENTER
          : style?.textAlign === 'right'
            ? docx.AlignmentType.RIGHT
            : docx.AlignmentType.JUSTIFIED,
        spacing: { line: (style?.lineHeight ?? 28) * 20 },
      }));
      continue;
    }

    // 列表项
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      paragraphs.push(new docx.Paragraph({
        children: [new docx.TextRun({
          text: listMatch[1],
          size: ptToHalfPt(OFFICIAL_DOC_STYLE.body.fontSize),
          font: OFFICIAL_DOC_STYLE.body.fontFamily,
        })],
        bullet: { level: 0 },
        spacing: { line: OFFICIAL_DOC_STYLE.body.lineHeight * 20 },
      }));
      continue;
    }

    // 分隔线
    if (trimmed === '---') {
      paragraphs.push(new docx.Paragraph({
        children: [],
        spacing: { before: 200, after: 200 },
        border: {
          bottom: { style: docx.BorderStyle.SINGLE, size: 1, color: '999999' },
        },
      }));
      continue;
    }

    // 普通段落（处理粗体和行内格式）
    const runs = parseInlineFormatting(trimmed, docx);
    paragraphs.push(new docx.Paragraph({
      children: runs,
      spacing: { line: OFFICIAL_DOC_STYLE.body.lineHeight * 20 },
      indent: { firstLine: OFFICIAL_DOC_STYLE.body.firstLineIndent * 320 },
      alignment: docx.AlignmentType.JUSTIFIED,
    }));
  }

  return paragraphs;
}

/**
 * 解析行内格式（粗体 **text**、斜体 *text*）
 * @param text - 包含Markdown格式的文本
 * @param docx - docx模块引用
 * @returns TextRun数组
 */
function parseInlineFormatting(text: string, docx: typeof import('docx')): any[] {
  const runs: any[] = [];
  // 匹配 **粗体** 和 *斜体*
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // match前的普通文本
    if (match.index > lastIndex) {
      runs.push(new docx.TextRun({
        text: text.slice(lastIndex, match.index),
        size: ptToHalfPt(OFFICIAL_DOC_STYLE.body.fontSize),
        font: OFFICIAL_DOC_STYLE.body.fontFamily,
      }));
    }

    if (match[2]) {
      // **粗体**
      runs.push(new docx.TextRun({
        text: match[2],
        bold: true,
        size: ptToHalfPt(OFFICIAL_DOC_STYLE.body.fontSize),
        font: OFFICIAL_DOC_STYLE.body.fontFamily,
      }));
    } else if (match[3]) {
      // *斜体*
      runs.push(new docx.TextRun({
        text: match[3],
        italics: true,
        size: ptToHalfPt(OFFICIAL_DOC_STYLE.body.fontSize),
        font: OFFICIAL_DOC_STYLE.body.fontFamily,
      }));
    }

    lastIndex = regex.lastIndex;
  }

  // 剩余普通文本
  if (lastIndex < text.length) {
    runs.push(new docx.TextRun({
      text: text.slice(lastIndex),
      size: ptToHalfPt(OFFICIAL_DOC_STYLE.body.fontSize),
      font: OFFICIAL_DOC_STYLE.body.fontFamily,
    }));
  }

  // 如果没有任何格式，返回一个普通run
  if (runs.length === 0) {
    runs.push(new docx.TextRun({
      text,
      size: ptToHalfPt(OFFICIAL_DOC_STYLE.body.fontSize),
      font: OFFICIAL_DOC_STYLE.body.fontFamily,
    }));
  }

  return runs;
}

/**
 * 毫米转twip（1mm ≈ 56.7twip）
 * @param mm - 毫米值
 * @returns twip值
 */
function mmToTwip(mm: number): number {
  return Math.round(mm * 56.7);
}

/**
 * 磅转半磅（docx包中字号单位为半磅）
 * @param pt - 磅值
 * @returns 半磅值
 */
function ptToHalfPt(pt: number): number {
  return pt * 2;
}

/**
 * 生成结果摘要（供上层/UI显示）
 * @param markdown - Markdown内容
 * @param outputPath - 输出路径
 * @returns 短摘要文本
 */
function renderSummary(markdown: string, outputPath: string): string {
  const charCount = markdown.length;
  const paragraphCount = markdown.split(/\n\s*\n/).filter((p) => p.trim()).length;
  const headingCount = (markdown.match(/^#{1,6}\s/gm) || []).length;
  const fileName = path.basename(outputPath);

  return `已生成文档 ${fileName}，共${charCount}字、${paragraphCount}段、${headingCount}个标题`;
}

/**
 * 检测文本的标题层级
 * @param text - 标题文本
 * @returns 标题层级（1-4），0表示非标题
 */
function detectHeadingLevel(text: string): number {
  if (/^[一二三四五六七八九十]+、/.test(text)) return 1;
  if (/^（[一二三四五六七八九十]+）/.test(text)) return 2;
  if (/^\d+\./.test(text)) return 3;
  if (/^（\d+）/.test(text)) return 4;
  return 0;
}
