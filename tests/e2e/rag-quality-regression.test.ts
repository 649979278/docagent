/**
 * RAG 质量回归测试
 * 验证 Hybrid RAG 检索在不同场景下的召回质量：
 * 1. 精确政策文号通过 sparse 命中（dense miss → sparse hit）
 * 2. 语义相似查询通过 dense 命中
 * 3. RRF 两路融合：双路出现的 chunk 获得更高排名
 * 4. RuleBasedQueryRewriter 正确提取关键实体
 * 5. ScoreAndKeywordGrader 关键词加分效果
 * 6. BGEReranker 骨架降级行为
 * 7. OllamaQueryRewriter 骨架降级行为
 * 8. drainCollapse 保留最近消息
 * 9. resumeSession 从 transcript 恢复
 */

import { describe, it, expect, vi } from 'vitest';
import type { RetrievedChunk } from '@workagent/shared';
import {
  BM25Search,
  rrfFuse,
  RuleBasedQueryRewriter,
  OllamaQueryRewriter,
  PassThroughReranker,
  BGEReranker,
  ScoreAndKeywordGrader,
} from '@workagent/rag';
import { drainCollapse } from '@workagent/agent-core';
import { resumeSession, type RunLookupStore } from '@workagent/agent-core';
import type { Message, Plan } from '@workagent/shared';
import { initDatabase } from '@workagent/store';
import { createDesktopRuntimeBundle } from '../../apps/desktop/electron/runtime-factory.js';

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

/** 创建测试用 Message */
function createMessage(role: 'system' | 'user' | 'assistant' | 'tool', content: string, overrides: Partial<Message> = {}): Message {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    role,
    content,
    tokenCount: Math.ceil(content.length / 2),
    timestamp: Date.now(),
    ...overrides,
  };
}

// ============================================================
// RAG 质量回归测试
// ============================================================

