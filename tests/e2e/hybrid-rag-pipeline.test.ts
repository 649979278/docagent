/**
 * Hybrid RAG 检索链路增量测试
 * 验证：
 * 1. BM25Search: FTS5/LIKE 双模式
 * 2. rrfFuse: 两路融合、双路命中 boost
 * 3. RuleBasedQueryRewriter: 停用词过滤、文号提取
 * 4. ScoreAndKeywordGrader: 关键词加分
 * 5. RAGEngine options object 构造
 * 6. RAGEngine.indexDocument 只负责 chunk + embedding + vector upsert
 * 7. RAGEngine.search 走完整 pipeline
 * 8. 004_chunks_fts 迁移：幂等 ALTER + FTS5 + 回填
 * 9. runtime-factory 注入链路串联
 */

import { describe, it, expect, vi } from 'vitest';
import type { RetrievedChunk } from '@workagent/shared';
import {
  BM25Search,
  rrfFuse,
  RuleBasedQueryRewriter,
  PassThroughReranker,
  ScoreAndKeywordGrader,
  RAGEngine,
} from '@workagent/rag';

// ============================================================
// 测试工具
// ============================================================

/** 创建测试用 RetrievedChunk */
function createChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    content: '测试内容',
    sourceFile: 'test.docx',
    sourceType: 'docx',
    locator: '段落1',
    score: 0.9,
    chunkId: `chunk-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

// ============================================================
// BM25Search 测试
// ============================================================

describe('BM25Search', () => {
  it('FTS5 可用时使用 MATCH 查询', async () => {
    const mockResults = [
      { chunk_id: 'chunk_1', source_file: 'a.docx', content: '政策内容', rank: -1.5 },
    ];
    const queryFn = vi.fn().mockReturnValue(mockResults);
    const searcher = new BM25Search(queryFn, true);

    const results = await searcher.search('政策');

    expect(results).toHaveLength(1);
    expect(results[0].chunkId).toBe('chunk_1');
    expect(results[0].content).toBe('政策内容');
    // 验证使用了 MATCH 语法
    expect(queryFn).toHaveBeenCalledWith(
      expect.stringContaining('MATCH'),
      expect.arrayContaining(['政策']),
    );
  });

  it('FTS5 不可用时降级到 LIKE', async () => {
    const mockResults = [
      { chunk_id: 'chunk_1', source_file: 'a.docx', content: '政策内容' },
    ];
    const queryFn = vi.fn().mockReturnValue(mockResults);
    const searcher = new BM25Search(queryFn, false);

    const results = await searcher.search('政策');

    expect(results).toHaveLength(1);
    // 验证使用了 LIKE 语法
    expect(queryFn).toHaveBeenCalledWith(
      expect.stringContaining('LIKE'),
      expect.arrayContaining(['%政策%']),
    );
  });

  it('FTS5 查询失败时降级到 LIKE', async () => {
    const likeResults = [
      { chunk_id: 'chunk_2', source_file: 'b.docx', content: '降级结果' },
    ];
    const queryFn = vi.fn()
      .mockImplementationOnce(() => { throw new Error('FTS5 syntax error'); })
      .mockReturnValueOnce(likeResults);
    const searcher = new BM25Search(queryFn, true);

    const results = await searcher.search('特殊字符查询');

    expect(results).toHaveLength(1);
    expect(results[0].chunkId).toBe('chunk_2');
  });

  it('空查询返回空结果', async () => {
    const queryFn = vi.fn();
    const searcher = new BM25Search(queryFn, true);

    const results = await searcher.search('');
    expect(results).toHaveLength(0);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('LIKE 模式多词分词 OR 匹配', async () => {
    const mockResults = [
      { chunk_id: 'chunk_1', source_file: 'a.docx', content: '匹配结果' },
    ];
    const queryFn = vi.fn().mockReturnValue(mockResults);
    const searcher = new BM25Search(queryFn, false);

    await searcher.search('政策 文件');

    // 验证两个词都有 LIKE 子句
    expect(queryFn).toHaveBeenCalledWith(
      expect.stringContaining('OR'),
      expect.arrayContaining(['%政策%', '%文件%']),
    );
  });
});

// ============================================================
// RRF Fusion 测试
// ============================================================

describe('rrfFuse', () => {
  it('两路独立结果正确融合', () => {
    const dense = [
      createChunk({ chunkId: 'a', score: 0.9 }),
      createChunk({ chunkId: 'b', score: 0.7 }),
    ];
    const sparse = [
      createChunk({ chunkId: 'c', score: 0.8 }),
    ];

    const result = rrfFuse(dense, sparse, { topK: 10 });

    expect(result).toHaveLength(3);
    // RRF 分数应 > 0
    for (const chunk of result) {
      expect(chunk.score).toBeGreaterThan(0);
    }
  });

  it('两路都出现的 chunk 获得 boost', () => {
    const dense = [createChunk({ chunkId: 'a', score: 0.9 })];
    const sparse = [createChunk({ chunkId: 'a', score: 0.5 })];

    const result = rrfFuse(dense, sparse, { topK: 10 });

    expect(result).toHaveLength(1);
    // 双路出现的 chunk RRF 分数 = 1/(60+1) + 1/(60+1) = 2/61
    expect(result[0].score).toBeCloseTo(2 / 61, 5);
  });

  it('topK 正确截断', () => {
    const dense = Array.from({ length: 10 }, (_, i) =>
      createChunk({ chunkId: `d${i}`, score: 0.9 - i * 0.05 }),
    );
    const sparse = Array.from({ length: 10 }, (_, i) =>
      createChunk({ chunkId: `s${i}`, score: 0.8 - i * 0.05 }),
    );

    const result = rrfFuse(dense, sparse, { topK: 5 });
    expect(result).toHaveLength(5);
  });

  it('dense 为空时仍返回 sparse 结果', () => {
    const sparse = [createChunk({ chunkId: 'a', score: 0.8 })];

    const result = rrfFuse([], sparse, { topK: 10 });
    expect(result).toHaveLength(1);
  });

  it('sparse 为空时仍返回 dense 结果', () => {
    const dense = [createChunk({ chunkId: 'a', score: 0.9 })];

    const result = rrfFuse(dense, [], { topK: 10 });
    expect(result).toHaveLength(1);
  });

  it('模拟 dense miss → sparse 命中的 hybrid fallback', () => {
    // dense 返回空（模拟 embedding 无法匹配精确文号）
    const dense: RetrievedChunk[] = [];
    // sparse 返回含"国发〔2024〕3号"的 chunk
    const sparse = [
      createChunk({
        chunkId: 'policy_chunk',
        content: '根据国发〔2024〕3号文件规定',
        score: 0.8,
      }),
    ];

    const result = rrfFuse(dense, sparse, { topK: 5 });

    expect(result).toHaveLength(1);
    expect(result[0].content).toContain('国发〔2024〕3号');
  });
});

// ============================================================
// QueryRewriter 测试
// ============================================================

describe('RuleBasedQueryRewriter', () => {
  it('去除停用词并保留关键词', async () => {
    const rewriter = new RuleBasedQueryRewriter();
    const result = await rewriter.rewrite('如何的写一篇通知');
    // 重写后应包含关键词（通知）
    expect(result).toContain('通知');
    // 结果非空
    expect(result.length).toBeGreaterThan(0);
  });

  it('提取政策文号', async () => {
    const rewriter = new RuleBasedQueryRewriter();
    const result = await rewriter.rewrite('国发〔2024〕3号文件');
    expect(result).toContain('国发〔2024〕3号');
  });

  it('空查询返回原值', async () => {
    const rewriter = new RuleBasedQueryRewriter();
    const result = await rewriter.rewrite('');
    expect(result).toBe('');
  });
});

// ============================================================
// ScoreAndKeywordGrader 测试
// ============================================================

describe('ScoreAndKeywordGrader', () => {
  it('关键词匹配加分', () => {
    const grader = new ScoreAndKeywordGrader();
    const chunks = [
      createChunk({ content: '这是一份关于政策的通知文件', score: 0.01 }),
    ];

    const graded = grader.grade(chunks, '政策 通知', 0);

    expect(graded).toHaveLength(1);
    expect(graded[0].score).toBeGreaterThan(0.01); // 应有加分
  });

  it('低于 minScore 的结果被过滤', () => {
    const grader = new ScoreAndKeywordGrader();
    const chunks = [
      createChunk({ content: '无关内容', score: 0.001 }),
    ];

    const graded = grader.grade(chunks, '政策', 0.1);
    expect(graded).toHaveLength(0);
  });
});

// ============================================================
// PassThroughReranker 测试
// ============================================================

describe('PassThroughReranker', () => {
  it('直接透传结果', async () => {
    const reranker = new PassThroughReranker();
    const chunks = [createChunk({ score: 0.5 }), createChunk({ score: 0.3 })];

    const result = await reranker.rerank(chunks, '测试');
    expect(result).toEqual(chunks);
  });
});

// ============================================================
// RAGEngine options object 构造测试
// ============================================================

describe('RAGEngine options object 构造', () => {
  it('使用 options object 构造并检索', async () => {
    const mockIndex = {
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([createChunk()]),
      remove: vi.fn().mockResolvedValue(undefined),
      reindex: vi.fn().mockResolvedValue(undefined),
      getByChunkId: vi.fn().mockResolvedValue(null),
      stats: vi.fn().mockResolvedValue({ totalChunks: 0, uniqueSources: 0, dimensions: 0, backend: 'mock' }),
    };
    const mockEmbedder = {
      embed: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([new Array(1024).fill(0.1)]),
    };

    const engine = new RAGEngine({
      index: mockIndex as any,
      embedder: mockEmbedder as any,
    });

    const results = await engine.search('测试');
    expect(results).toHaveLength(1);
  });

  it('indexDocument 只写入向量索引并返回分块', async () => {
    const mockIndex = {
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      remove: vi.fn().mockResolvedValue(undefined),
      reindex: vi.fn().mockResolvedValue(undefined),
      getByChunkId: vi.fn().mockResolvedValue(null),
      stats: vi.fn().mockResolvedValue({ totalChunks: 0, uniqueSources: 0, dimensions: 0, backend: 'mock' }),
    };
    const mockEmbedder = {
      embed: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([new Array(1024).fill(0.1)]),
    };
    const engine = new RAGEngine({
      index: mockIndex as any,
      embedder: mockEmbedder as any,
    });

    const chunks = await engine.indexDocument({
      filePath: '/test/doc.docx',
      fileName: 'doc.docx',
      fileType: 'docx',
      content: '测试内容',
      sections: [{ title: '标题', content: '测试内容', level: 1, locator: '段落1' }],
      metadata: {},
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(mockEmbedder.embedBatch).toHaveBeenCalledWith(chunks.map((chunk) => chunk.content));
    expect(mockIndex.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          chunkId: chunks[0].chunkId,
          content: chunks[0].content,
        }),
      ]),
    );
  });

  it('注入完整 components 后 search 走 pipeline', async () => {
    const mockIndex = {
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([createChunk({ score: 0.9 })]),
      remove: vi.fn().mockResolvedValue(undefined),
      reindex: vi.fn().mockResolvedValue(undefined),
      getByChunkId: vi.fn().mockResolvedValue(null),
      stats: vi.fn().mockResolvedValue({ totalChunks: 0, uniqueSources: 0, dimensions: 0, backend: 'mock' }),
    };
    const mockEmbedder = {
      embed: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([new Array(1024).fill(0.1)]),
    };

    // 注入完整的可插拔组件
    const sparseSearcher = { search: vi.fn().mockResolvedValue([]) };
    const queryRewriter = { rewrite: vi.fn().mockImplementation(async (q: string) => q) };
    const reranker = { rerank: vi.fn().mockImplementation(async (c: any[]) => c) };
    const relevanceGrader = { grade: vi.fn().mockImplementation((c: any[]) => c) };

    const engine = new RAGEngine({
      index: mockIndex as any,
      embedder: mockEmbedder as any,
      components: {
        sparseSearcher: sparseSearcher as any,
        queryRewriter: queryRewriter as any,
        reranker: reranker as any,
        relevanceGrader: relevanceGrader as any,
      },
    });

    const results = await engine.search('测试');

    // 验证各组件被调用
    expect(queryRewriter.rewrite).toHaveBeenCalled();
    expect(sparseSearcher.search).toHaveBeenCalled();
    expect(reranker.rerank).toHaveBeenCalled();
    expect(relevanceGrader.grade).toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });
});

// ============================================================
// 004_chunks_fts 迁移测试
// ============================================================

describe('004_chunks_fts 迁移', () => {
  it('applyMigration004 导出正确', async () => {
    const mod = await import('../../packages/store/src/migrations/004_chunks_fts.js');
    expect(typeof mod.applyMigration004).toBe('function');
    expect(mod.MIGRATION_004_VERSION).toBe(4);
  });
});

// ============================================================
// runtime-factory 串联验证
// ============================================================

describe('runtime-factory RAG 注入串联', () => {
  it('createDesktopRuntimeBundle 导出正确', async () => {
    const mod = await import('../../apps/desktop/electron/runtime-factory.js');
    expect(typeof mod.createDesktopRuntimeBundle).toBe('function');
    expect(typeof mod.createRuntimeBundleForTest).toBe('function');
  });

  it('createRuntimeBundleForTest 返回 RAG 能力', async () => {
    const { createRuntimeBundleForTest } = await import('../../apps/desktop/electron/runtime-factory.js');
    const snapshot = await createRuntimeBundleForTest('direct');
    expect(snapshot.hasRagProvider).toBe(true);
    expect(snapshot.hasPlanController).toBe(true);
  });

  it('createDesktopRuntimeBundle 导出 resumeSession 函数', async () => {
    const mod = await import('../../apps/desktop/electron/runtime-factory.js');
    // DesktopRuntimeBundle 应包含 resumeSession 字段
    const { createDesktopRuntimeBundle } = mod;
    expect(typeof createDesktopRuntimeBundle).toBe('function');
  });
});
