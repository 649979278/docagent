/**
 * Pipeline 辅助函数测试
 * 验证：
 * 1. getMessagesAfterCompactBoundary 正确切片
 * 2. applyToolResultBudget 截断超出预算的工具结果
 * 3. contextCollapse 合并连续 assistant 消息
 * 4. checkTokenBudget 收益递减检测
 * 5. estimateMessagesTokens 正确估算
 */

import { describe, it, expect } from 'vitest';
import {
  getMessagesAfterCompactBoundary,
  applyToolResultBudget,
  contextCollapse,
  checkTokenBudget,
  estimateMessagesTokens,
} from '../context/pipeline.js';
import { createQueryLoopState, updateQueryLoopState } from '../query-state.js';
import type { QueryLoopState } from '../query-state.js';
import type { Message, ContextBudget } from '@workagent/shared';

/** 创建测试用预算 */
function createTestBudget(overrides?: Partial<ContextBudget>): ContextBudget {
  return {
    systemPrompt: 500,
    conversationHistory: 15000,
    ragResults: 8000,
    toolResults: 4000,
    maxCompletionTokens: 4096,
    total: 32768,
    ...overrides,
  };
}

/** 创建测试消息 */
function createMessage(overrides: Partial<Message> & { role: Message['role']; content: string }): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    tokenCount: Math.ceil(overrides.content.length / 2),
    timestamp: Date.now(),
    ...overrides,
  };
}

// ============================================================
// getMessagesAfterCompactBoundary
// ============================================================

describe('getMessagesAfterCompactBoundary', () => {
  it('无 compact boundary 时返回全部消息', () => {
    const state = createQueryLoopState('s-1', 'chat', createTestBudget(), [], '你好');
    state.messages = [
      createMessage({ role: 'user', content: '第一条' }),
      createMessage({ role: 'assistant', content: '第二条' }),
    ];

    const result = getMessagesAfterCompactBoundary(state);
    expect(result).toHaveLength(2);
  });

  it('lastCompactBoundaryId 存在但消息中无匹配时返回全部消息', () => {
    let state = createQueryLoopState('s-1', 'chat', createTestBudget(), [], '你好');
    state = updateQueryLoopState(state, { lastCompactBoundaryId: 'boundary-999' });
    state = updateQueryLoopState(state, {
      messages: [
        createMessage({ role: 'user', content: '第一条' }),
        createMessage({ role: 'assistant', content: '第二条' }),
      ],
    });

    const result = getMessagesAfterCompactBoundary(state);
    expect(result).toHaveLength(2);
  });

  it('找到 boundary 消息时返回之后的消息', () => {
    const boundaryId = 'compact-micro-1234';
    const msg1 = createMessage({ role: 'user', content: 'boundary前' });
    const msg2 = createMessage({ role: 'system', content: '压缩摘要', compactBoundaryId: boundaryId });
    const msg3 = createMessage({ role: 'assistant', content: 'boundary后1' });
    const msg4 = createMessage({ role: 'user', content: 'boundary后2' });

    const state0 = createQueryLoopState('s-1', 'chat', createTestBudget(), [], '你好');
    const state = updateQueryLoopState(state0, {
      lastCompactBoundaryId: boundaryId,
      messages: [msg1, msg2, msg3, msg4],
    });

    const result = getMessagesAfterCompactBoundary(state);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('boundary后1');
    expect(result[1].content).toBe('boundary后2');
  });

  it('boundary 是最后一条消息时返回空列表', () => {
    const boundaryId = 'compact-summary-5678';
    const msg1 = createMessage({ role: 'user', content: '用户' });
    const msg2 = createMessage({ role: 'system', content: '压缩', compactBoundaryId: boundaryId });

    let state2 = createQueryLoopState('s-1', 'chat', createTestBudget(), [], '你好');
    state2 = updateQueryLoopState(state2, {
      lastCompactBoundaryId: boundaryId,
      messages: [msg1, msg2],
    });

    const result = getMessagesAfterCompactBoundary(state2);
    expect(result).toHaveLength(0);
  });
});

// ============================================================
// applyToolResultBudget
// ============================================================

describe('applyToolResultBudget', () => {
  it('工具结果在预算内时不截断', () => {
    const budget = createTestBudget({ toolResults: 1000 });
    const messages: Message[] = [
      createMessage({ role: 'user', content: '问题' }),
      createMessage({ role: 'tool', content: '结果1', toolCallId: 'tc-1', toolName: 'rag_search' }),
      createMessage({ role: 'assistant', content: '回答' }),
    ];

    const result = applyToolResultBudget(messages, budget);
    expect(result[1].content).toBe('结果1');
  });

  it('工具结果超出预算时截断', () => {
    const budget = createTestBudget({ toolResults: 5 });
    const longOutput = '这是一个非常长的工具输出结果'.repeat(50);
    const messages: Message[] = [
      createMessage({ role: 'tool', content: longOutput, toolCallId: 'tc-1', toolName: 'doc_read', tokenCount: Math.ceil(longOutput.length / 2) }),
      createMessage({ role: 'tool', content: '第二条工具结果', toolCallId: 'tc-2', toolName: 'file_list', tokenCount: 10 }),
    ];

    const result = applyToolResultBudget(messages, budget);
    // 第一条工具结果 tokenCount 远超 budget.toolResults=5，已被截断
    expect(result[0].content).toContain('结果已压缩');
    // 第二条也应被截断
    expect(result[1].content).toContain('结果已压缩');
  });

  it('非工具消息不受影响', () => {
    const budget = createTestBudget({ toolResults: 0 });
    const messages: Message[] = [
      createMessage({ role: 'user', content: '问题' }),
      createMessage({ role: 'assistant', content: '回答' }),
      createMessage({ role: 'system', content: '系统' }),
    ];

    const result = applyToolResultBudget(messages, budget);
    expect(result[0].content).toBe('问题');
    expect(result[1].content).toBe('回答');
    expect(result[2].content).toBe('系统');
  });
});

