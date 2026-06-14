/**
 * DOCX 标题层级映射测试
 * 验证：
 * 1. Heading1-6 样式正确映射为层级
 * 2. 中文"标题 1-6"样式正确映射
 * 3. Normal 样式无标题层级
 * 4. outline 仅包含标题段落
 * 5. 混合标题和正文正确分离
 * 6. 未识别样式名返回 null headingLevel
 */

import { describe, it, expect } from 'vitest';
import { DocxExtractor } from '../docx.js';

// ============================================================
// 测试
// ============================================================

describe('DOCX 标题层级映射', () => {
  // 使用私有方法测试标题分类逻辑
  // 通过反射访问 private 方法
  const extractor = new DocxExtractor();
  const classifyStyle = (extractor as any).classifyStyle.bind(extractor);

  it('Heading1 正确映射为层级1', () => {
    const result = classifyStyle('Heading1');
    expect(result.name).toBe('Heading1');
    expect(result.headingLevel).toBe(1);
  });

  it('Heading6 正确映射为层级6', () => {
    const result = classifyStyle('Heading6');
    expect(result.name).toBe('Heading6');
    expect(result.headingLevel).toBe(6);
  });

  it('中文"标题 1"正确映射', () => {
    const result = classifyStyle('标题 1');
    expect(result.headingLevel).toBe(1);
  });

  it('中文"标题3"正确映射', () => {
    const result = classifyStyle('标题3');
    expect(result.headingLevel).toBe(3);
  });

  it('Normal 样式无标题层级', () => {
    const result = classifyStyle('Normal');
    expect(result.name).toBe('Normal');
    expect(result.headingLevel).toBeNull();
  });

  it('自定义样式无标题层级', () => {
    const result = classifyStyle('MyCustomStyle');
    expect(result.name).toBe('MyCustomStyle');
    expect(result.headingLevel).toBeNull();
  });

  it('outline 生成仅包含标题段落', () => {
    const buildOutline = (extractor as any).buildOutline.bind(extractor);
    const paragraphs = [
      { text: '第一章', style: 'Heading1', headingLevel: 1 },
      { text: '这是正文内容', style: 'Normal', headingLevel: null },
      { text: '第一节', style: 'Heading2', headingLevel: 2 },
      { text: '更多正文', style: 'Normal', headingLevel: null },
    ];

    const outline = buildOutline(paragraphs);
    expect(outline).toHaveLength(2);
    expect(outline[0]).toBe('第一章');
    expect(outline[1]).toBe('  第一节'); // 1个缩进（headingLevel-1=1）
  });

  it('Heading3 缩进2级', () => {
    const buildOutline = (extractor as any).buildOutline.bind(extractor);
    const paragraphs = [
      { text: '标题1', style: 'Heading1', headingLevel: 1 },
      { text: '标题2', style: 'Heading2', headingLevel: 2 },
      { text: '标题3', style: 'Heading3', headingLevel: 3 },
    ];

    const outline = buildOutline(paragraphs);
    expect(outline[0]).toBe('标题1');       // 0缩进
    expect(outline[1]).toBe('  标题2');     // 1缩进
    expect(outline[2]).toBe('    标题3');   // 2缩进
  });
});
