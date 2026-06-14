/**
 * BudgetManager 预留功能测试
 * 验证：
 * 1. reserveSystem 从 history 借用
 * 2. reserveRag 从 history 借用
 * 3. reserveToolReplay 从 history 借用
 * 4. reserveCompletion 从 history 借用
 * 5. 预留不超过默认分配时不调整
 * 6. 多次预留累积效果
 */

import { describe, it, expect } from 'vitest';
import { BudgetManager, allocateBudget } from '../context/budget.js';

// ============================================================
// 测试
// ============================================================

describe('BudgetManager 预留功能', () => {
  it('reserveSystem 从 history 借用超出的 token', () => {
    const manager = new BudgetManager(32768, 'chat');
    const defaultBudget = allocateBudget(32768, 'chat');

    // 系统 prompt 需要 2000 token，超出默认 500
    const result = manager.reserveSystem(2000);

    expect(result.systemPrompt).toBe(2000);
    // history 应减少 1500
    expect(result.conversationHistory).toBe(defaultBudget.conversationHistory - 1500);
  });

  it('reserveSystem 不超过默认分配时不调整', () => {
    const manager = new BudgetManager(32768, 'chat');
    const defaultBudget = allocateBudget(32768, 'chat');

    const result = manager.reserveSystem(300);

    expect(result.systemPrompt).toBe(defaultBudget.systemPrompt);
    expect(result.conversationHistory).toBe(defaultBudget.conversationHistory);
  });

  it('reserveRag 从 history 借用超出的 token', () => {
    const manager = new BudgetManager(32768, 'chat');
    const defaultBudget = allocateBudget(32768, 'chat');

    // RAG 需要 10000 token，超出默认分配
    const result = manager.reserveRag(10000);

    expect(result.ragResults).toBe(10000);
    expect(result.conversationHistory).toBeLessThan(defaultBudget.conversationHistory);
  });

  it('reserveToolReplay 从 history 借用超出的 token', () => {
    const manager = new BudgetManager(32768, 'chat');
    const defaultBudget = allocateBudget(32768, 'chat');

    const result = manager.reserveToolReplay(5000);

    expect(result.toolResults).toBe(5000);
    expect(result.conversationHistory).toBeLessThan(defaultBudget.conversationHistory);
  });

  it('reserveCompletion 从 history 借用', () => {
    const manager = new BudgetManager(32768, 'chat');
    const defaultBudget = allocateBudget(32768, 'chat');

    const result = manager.reserveCompletion(8192);

    expect(result.maxCompletionTokens).toBe(8192);
    expect(result.conversationHistory).toBeLessThan(defaultBudget.conversationHistory);
  });

  it('多次预留累积效果 — history 不会为负', () => {
    const manager = new BudgetManager(8192, 'chat');

    // 多次大额预留
    manager.reserveSystem(2000);
    manager.reserveRag(3000);
    manager.reserveToolReplay(2000);

    const budget = manager.getBudget();
    // history 不应为负
    expect(budget.conversationHistory).toBeGreaterThanOrEqual(0);
  });
});
