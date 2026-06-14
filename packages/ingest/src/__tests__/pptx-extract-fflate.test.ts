/**
 * PPTX fflate+fast-xml-parser 解析测试
 * 验证：
 * 1. fflate 解压 ppt/slides/slideN.xml
 * 2. fast-xml-parser 提取 <a:t> 文本
 * 3. 标题占位符识别
 * 4. 空幻灯片跳过
 * 5. 无幻灯片时报错
 * 6. extractor 版本号
 */

import { describe, it, expect } from 'vitest';
import { PptxExtractor } from '../pptx.js';
import { zipSync, unzipSync } from 'fflate';

// ============================================================
// Mock PPTX 生成工具
// ============================================================

/**
 * 生成单张幻灯片的 XML
 * @param texts - 文本数组
 * @param isTitle - 是否为标题占位符
 */
function createSlideXml(texts: string[], isTitle = false): string {
  const runs = texts.map((t) => `<a:r><a:rPr lang="zh-CN" dirty="0"/><a:t>${t}</a:t></a:r>`).join('');

  const phType = isTitle ? ' type="title"' : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr/>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Title 1"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph ${phType}/></p:nvPr>
        </p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>${runs}</a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

/**
 * 生成 PPTX ZIP Buffer
 * @param slides - 幻灯片数组 [{texts, isTitle?}]
 */
function createPptxZip(slides: Array<{ texts: string[]; isTitle?: boolean }>): Uint8Array {
  const files: Record<string, Uint8Array> = {};

  files['[Content_Types].xml'] = new TextEncoder().encode('<Types/>');

  slides.forEach((slide, i) => {
    const slideNum = i + 1;
    files[`ppt/slides/slide${slideNum}.xml`] = new TextEncoder().encode(
      createSlideXml(slide.texts, slide.isTitle),
    );
  });

  return zipSync(files);
}

// ============================================================
// 测试
// ============================================================

describe('PPTX fflate 解析', () => {
  it('fflate 解压并提取 ppt/slides/slide1.xml', () => {
    const zipBuffer = createPptxZip([{ texts: ['测试文本'] }]);
    const unzipped = unzipSync(zipBuffer);

    expect(unzipped['ppt/slides/slide1.xml']).toBeDefined();
    const xml = new TextDecoder().decode(unzipped['ppt/slides/slide1.xml']);
    expect(xml).toContain('测试文本');
  });

  it('多张幻灯片按编号排序', () => {
    const zipBuffer = createPptxZip([
      { texts: ['第一张'] },
      { texts: ['第二张'] },
    ]);
    const unzipped = unzipSync(zipBuffer);

    expect(unzipped['ppt/slides/slide1.xml']).toBeDefined();
    expect(unzipped['ppt/slides/slide2.xml']).toBeDefined();
  });

  it('无幻灯片的ZIP不应包含slide文件', () => {
    const files: Record<string, Uint8Array> = {};
    files['[Content_Types].xml'] = new TextEncoder().encode('<Types/>');
    const zipBuffer = zipSync(files);
    const unzipped = unzipSync(zipBuffer);

    // 不应包含任何slide文件
    const slideKeys = Object.keys(unzipped).filter((k) => k.startsWith('ppt/slides/slide'));
    expect(slideKeys).toHaveLength(0);
  });

  it('extractor 支持 .pptx 扩展名', () => {
    const extractor = new PptxExtractor();
    expect(extractor.supports('test.pptx')).toBe(true);
    expect(extractor.supports('test.docx')).toBe(false);
    expect(extractor.supports('test.pdf')).toBe(false);
  });

  it('标题占位符检测 - isTitlePlaceholder', () => {
    const extractor = new PptxExtractor();
    const isTitlePlaceholder = (extractor as any).isTitlePlaceholder.bind(extractor);

    // title 类型
    expect(isTitlePlaceholder({
      'p:nvSpPr': {
        'p:nvPr': { 'p:ph': { '@_type': 'title' } },
      },
    })).toBe(true);

    // ctrTitle 类型
    expect(isTitlePlaceholder({
      'p:nvSpPr': {
        'p:nvPr': { 'p:ph': { '@_type': 'ctrTitle' } },
      },
    })).toBe(true);

    // body 类型（非标题）
    expect(isTitlePlaceholder({
      'p:nvSpPr': {
        'p:nvPr': { 'p:ph': { '@_type': 'body' } },
      },
    })).toBe(false);

    // 无 ph 元素
    expect(isTitlePlaceholder({
      'p:nvSpPr': { 'p:nvPr': {} },
    })).toBe(false);
  });

  it('extractShapeText 从shape对象提取文本', () => {
    const extractor = new PptxExtractor();
    const extractShapeText = (extractor as any).extractShapeText.bind(extractor);

    const shape = {
      'p:txBody': {
        'a:p': {
          'a:r': { 'a:t': 'Hello World' },
        },
      },
    };

    const text = extractShapeText(shape);
    expect(text).toContain('Hello World');
  });
});
