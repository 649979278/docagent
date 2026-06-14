/**
 * LanceDB metadataFilter 转 WHERE 子句测试
 * 验证：
 * 1. 单个字符串条件转 = 子句
 * 2. 多个条件用 AND 连接
 * 3. 数组条件转 OR 子句
 * 4. 数字条件不加引号
 * 5. 特殊字符转义
 * 6. 空 filter 返回空字符串
 * 7. key 映射（别名支持）
 */

import { describe, it, expect } from 'vitest';
import { LanceDBVectorStore } from '../lancedb-store.js';

// ============================================================
// 测试
// ============================================================

describe('LanceDB metadataFilter 转 WHERE 子句', () => {
  // 通过反射访问私有方法
  const store = new LanceDBVectorStore('/tmp/test-lancedb');
  const buildWhereClause = (store as any).buildWhereClause.bind(store);
  const mapFilterKeyToColumn = (store as any).mapFilterKeyToColumn.bind(store);

  it('单个字符串条件转 = 子句', () => {
    const result = buildWhereClause({ sourceType: 'docx' });
    expect(result).toBe("sourceType = 'docx'");
  });

  it('多个条件用 AND 连接', () => {
    const result = buildWhereClause({
      sourceType: 'docx',
      sourceFile: '/docs/test.docx',
    });
    expect(result).toContain("sourceType = 'docx'");
    expect(result).toContain("sourceFile = '/docs/test.docx'");
    expect(result).toContain(' AND ');
  });

  it('数组条件转 OR 子句', () => {
    const result = buildWhereClause({
      sourceType: ['docx', 'pptx'],
    });
    expect(result).toContain("sourceType = 'docx'");
    expect(result).toContain("sourceType = 'pptx'");
    expect(result).toContain(' OR ');
    // 整体用括号包裹
    expect(result).toMatch(/^\(.*\)$/);
  });

  it('数字条件不加引号', () => {
    const result = buildWhereClause({ chunkIndex: 5 });
    expect(result).toContain('chunkIndex = 5');
    expect(result).not.toContain("'5'");
  });

  it('特殊字符转义', () => {
    const result = buildWhereClause({ sourceFile: "test's file.docx" });
    expect(result).toContain("test''s file.docx");
  });

  it('空 filter 返回空字符串', () => {
    expect(buildWhereClause({})).toBe('');
    expect(buildWhereClause({ key: undefined })).toBe('');
    expect(buildWhereClause({ key: null })).toBe('');
  });

  it('key 映射支持别名', () => {
    expect(mapFilterKeyToColumn('sourceFile')).toBe('sourceFile');
    expect(mapFilterKeyToColumn('source_file')).toBe('sourceFile');
    expect(mapFilterKeyToColumn('file_path')).toBe('sourceFile');
    expect(mapFilterKeyToColumn('sourceType')).toBe('sourceType');
    expect(mapFilterKeyToColumn('source_type')).toBe('sourceType');
    expect(mapFilterKeyToColumn('file_type')).toBe('sourceType');
  });

  it('布尔条件正确转换', () => {
    const result = buildWhereClause({ active: true });
    expect(result).toContain('active = true');
  });

  it('混合类型条件', () => {
    const result = buildWhereClause({
      sourceType: 'docx',
      chunkIndex: 0,
      locator: '段落1',
    });
    expect(result).toContain("sourceType = 'docx'");
    expect(result).toContain('chunkIndex = 0');
    expect(result).toContain("locator = '段落1'");
  });
});
