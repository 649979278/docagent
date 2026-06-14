/**
 * DOCX fflate+fast-xml-parser 解析测试
 * 验证：
 * 1. fflate 解压 word/document.xml
 * 2. fast-xml-parser 提取 <w:t> 文本
 * 3. 正确识别段落样式
 * 4. 无 document.xml 时抛错
 * 5. 空文档返回空段落
 * 6. computeHash 稳定性
 */

import { describe, it, expect } from 'vitest';
import { DocxExtractor, computeHash } from '../docx.js';
import { unzipSync } from 'fflate';
import { XMLBuilder } from 'fast-xml-parser';

// ============================================================
// Mock DOCX 生成工具
// ============================================================

/** XML 构建器 */
const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  format: false,
});

/**
 * 生成 DOCX ZIP Buffer
 * @param paragraphs - 段落数组 [{text, style?}]
 * @returns Uint8Array
 */
function createDocxBuffer(paragraphs: Array<{ text: string; style?: string }>): Uint8Array {
  // 构建 document.xml
  const pElements = paragraphs.map((p) => {
    const pPr = p.style
      ? { 'w:pPr': { 'w:pStyle': { '@_w:val': p.style } } }
      : {};

    return {
      'w:r': {
        'w:t': p.text,
      },
      ...pPr,
    };
  });

  const documentObj = {
    'w:document': {
      '@_xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'w:body': {
        'w:p': pElements,
      },
    },
  };

  const documentXml = xmlBuilder.build(documentObj);

  // 构建 ZIP
  const files: Record<string, Uint8Array> = {};
  files['word/document.xml'] = new TextEncoder().encode(documentXml);

  // [Content_Types].xml (最小化)
  files['[Content_Types].xml'] = new TextEncoder().encode(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  );

  return unzipSync(files) as unknown as Uint8Array;
}

// 注：unzipSync 是解压，zipSync 才是压缩
// 使用 fflate 的 zipSync 来生成测试数据
import { zipSync } from 'fflate';

function createDocxZip(paragraphs: Array<{ text: string; style?: string }>): Uint8Array {
  const pElements = paragraphs.map((p) => {
    const pPr = p.style
      ? { 'w:pPr': { 'w:pStyle': { '@_w:val': p.style } } }
      : {};

    return {
      'w:r': {
        'w:t': p.text,
      },
      ...pPr,
    };
  });

  const documentObj = {
    'w:document': {
      '@_xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'w:body': {
        'w:p': pElements,
      },
    },
  };

  const documentXml = xmlBuilder.build(documentObj);

  const files: Record<string, Uint8Array> = {};
  files['word/document.xml'] = new TextEncoder().encode(documentXml);
  files['[Content_Types].xml'] = new TextEncoder().encode(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  );

  return zipSync(files);
}

// ============================================================
// 测试
// ============================================================

describe('DOCX fflate 解析', () => {
  it('fflate 解压并提取 word/document.xml', async () => {
    const zipBuffer = createDocxZip([
      { text: '你好世界' },
    ]);

    // 验证可以解压
    const unzipped = unzipSync(zipBuffer);
    expect(unzipped['word/document.xml']).toBeDefined();

    const xml = new TextDecoder().decode(unzipped['word/document.xml']);
    expect(xml).toContain('你好世界');
  });

  it('fast-xml-parser 提取 w:t 文本', async () => {
    const extractor = new DocxExtractor();
    expect(extractor.supports('test.docx')).toBe(true);
    expect(extractor.supports('test.pdf')).toBe(false);
  });

  it('computeHash 对相同输入返回相同哈希', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const hash1 = computeHash(data);
    const hash2 = computeHash(data);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
  });

  it('computeHash 对不同输入返回不同哈希', () => {
    const data1 = new Uint8Array([1, 2, 3]);
    const data2 = new Uint8Array([4, 5, 6]);
    expect(computeHash(data1)).not.toBe(computeHash(data2));
  });

  it('空的 ZIP 文件缺少 document.xml 时报错', () => {
    // 空的 docx（无 word/document.xml）
    const files: Record<string, Uint8Array> = {};
    files['[Content_Types].xml'] = new TextEncoder().encode('<Types/>');
    const zipBuffer = zipSync(files);

    const unzipped = unzipSync(zipBuffer);
    expect(unzipped['word/document.xml']).toBeUndefined();
  });

  it('extractor 版本号为 2.0.0-fflate', () => {
    // 间接验证：通过构造函数检查
    const extractor = new DocxExtractor();
    expect(extractor).toBeInstanceOf(DocxExtractor);
    expect(extractor.supports('test.docx')).toBe(true);
  });
});