// ============================================================
// contextCollapse
// ============================================================

describe('contextCollapse', () => {
  it('合并连续的无工具调用 assistant 消息', () => {
    const messages: Message[] = [
      createMessage({ role: 'assistant', content: '第一部分', tokenCount: 10 }),
      createMessage({ role: 'assistant', content: '第二部分', tokenCount: 10 }),
    ];

    const result = contextCollapse(messages);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('第一部分\n第二部分');
    expect(result[0].tokenCount).toBe(20);
  });

  it('不合并有工具调用的 assistant 消息', () => {
    const messages: Message[] = [
      createMessage({
        role: 'assistant',
        content: '我需要搜索',
        tokenCount: 10,
        toolCalls: [{ id: 'tc-1', name: 'rag_search', arguments: { query: 'test' } }],
      }),
      createMessage({ role: 'assistant', content: '搜索结果如下', tokenCount: 10 }),
    ];

    const result = contextCollapse(messages);
    expect(result).toHaveLength(2);
  });

  it('不合并非连续的 assistant 消息', () => {
    const messages: Message[] = [
      createMessage({ role: 'assistant', content: '回答1', tokenCount: 10 }),
      createMessage({ role: 'user', content: '追问', tokenCount: 5 }),
      createMessage({ role: 'assistant', content: '回答2', tokenCount: 10 }),
    ];

    const result = contextCollapse(messages);
    expect(result).toHaveLength(3);
  });

  it('三个连续 assistant 消息合并为一个', () => {
    const messages: Message[] = [
      createMessage({ role: 'assistant', content: 'A', tokenCount: 5 }),
      createMessage({ role: 'assistant', content: 'B', tokenCount: 5 }),
      createMessage({ role: 'assistant', content: 'C', tokenCount: 5 }),
    ];

    const result = contextCollapse(messages);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('A\nB\nC');
    expect(result[0].tokenCount).toBe(15);
  });

  it('空消息列表返回空', () => {
    const result = contextCollapse([]);
    expect(result).toHaveLength(0);
  });

  it('不修改原始消息', () => {
    const original: Message[] = [
      createMessage({ role: 'assistant', content: 'A', tokenCount: 5 }),
      createMessage({ role: 'assistant', content: 'B', tokenCount: 5 }),
    ];
    const originalContent = original[0].content;

    contextCollapse(original);
    expect(original[0].content).toBe(originalContent);
  });
});

// ============================================================
// checkTokenBudget
// ============================================================

describe('checkTokenBudget', () => {
  it('turnCount < 3 时不触发收益递减', () => {
    const state = createQueryLoopState('s-1', 'chat', createTestBudget(), [], '你好');
    const updated = updateQueryLoopState(state, { turnCount: 2 });

    const result = checkTokenBudget(updated, 100);
    expect(result.shouldStop).toBe(false);
    expect(result.diminishingReturns).toBe(false);
  });

  it('turnCount >= 3 + completionTokens < 500 时触发收益递减', () => {
    const state = createQueryLoopState('s-1', 'chat', createTestBudget(), [], '你好');
    const updated = updateQueryLoopState(state, { turnCount: 3 });

    const result = checkTokenBudget(updated, 200);
    expect(result.shouldStop).toBe(true);
    expect(result.diminishingReturns).toBe(true);
    expect(result.reason).toContain('收益递减');
  });

  it('turnCount >= 3 + completionTokens >= 500 时不触发', () => {
    const state = createQueryLoopState('s-1', 'chat', createTestBudget(), [], '你好');
    const updated = updateQueryLoopState(state, { turnCount: 5 });

    const result = checkTokenBudget(updated, 600);
    expect(result.shouldStop).toBe(false);
    expect(result.diminishingReturns).toBe(false);
  });
});

// ============================================================
// estimateMessagesTokens
// ============================================================

describe('estimateMessagesTokens', () => {
  it('正确估算消息列表的总 token 数', () => {
    const messages: Message[] = [
      createMessage({ role: 'user', content: '你好', tokenCount: 5 }),
      createMessage({ role: 'assistant', content: '世界', tokenCount: 10 }),
    ];

    expect(estimateMessagesTokens(messages)).toBe(15);
  });

  it('tokenCount 为 0 时用 content 估算', () => {
    const messages: Message[] = [
      { id: 'm-1', role: 'user', content: '你好世界', tokenCount: 0, timestamp: Date.now() },
    ];

    // estimateTokens('你好世界') = Math.ceil(4 / 2) = 2
    expect(estimateMessagesTokens(messages)).toBe(2);
  });

  it('空消息列表返回 0', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });
});
