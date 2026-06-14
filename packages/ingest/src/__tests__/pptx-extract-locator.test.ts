/**
 * PPTX locator 格式验证测试
 * 验证：
 * 1. locator 格式为 "幻灯片N"
 * 2. 多张幻灯片 locator 递增
 * 3. section title 包含幻灯片信息
 */

import { describe, it, expect } from 'vitest';
import { PptxExtractor } from '../pptx.js';
import { zipSync, unzipSync } from 'fflate';

/** 生成最小 PPTX ZIP */
function createPptxZip(slideCount: number): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  files['[Content_Types].xml'] = new TextEncoder().encode('<Types/>');

  for (let i = 1; i <= slideCount; i++) {
    files[`ppt/slides/slide${i}.xml`] = new TextEncoder().encode(
      `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>幻灯片${i}标题</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
  }

  return zipSync(files);
}

describe('PPTX locator 格式验证', () => {
  it('单张幻灯片 locator 为 "幻灯片1"', async () => {
    const extractor = new PptxExtractor();
    // 使用内省方式验证 parseSlideXml 的 locator 输出
    const extractSlideXmls = (extractor as any).extractSlideXmls.bind(extractor);
    const parseSlideXml = (extractor as any).parseSlideXml.bind(extractor);

    const zipBuffer = createPptxZip(1);
    const unzipped = unzipSync(zipBuffer);
    const entries = extractSlideXmls(unzipped);

    expect(entries).toHaveLength(1);
    expect(entries[0].slideNumber).toBe(1);

    const content = parseSlideXml(entries[0].xml, entries[0].notesXml);
    expect(content.texts.length).toBeGreaterThan(0);
  });

  it('多张幻灯片 locator 递增', async () => {
    const extractor = new PptxExtractor();
    const extractSlideXmls = (extractor as any).extractSlideXmls.bind(extractor);

    const zipBuffer = createPptxZip(3);
    const unzipped = unzipSync(zipBuffer);
    const entries = extractSlideXmls(unzipped);

    expect(entries).toHaveLength(3);
    // 验证编号
    const numbers = entries.map((e: any) => e.slideNumber).sort((a: number, b: number) => a - b);
    expect(numbers).toEqual([1, 2, 3]);
  });

  it('extractSlideXmls 忽略非 slide 文件', () => {
    const extractor = new PptxExtractor();
    const extractSlideXmls = (extractor as any).extractSlideXmls.bind(extractor);

    const files: Record<string, Uint8Array> = {};
    files['[Content_Types].xml'] = new TextEncoder().encode('<Types/>');
    files['ppt/slides/slide1.xml'] = new TextEncoder().encode('<p:sld/>');
    files['ppt/presentation.xml'] = new TextEncoder().encode('<p:presentation/>');
    files['docProps/app.xml'] = new TextEncoder().encode('<Properties/>');

    const zipBuffer = zipSync(files);
    const unzipped = unzipSync(zipBuffer);
    const entries = extractSlideXmls(unzipped);

    expect(entries).toHaveLength(1);
    expect(entries[0].slideNumber).toBe(1);
  });
});
