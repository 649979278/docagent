import { describe, expect, it } from 'vitest';

/**
 * 环境 smoke 测试。
 * 验证第三期本机开发测试至少运行在 Node 24+。
 */
describe('env smoke', () => {
  it('runs on node 24+', () => {
    const major = Number(process.versions.node.split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(24);
  });
});
