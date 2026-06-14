/**
 * BudgetManager 优先级分配测试
 * 验证：
 * 1. 按优先级分配 system > RAG > tool > history
 * 2. 高优先级优先满足
 * 3. 低优先级使用剩余
 * 4. 预算不足时低优先级分配为 0
 * 5. execute 模式使用 execute 比率
 * 6. getUsage 返回各优先级使用量
 */

import { describe, it, expect } from 'vitest';
import { BudgetManager, allocateBudget, BUDGET_PRIORITY } from '../context/budget.js';

// ============================================================
// 测试
// ============================================================

describe('BudgetManager 优先级分配', () => {
  it('allocateWithPriority 按优先级分配', () => {
    const manager = new BudgetManager(32768, 'chat');
    const result = manager.allocateWithPriority(2000, 5000, 3000);

    // system 优先分配
    expect(result.systemPrompt).toBe(2000);
    // RAG 优先于 tool
    expect(result.ragResults).toBe(5000);
    // tool 使用剩余
    expect(result.toolResults).toBe(3000);
    // history 使用最后剩余
    expect(result.conversationHistory).toBeGreaterThan(0);
    // completion 固定 4096
    expect(result.maxCompletionTokens).toBe(4096);
  });

  it('高优先级优先满足 — 空间不足时 RAG 先于 tool', () => {
    const manager = new BudgetManager(10000, 'chat');
    // 大额 RAG 请求
    const result = manager.allocateWithPriority(500, 4000, 3000);

    // system 满足
    expect(result.systemPrompt).toBe(500);
    // RAG 满足
    expect(result.ragResults).toBe(4000);
    // tool 可能只有剩余
    expect(result.toolResults).toBeGreaterThan(0);
    // history 使用最后剩余
    expect(result.conversationHistory).toBeGreaterThanOrEqual(0);
  });

  it('预算不足时低优先级分配受限', () => {
    const manager = new BudgetManager(5000, 'chat');
    // 总预算 5000，减去 completion 4096 后剩余 904
    // 超大 system + RAG + tool 请求
    const result = manager.allocateWithPriority(1000, 3000, 5000);

    // system 最多分到剩余 904
    expect(result.systemPrompt).toBe(904);
    // RAG 和 tool 分配为 0（system 已用完剩余）
    expect(result.ragResults).toBe(0);
    expect(result.toolResults).toBe(0);
  });

  it('execute 模式使用 execute 比率', () => {
    const chatBudget = allocateBudget(32768, 'chat');
    const executeBudget = allocateBudget(32768, 'execute');

    // execute 模式 tool 占比更高
    expect(executeBudget.toolResults).toBeGreaterThan(chatBudget.toolResults);
    // execute 模式 history 占比更低
    expect(executeBudget.conversationHistory).toBeLessThan(chatBudget.conversationHistory);
  });

  it('getUsage 返回各优先级使用量', () => {
    const manager = new BudgetManager(32768, 'chat');
    manager.allocateWithPriority(1000, 2000, 1500);

    const usage = manager.getUsage();
    expect(usage.system).toBe(1000);
    expect(usage.rag).toBe(2000);
    expect(usage.tool_replay).toBe(1500);
  });

  it('BUDGET_PRIORITY 包含正确优先级顺序', () => {
    expect(BUDGET_PRIORITY[0]).toBe('system');
    expect(BUDGET_PRIORITY[4]).toBe('rag');
    expect(BUDGET_PRIORITY[5]).toBe('tool_replay');
    expect(BUDGET_PRIORITY[6]).toBe('history');
  });
});
