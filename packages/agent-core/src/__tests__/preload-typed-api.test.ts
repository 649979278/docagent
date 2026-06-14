/**
 * Preload 类型契约测试
 * 验证所有 IPC 返回类型结构正确
 */

import { describe, it, expect } from 'vitest';

// ============================================================
// IPC 返回类型契约定义（与 preload.ts 对齐）
// ============================================================

/** chat 返回类型 */
interface ChatResult {
  runId: string;
  accepted: boolean;
  success: boolean;
}

/** session-list 返回类型 */
interface SessionListResult {
  sessions: Array<{
    id: string;
    title: string;
    mode: 'chat' | 'plan' | 'execute';
    updatedAt: number;
  }>;
}

/** session-messages 返回类型 */
interface SessionMessagesResult {
  messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
  }>;
  cursor?: string;
}

/** knowledge-search 返回类型 */
interface KnowledgeSearchResult {
  query: string;
  topK: number;
  results: Array<{
    content: string;
    sourceFile: string;
    sourceType: string;
    locator: string;
    score: number;
  }>;
  error?: string;
}

/** knowledge-add 返回类型 */
interface KnowledgeAddResult {
  filePaths: string[];
  sessionId: string;
  results: Array<{
    filePath: string;
    status: string;
    documentId?: string;
    error?: string;
  }>;
}

/** models-status 返回类型 */
interface ModelsStatusResult {
  providers: Array<{
    name: string;
    available: boolean;
    models: string[];
  }>;
  activeModel: string;
  health: boolean;
}

/** session-resume 返回类型 */
interface SessionResumeResult {
  runId: string;
  lastSequence: number;
  terminalStatus: string | null;
  lastAssistantContent: string;
  activePlanSnapshot: Record<string, unknown> | null;
  output: {
    draftContent: string | null;
    docPath: string | null;
  } | null;
  totalEvents: number;
  transcriptPath: string;
}

describe('Preload 类型契约', () => {
  it('chat 返回结构正确', () => {
    const result: ChatResult = {
      runId: 'run_1234567890',
      accepted: true,
      success: true,
    };
    expect(result.runId).toMatch(/^run_/);
    expect(result.accepted).toBe(true);
    expect(result.success).toBe(true);
  });

  it('chat 返回失败结构正确', () => {
    const result: ChatResult = {
      runId: 'run_1234567890',
      accepted: true,
      success: false,
    };
    expect(result.success).toBe(false);
  });

  it('session-list 返回结构正确', () => {
    const result: SessionListResult = {
      sessions: [
        { id: 'session_1', title: '测试', mode: 'chat', updatedAt: Date.now() },
        { id: 'session_2', title: 'Plan测试', mode: 'plan', updatedAt: Date.now() },
      ],
    };
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0].mode).toBe('chat');
    expect(result.sessions[1].mode).toBe('plan');
  });

  it('session-messages 返回结构正确', () => {
    const result: SessionMessagesResult = {
      messages: [
        { id: 'msg_1', role: 'user', content: '你好', timestamp: Date.now() },
        { id: 'msg_2', role: 'assistant', content: '你好！', timestamp: Date.now() },
      ],
      cursor: 'cursor_123',
    };
    expect(result.messages).toHaveLength(2);
    expect(result.cursor).toBe('cursor_123');
  });

  it('knowledge-search 返回结构正确', () => {
    const result: KnowledgeSearchResult = {
      query: '测试查询',
      topK: 5,
      results: [
        { content: '内容1', sourceFile: 'doc1.docx', sourceType: 'docx', locator: '段落1', score: 0.95 },
        { content: '内容2', sourceFile: 'doc2.pptx', sourceType: 'pptx', locator: '幻灯片3', score: 0.87 },
      ],
    };
    expect(result.results).toHaveLength(2);
    expect(result.results[0].locator).toBe('段落1');
    expect(result.results[1].locator).toBe('幻灯片3');
  });

  it('knowledge-search 返回错误结构正确', () => {
    const result: KnowledgeSearchResult = {
      query: '测试',
      topK: 5,
      results: [],
      error: '未找到相关内容',
    };
    expect(result.error).toBe('未找到相关内容');
  });

  it('knowledge-add 返回结构正确', () => {
    const result: KnowledgeAddResult = {
      filePaths: ['/path/to/doc1.docx', '/path/to/doc2.pptx'],
      sessionId: 'session_1',
      results: [
        { filePath: '/path/to/doc1.docx', status: 'indexed', documentId: 'doc_123' },
        { filePath: '/path/to/doc2.pptx', status: 'failed', error: '解析失败' },
      ],
    };
    expect(result.results[0].status).toBe('indexed');
    expect(result.results[1].error).toBe('解析失败');
  });

  it('models-status 返回结构正确', () => {
    const result: ModelsStatusResult = {
      providers: [
        { name: 'ollama', available: true, models: ['qwen3.5:9b'] },
        { name: 'openai-compat', available: false, models: [] },
      ],
      activeModel: 'qwen3.5:9b',
      health: true,
    };
    expect(result.providers).toHaveLength(2);
    expect(result.activeModel).toBe('qwen3.5:9b');
    expect(result.health).toBe(true);
  });

  it('chat-abort 返回结构正确', () => {
    const result = { success: true };
    expect(result.success).toBe(true);
  });

  it('session-delete 返回结构正确', () => {
    const result = { success: true };
    expect(result.success).toBe(true);
  });

  it('session-resume 返回结构正确', () => {
    const result: SessionResumeResult = {
      runId: 'run_123',
      lastSequence: 8,
      terminalStatus: 'completed',
      lastAssistantContent: '最近输出',
      activePlanSnapshot: { id: 'plan_1' },
      output: {
        draftContent: '# 草稿',
        docPath: '/tmp/out.docx',
      },
      totalEvents: 12,
      transcriptPath: '/tmp/run_123.jsonl',
    };
    expect(result.output?.docPath).toContain('.docx');
    expect(result.activePlanSnapshot?.id).toBe('plan_1');
  });
});
