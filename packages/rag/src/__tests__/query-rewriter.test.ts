import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaQueryRewriter } from '../query-rewriter.js';

describe('OllamaQueryRewriter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses JSON array responses into a retrieval query', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: '["国办发〔2024〕1号 政务服务", "基层标准化 办理时限"]' },
      }),
    }));

    const rewriter = new OllamaQueryRewriter('http://localhost:11434', 'qwen3.5:9b');
    const result = await rewriter.rewrite('国办发政策怎么落实');

    expect(result).toContain('国办发〔2024〕1号');
    expect(result).toContain('基层标准化');
    expect(rewriter.getDiagnostics().fallback).toBe(false);
  });

  it('falls back to rule based rewriting after repeated failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const rewriter = new OllamaQueryRewriter('http://localhost:99999', 'missing');
    await rewriter.rewrite('请查询国办发〔2024〕1号的要求');
    await rewriter.rewrite('请查询国办发〔2024〕1号的要求');
    const result = await rewriter.rewrite('请查询国办发〔2024〕1号的要求');

    expect(result).toContain('国办发〔2024〕1号');
    expect(rewriter.isDisabled()).toBe(true);
    expect(rewriter.getDiagnostics().fallback).toBe(true);
  });
});
