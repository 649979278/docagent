/**
 * IngestPipeline hash 稳定性测试
 * 验证：
 * 1. 相同文件多次计算hash一致
 * 2. 不同文件hash不同
 * 3. computeHash 对 Uint8Array 和 Buffer 结果一致
 * 4. 大文件hash计算正常
 * 5. 空文件hash为已知值
 */

import { describe, it, expect } from 'vitest';
import { computeHash } from '../docx.js';

// ============================================================
// 测试
// ============================================================

describe('Hash 稳定性', () => {
  it('相同二进制内容多次计算hash一致', () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const hash1 = computeHash(data);
    const hash2 = computeHash(data);
    expect(hash1).toBe(hash2);
  });

  it('不同内容hash不同', () => {
    const data1 = new Uint8Array([1, 2, 3]);
    const data2 = new Uint8Array([4, 5, 6]);
    expect(computeHash(data1)).not.toBe(computeHash(data2));
  });

  it('Uint8Array 和 Buffer 对同一内容结果一致', () => {
    const content = '测试hash一致性';
    const uint8 = new TextEncoder().encode(content);
    const buffer = Buffer.from(content);

    const hash1 = computeHash(uint8);
    const hash2 = computeHash(buffer);

    expect(hash1).toBe(hash2);
  });

  it('大文件hash计算正常', () => {
    // 1MB 数据
    const data = new Uint8Array(1024 * 1024);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 256;
    }
    const hash = computeHash(data);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('空文件hash为已知值', () => {
    const data = new Uint8Array(0);
    const hash = computeHash(data);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // SHA-256 of empty string is e3b0c442...
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
