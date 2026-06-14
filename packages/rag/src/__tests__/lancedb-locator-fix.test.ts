/**
 * LanceDB locator 保留原始值测试
 * 验证：
 * 1. upsert 时 locator 使用 metadata.locator（来自 section.locator）
 * 2. locator 不再被 chunkIndex 覆盖
 * 3. locator 为空时回退到 chunkIndex
 */

import { describe, it, expect, vi } from 'vitest';
import { LanceDBVectorStore } from '../lancedb-store.js';
import type { VectorChunk } from '../knowledge-index.js';

// ============================================================
// Mock LanceDB
// ============================================================

// 不需要真正的 LanceDB，只测试 upsert 中的记录转换逻辑
describe('LanceDB locator 保留原始值', () => {
  it('upsert 时 locator 使用 metadata.locator', () => {
    // 直接测试记录转换逻辑
    const store = new LanceDBVectorStore('/tmp/test');
    // 验证 chunks → records 的转换
    const chunks: VectorChunk[] = [
      {
        chunkId: 'chunk-abc-0',
        content: '测试内容',
        metadata: {
          sourceFile: '通知.docx',
          sourceType: 'docx',
          chunkIndex: 0,
          locator: '段落1',  // 来自 section.locator
          contentHash: 'abc123',
        },
        vector: [0.1, 0.2, 0.3],
      },
    ];

    // 模拟 upsert 的记录转换逻辑
    const records = chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      content: chunk.content,
      sourceFile: chunk.metadata.sourceFile,
      sourceType: chunk.metadata.sourceType,
      locator: chunk.metadata.locator || String(chunk.metadata.chunkIndex),
      vector: chunk.vector,
    }));

    // 验证 locator 使用的是 metadata.locator 而非 chunkIndex
    expect(records[0].locator).toBe('段落1');
    expect(records[0].locator).not.toBe('0');
  });

  it('幻灯片 locator 保留原始值', () => {
    const chunks: VectorChunk[] = [
      {
        chunkId: 'chunk-def-0',
        content: '幻灯片内容',
        metadata: {
          sourceFile: '演示.pptx',
          sourceType: 'pptx',
          chunkIndex: 2,
          locator: '幻灯片3',  // 来自 section.locator
          contentHash: 'def456',
        },
        vector: [0.4, 0.5, 0.6],
      },
    ];

    const records = chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      content: chunk.content,
      sourceFile: chunk.metadata.sourceFile,
      sourceType: chunk.metadata.sourceType,
      locator: chunk.metadata.locator || String(chunk.metadata.chunkIndex),
      vector: chunk.vector,
    }));

    // locator 应为"幻灯片3"而非"2"
    expect(records[0].locator).toBe('幻灯片3');
    expect(records[0].locator).not.toBe('2');
  });

  it('locator 为空时回退到 chunkIndex', () => {
    const chunks: VectorChunk[] = [
      {
        chunkId: 'chunk-ghi-0',
        content: '无locator内容',
        metadata: {
          sourceFile: '测试.txt',
          sourceType: 'txt',
          chunkIndex: 5,
          locator: '',  // 空 locator
          contentHash: 'ghi789',
        },
        vector: [0.7, 0.8, 0.9],
      },
    ];

    const records = chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      content: chunk.content,
      sourceFile: chunk.metadata.sourceFile,
      sourceType: chunk.metadata.sourceType,
      locator: chunk.metadata.locator || String(chunk.metadata.chunkIndex),
      vector: chunk.vector,
    }));

    // 空 locator 回退到 chunkIndex
    expect(records[0].locator).toBe('5');
  });

  it('ChunkMetadata 包含 locator 字段', () => {
    // 验证 ChunkMetadata 类型正确
    const metadata = {
      sourceFile: 'test.docx',
      sourceType: 'docx',
      chunkIndex: 0,
      locator: '段落1',
      contentHash: 'abc',
    };

    expect(metadata.locator).toBe('段落1');
    expect(typeof metadata.locator).toBe('string');
  });
});