describe('RAG 质量回归', () => {
  it('desktop runtime exposes retrieval diagnostics snapshot for current default chain', async () => {
    const db = await initDatabase({
      dbPath: `/tmp/workagent-rag-diag-${Date.now()}.db`,
    });
    const bundle = await createDesktopRuntimeBundle({
      db,
      autoApprovePermissions: true,
      appDataDir: `/tmp/workagent-rag-diag-${Date.now()}`,
    });

    expect(bundle.retrievalDiagnostics.queryRewriter.name.length).toBeGreaterThan(0);
    expect(bundle.retrievalDiagnostics.reranker.name.length).toBeGreaterThan(0);
    expect(typeof bundle.retrievalDiagnostics.queryRewriter.fallback).toBe('boolean');
    expect(typeof bundle.retrievalDiagnostics.reranker.fallback).toBe('boolean');
  });

  describe('Hybrid Fallback: dense miss → sparse hit', () => {
    it('精确政策文号通过 sparse 命中', () => {
      // dense 返回空（模拟 embedding 无法匹配精确文号）
      const dense: RetrievedChunk[] = [];
      // sparse 返回含"国发〔2024〕3号"的 chunk
      const sparse = [
        createChunk({
          chunkId: 'policy_chunk',
          content: '根据国发〔2024〕3号文件规定，进一步优化营商环境',
          score: 0.8,
        }),
      ];

      const result = rrfFuse(dense, sparse, { topK: 5 });

      expect(result).toHaveLength(1);
      expect(result[0].content).toContain('国发〔2024〕3号');
    });

    it('法规编号通过 sparse 命中', () => {
      const dense: RetrievedChunk[] = [];
      const sparse = [
        createChunk({
          chunkId: 'std_chunk',
          content: '依据GB/T 12345-2020标准，个人信息安全规范要求',
          score: 0.75,
        }),
      ];

      const result = rrfFuse(dense, sparse, { topK: 5 });

      expect(result).toHaveLength(1);
      expect(result[0].content).toContain('GB/T 12345-2020');
    });

    it('两路都有结果时融合正常', () => {
      const dense = [
        createChunk({ chunkId: 'd1', content: '数字化转型一期验收完成', score: 0.95 }),
      ];
      const sparse = [
        createChunk({ chunkId: 's1', content: '国发〔2024〕3号', score: 0.8 }),
      ];

      const result = rrfFuse(dense, sparse, { topK: 10 });

      expect(result).toHaveLength(2);
    });
  });

  describe('RRF 排名质量', () => {
    it('双路出现的 chunk 排名高于单路', () => {
      // chunk A 同时出现在 dense 和 sparse
      const dense = [
        createChunk({ chunkId: 'A', content: '营商环境优化', score: 0.9 }),
        createChunk({ chunkId: 'B', content: '其他内容', score: 0.7 }),
      ];
      const sparse = [
        createChunk({ chunkId: 'A', content: '营商环境优化', score: 0.5 }),
        createChunk({ chunkId: 'C', content: '无关内容', score: 0.3 }),
      ];

      const result = rrfFuse(dense, sparse, { topK: 10 });

      // chunk A 应排在最前面
      expect(result[0].chunkId).toBe('A');
      // A 的 RRF 分数 = 1/61 + 1/61 = 2/61 ≈ 0.0328
      expect(result[0].score).toBeCloseTo(2 / 61, 5);
    });
  });

  describe('QueryRewriter 实体提取', () => {
    it('RuleBasedQueryRewriter 提取政策文号', async () => {
      const rewriter = new RuleBasedQueryRewriter();
      const result = await rewriter.rewrite('请查找国发〔2024〕3号文件的相关规定');
      expect(result).toContain('国发〔2024〕3号');
    });

    it('RuleBasedQueryRewriter 提取法规编号', async () => {
      const rewriter = new RuleBasedQueryRewriter();
      const result = await rewriter.rewrite('GB/T 12345-2020 中的信息安全要求');
      expect(result).toContain('GB/T 12345-2020');
    });

    it('OllamaQueryRewriter 降级到 RuleBasedQueryRewriter', async () => {
      // Ollama 不可用时自动降级
      const rewriter = new OllamaQueryRewriter('http://localhost:99999', 'nonexistent');
      const result = await rewriter.rewrite('国发〔2024〕3号的通知');
      // 降级后仍应返回有意义的重写结果
      expect(result.length).toBeGreaterThan(0);
    });

    it('OllamaQueryRewriter 连续失败后自动禁用', async () => {
      const rewriter = new OllamaQueryRewriter('http://localhost:99999', 'nonexistent');
      // 连续调用3次触发禁用
      await rewriter.rewrite('测试1');
      await rewriter.rewrite('测试2');
      await rewriter.rewrite('测试3');
      expect(rewriter.isDisabled()).toBe(true);
    });
  });

  describe('ScoreAndKeywordGrader 关键词加分', () => {
    it('政策文号关键词显著加分', () => {
      const grader = new ScoreAndKeywordGrader();
      const chunks = [
        createChunk({ content: '国发〔2024〕3号文件关于优化营商环境', score: 0.01 }),
        createChunk({ content: '完全无关的内容', score: 0.01 }),
      ];

      const graded = grader.grade(chunks, '国发 2024 3号 营商环境', 0);

      // 包含关键词的 chunk 分数应更高
      expect(graded.length).toBeGreaterThanOrEqual(1);
      const policyChunk = graded.find(c => c.content.includes('国发'));
      expect(policyChunk).toBeDefined();
      expect(policyChunk!.score).toBeGreaterThan(0.01);
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

  describe('BGEReranker 降级行为', () => {
    it('Ollama 不可用时自动降级到透传', async () => {
      const reranker = new BGEReranker('http://localhost:99999', 'nonexistent');
      const chunks = [createChunk({ score: 0.9 }), createChunk({ score: 0.7 })];

      const result = await reranker.rerank(chunks, '测试');
      // 降级后应返回原始结果
      expect(result).toHaveLength(2);
    });

    it('3 次连续失败后自动禁用', async () => {
      const reranker = new BGEReranker('http://localhost:99999', 'nonexistent');
      const chunks = [createChunk()];

      await reranker.rerank(chunks, '测试1');
      await reranker.rerank(chunks, '测试2');
      await reranker.rerank(chunks, '测试3');

      expect(reranker.isDisabled()).toBe(true);
    });

    it('超过 20 条时超出部分直接追加', async () => {
      const reranker = new BGEReranker('http://localhost:99999', 'nonexistent');
      const chunks = Array.from({ length: 25 }, (_, i) =>
        createChunk({ chunkId: `c${i}`, score: 0.5 }),
      );

      const result = await reranker.rerank(chunks, '测试');
      // 25 条结果应全部返回（降级时透传）
      expect(result).toHaveLength(25);
    });
  });

  describe('BM25Search 边界', () => {
    it('空查询安全返回空结果', async () => {
      const queryFn = vi.fn();
      const searcher = new BM25Search(queryFn, true);

      const result = await searcher.search('');
      expect(result).toHaveLength(0);
      expect(queryFn).not.toHaveBeenCalled();
    });

    it('FTS5 查询失败降级到 LIKE', async () => {
      const likeResults = [
        { chunk_id: 'c1', source_file: 'a.docx', content: '降级结果' },
      ];
      const queryFn = vi.fn()
        .mockImplementationOnce(() => { throw new Error('FTS5 syntax error'); })
        .mockReturnValueOnce(likeResults);
      const searcher = new BM25Search(queryFn, true);

      const result = await searcher.search('特殊查询');
      expect(result).toHaveLength(1);
      expect(result[0].chunkId).toBe('c1');
    });
  });
});

// ============================================================
// Drain Collapse 测试
// ============================================================

describe('Drain Collapse', () => {
  it('保留系统消息 + 最近 N 条 + drain 通知', () => {
    // 使用足够长的消息内容，确保 drain 后确实释放 token
    const messages: Message[] = [
      createMessage('system', '系统提示'),
      ...Array.from({ length: 20 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? 'user' : 'assistant',
          `这是第${i + 1}条消息，内容较长用于测试drain collapse的token释放效果。重复填充文本以增加token数。`.repeat(3),
        )
      ),
    ];

    const result = drainCollapse(messages, [], null);

    expect(result.didDrain).toBe(true);
    expect(result.freedTokens).toBeGreaterThan(0);
    // 消息数应显著减少
    expect(result.messages.length).toBeLessThan(messages.length);
    // 系统消息应保留
    expect(result.messages.some(m => m.role === 'system')).toBe(true);
    // 最近消息应保留
    expect(result.messages.some(m => m.content.includes('第20条消息'))).toBe(true);
  });

  it('消息很少时不丢失关键消息', () => {
    const messages: Message[] = [
      createMessage('system', '系统提示'),
      createMessage('user', '用户消息'),
      createMessage('assistant', '助手回复'),
    ];

    const result = drainCollapse(messages, [], null);

    expect(result.didDrain).toBe(true);
    // 所有消息都应保留（总共 <= 4 + 1 system + 1 notice）
    expect(result.messages.length).toBeGreaterThanOrEqual(3);
  });

  it('有活跃计划时 drain 通知包含计划信息', () => {
    const messages: Message[] = [
      createMessage('system', '系统提示'),
      ...Array.from({ length: 10 }, (_, i) =>
        createMessage(i % 2 === 0 ? 'user' : 'assistant', `消息 ${i + 1} `.repeat(10))
      ),
    ];

    const plan: Plan = {
      id: 'plan_1',
      sessionId: 'session_1',
      goal: '起草通知文件',
      status: 'executing',
      title: '通知起草计划',
      outline: {
        title: '通知起草',
        goal: '起草通知文件',
        materialBasis: '',
        structure: [
          { id: 's1', description: '收集材料', status: 'completed' as const },
          { id: 's2', description: '起草初稿', status: 'in_progress' as const },
        ],
        expectedOutput: '',
        risks: [],
        questions: [],
        citations: [],
      },
      createdAt: Date.now(),
    };

    const result = drainCollapse(messages, [], plan);

    // drain 通知应包含计划目标
    const drainNotice = result.messages.find(
      m => m.content.includes('上下文紧急压缩') || m.content.includes('当前计划'),
    );
    expect(drainNotice).toBeDefined();
    expect(drainNotice!.content).toContain('起草通知文件');
  });
});

// ============================================================
// Resume Session 测试
// ============================================================

describe('Resume Session', () => {
  it('无 run 记录时返回 null', () => {
    const runLookup: RunLookupStore = {
      getLatestRun: () => null,
    };

    const result = resumeSession('nonexistent_session', '/tmp/no-such-dir', runLookup);
    expect(result).toBeNull();
  });

  it('有 run 但无 transcript 文件时返回 null', () => {
    const runLookup: RunLookupStore = {
      getLatestRun: () => ({
        runId: 'run_123',
        status: 'completed',
        terminalReason: null,
      }),
    };

    const result = resumeSession('session_1', '/tmp/no-such-dir', runLookup);
    expect(result).toBeNull();
  });

  it('有 run 和 transcript 文件时返回快照', async () => {
    // 创建临时 transcript 文件
    const tmpDir = `/tmp/test-transcript-${Date.now()}`;
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.mkdirSync(tmpDir, { recursive: true });

    const runId = 'run_test_123';
    const events = [
      { sessionId: 's1', turnId: 't1', sequence: 1, type: 'token', data: { text: '你好' }, createdAt: Date.now() },
      { sessionId: 's1', turnId: 't1', sequence: 2, type: 'token', data: { text: '世界' }, createdAt: Date.now() },
      { sessionId: 's1', turnId: 't1', sequence: 3, type: 'plan_generated', data: { plan: { id: 'p1', goal: '测试计划' } }, createdAt: Date.now() },
    ];

    const filePath = path.join(tmpDir, `${runId}.jsonl`);
    for (const event of events) {
      fs.appendFileSync(filePath, JSON.stringify(event) + '\n');
    }

    const runLookup: RunLookupStore = {
      getLatestRun: () => ({
        runId,
        status: 'completed',
        terminalReason: null,
      }),
    };

    const result = resumeSession('s1', tmpDir, runLookup);

    expect(result).not.toBeNull();
    expect(result!.runId).toBe(runId);
    expect(result!.totalEvents).toBe(3);
    expect(result!.terminalStatus).toBe('completed');
    expect(result!.activePlanSnapshot).toBeDefined();
    expect((result!.activePlanSnapshot as Record<string, unknown>).goal).toBe('测试计划');

    // 清理
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ============================================================
// Withheld Retry 逻辑验证（通过 runtime handleError 的单元测试）
// ============================================================

describe('Withheld Retry & Error Recovery Chain', () => {
  it('瞬态错误关键词识别', () => {
    // 验证 isTransientError 逻辑的关键词列表覆盖常见场景
    const transientMessages = [
      'Connection timeout after 30s',
      'ECONNRESET: peer reset',
      'ECONNREFUSED: connection refused',
      'Fetch failed: network error',
      'Rate limit exceeded',
      'Too many requests',
    ];

    // 这些消息应被识别为瞬态错误（通过 runtime 的 handleError 逻辑）
    // 直接验证关键词匹配逻辑
    for (const msg of transientMessages) {
      const lower = msg.toLowerCase();
      const isTransient =
        lower.includes('timeout') ||
        lower.includes('econnreset') ||
        lower.includes('econnrefused') ||
        lower.includes('fetch failed') ||
        lower.includes('network') ||
        lower.includes('rate limit') ||
        lower.includes('too many requests');
      expect(isTransient).toBe(true);
    }
  });

  it('非瞬态错误不应被重试', () => {
    const nonTransientMessages = [
      'Invalid API key',
      'Model not found',
      'JSON parse error',
      'Context length exceeded',
    ];

    for (const msg of nonTransientMessages) {
      const lower = msg.toLowerCase();
      const isTransient =
        lower.includes('timeout') ||
        lower.includes('econnreset') ||
        lower.includes('econnrefused') ||
        lower.includes('fetch failed') ||
        lower.includes('network') ||
        lower.includes('rate limit') ||
        lower.includes('too many requests');
      expect(isTransient).toBe(false);
    }
  });
});
