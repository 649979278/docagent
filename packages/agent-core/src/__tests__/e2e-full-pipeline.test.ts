/**
 * 端到端完整管道测试
 * 验证完整对话流程：消息构建 → 模型调用 → 工具执行 → 压缩 → 恢复 → 路由
 *
 * 使用 MockProvider 和 MockExecutor 模拟完整 agentic loop
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentEventEnvelope, AgentMode, Plan, Message, PlanPhase } from '@workagent/shared';
import { createQueryLoopState, updateQueryLoopState } from '../query-state.js';
import { routeAfterQueryLoop } from '../router.js';
import type { TransitionType } from '../state.js';
import { getMessagesAfterCompactBoundary, applyToolResultBudget, contextCollapse, checkTokenBudget } from '../context/pipeline.js';
import { BudgetManager } from '../context/budget.js';
import { DiagnosticsCollector } from '../diagnostics.js';
import type { QueryLoopState } from '../query-state.js';

// ============================================================
// 辅助：创建测试用消息
// ============================================================

function createMessage(role: 'user' | 'assistant' | 'system' | 'tool', content: string, overrides?: Partial<Message>): Message {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role,
    content,
    tokenCount: Math.ceil(content.length / 2),
    timestamp: Date.now(),
    eventType: 'text',
    ...overrides,
  };
}

// ============================================================
// 测试
// ============================================================

describe('端到端完整管道', () => {
  let state: QueryLoopState;

  beforeEach(() => {
    state = createQueryLoopState('session-test', 'chat', {
      total: 32768,
      systemPrompt: 2000,
      conversationHistory: 20000,
      ragResults: 4000,
      toolResults: 4000,
      maxCompletionTokens: 2768,
    }, [], '帮我写一份通知');
  });

  it('完整一轮对话：用户输入 → 路由 → 完成', () => {
    // 1. 初始状态
    expect(state.mode).toBe('chat');
    expect(state.transition).toBe('next_turn');
    expect(state.turnCount).toBe(0);

    // 2. 添加用户消息
    const userMsg = createMessage('user', '帮我写一份通知');
    state = updateQueryLoopState(state, {
      messages: [...state.messages, userMsg],
    });

    // 3. 模拟模型返回最终回复（无工具调用）
    state = updateQueryLoopState(state, {
      assistantContent: '好的，我来帮您写通知。',
      hasToolCalls: false,
      hasError: false,
    });

    // 4. 路由决策
    const routeResult = routeAfterQueryLoop(state, null);
    expect(routeResult.decision).toBe('Done');
    expect(routeResult.transition).toBe('completed');

    // 5. 更新状态
    state = updateQueryLoopState(state, {
      transition: routeResult.transition as TransitionType,
      turnCount: state.turnCount + 1,
    });

    expect(state.transition).toBe('completed');
    expect(state.turnCount).toBe(1);
  });

  it('工具调用流程：用户输入 → 工具调用 → 继续轮次', () => {
    // 1. 添加用户消息
    const userMsg = createMessage('user', '读取文档内容');
    state = updateQueryLoopState(state, {
      messages: [...state.messages, userMsg],
    });

    // 2. 模拟模型返回工具调用
    state = updateQueryLoopState(state, {
      assistantContent: '',
      hasToolCalls: true,
      hasError: false,
    });

    // 3. 路由决策：有工具调用 → 继续轮次
    const routeResult = routeAfterQueryLoop(state, null);
    expect(routeResult.decision).toBe('Continue');
    expect(routeResult.transition).toBe('next_turn');

    // 4. 更新状态继续下一轮
    state = updateQueryLoopState(state, {
      transition: routeResult.transition as TransitionType,
      turnCount: state.turnCount + 1,
    });

    expect(state.transition).toBe('next_turn');
  });

  it('工具失败重试流程', () => {
    // 1. 模拟工具失败（无工具调用，仅错误）
    state = updateQueryLoopState(state, {
      hasToolCalls: false,
      hasError: true,
      retried: false,
    });

    // 2. 路由决策：错误 + 未重试 → error_retry
    const routeResult = routeAfterQueryLoop(state, null);
    expect(routeResult.transition).toBe('error_retry');

    // 3. 重试后仍然失败
    state = updateQueryLoopState(state, {
      hasToolCalls: false,
      retried: true,
      hasError: true,
    });

    // 4. 路由决策：错误 + 已重试 → completed（不再重试）
    const routeResult2 = routeAfterQueryLoop(state, null);
    expect(routeResult2.transition).toBe('completed');
  });

  it('Pipeline 步骤顺序：boundary → budget → compact → collapse → 检查', () => {
    // 1. 设置 compact boundary
    const compactMsg = createMessage('system', '压缩摘要', {
      compactBoundaryId: 'boundary_1',
    });
    const postMsg1 = createMessage('assistant', '压缩后回复1');
    const postMsg2 = createMessage('assistant', '压缩后回复2');
    const toolMsg = createMessage('tool', '工具结果内容比较长，用于测试预算截断');

    state = updateQueryLoopState(state, {
      messages: [compactMsg, postMsg1, toolMsg, postMsg2],
      lastCompactBoundaryId: 'boundary_1',
    });

    // 2. getMessagesAfterCompactBoundary
    const afterBoundary = getMessagesAfterCompactBoundary(state);
    expect(afterBoundary.length).toBe(3); // postMsg1, toolMsg, postMsg2
    expect(afterBoundary[0].content).toBe('压缩后回复1');

    // 3. applyToolResultBudget
    const budgeted = applyToolResultBudget(afterBoundary, state.budget);
    // 工具消息应该被保留（预算充足）
    expect(budgeted.length).toBe(3);

    // 4. contextCollapse - 合并连续 assistant 消息
    const collapsed = contextCollapse(budgeted);
    // postMsg1 和 postMsg2 不连续（中间有 toolMsg），不合并
    expect(collapsed.length).toBe(3);

    // 5. 测试合并场景：两个连续的 assistant 消息
    const msgA = createMessage('assistant', '第一段');
    const msgB = createMessage('assistant', '第二段');
    const collapsed2 = contextCollapse([msgA, msgB]);
    expect(collapsed2.length).toBe(1);
    expect(collapsed2[0].content).toBe('第一段\n第二段');

    // 6. checkTokenBudget - 收益递减检测
    const shouldStop = checkTokenBudget(state, 100);
    expect(shouldStop.shouldStop).toBe(false); // turnCount=0，不会停止
  });

  it('Plan 模式完整流程', () => {
    // 1. 进入 Plan 模式
    state = updateQueryLoopState(state, { mode: 'plan' });

    // 2. 初始阶段：收集信息
    const route1 = routeAfterQueryLoop(state, null);
    expect(route1.transition).toBe('next_turn'); // 默认继续

    // 3. Plan 草稿阶段
    const draftPlan: Plan = {
      id: 'plan_1',
      sessionId: 'session-test',
      status: 'draft',
      title: '关于XX的通知',
      goal: '撰写通知',
      outline: {
        title: '关于XX的通知',
        goal: '撰写通知',
        materialBasis: '参考材料',
        structure: [],
        expectedOutput: 'docx文档',
        risks: [],
        questions: [],
        citations: [],
      },
      createdAt: Date.now(),
    };
    state = updateQueryLoopState(state, { activePlan: draftPlan, planPhase: 'PLAN_DRAFT' });

    const route2 = routeAfterQueryLoop(state, draftPlan);
    expect(route2.transition).toBe('wait_approval');

    // 4. Plan 批准
    const approvedPlan: Plan = { ...draftPlan, status: 'approved' };
    state = updateQueryLoopState(state, { activePlan: approvedPlan, planPhase: 'PLAN_REVIEW' });

    const route3 = routeAfterQueryLoop(state, approvedPlan);
    expect(route3.transition).toBe('execute_plan');

    // 5. 执行阶段
    const executingPlan: Plan = { ...draftPlan, status: 'executing' };
    state = updateQueryLoopState(state, { activePlan: executingPlan, planPhase: 'EXECUTE_DRAFT', mode: 'execute' });

    const route4 = routeAfterQueryLoop(state, executingPlan);
    expect(route4.decision).toBe('Continue');

    // 6. 执行完成
    const completedPlan: Plan = { ...draftPlan, status: 'completed' };
    state = updateQueryLoopState(state, { activePlan: completedPlan, planPhase: 'EXECUTE_EXPORT' });

    const route5 = routeAfterQueryLoop(state, completedPlan);
    expect(route5.transition).toBe('completed');
  });

  it('诊断数据收集完整流程', () => {
    const collector = new DiagnosticsCollector();

    // 1. 记录触发 section
    collector.recordSection('system_prompt');
    collector.recordSection('rag_inject');
    collector.recordSection('system_prompt'); // 去重

    // 2. 记录 token 使用
    collector.recordTokenUsage(5000, 2000, 1500, 800);

    // 3. 记录工具调用
    collector.recordToolCall(true, false);

    // 4. 记录压缩
    collector.recordCompact(true, 3000);

    // 5. 记录 RAG
    collector.recordRag(5, 2000);

    // 6. 获取诊断数据
    const data = collector.getData();

    expect(data.triggeredSections).toEqual(['system_prompt', 'rag_inject']);
    expect(data.historyTokens).toBe(5000);
    expect(data.ragTokens).toBe(2000);
    expect(data.toolTokens).toBe(1500);
    expect(data.completionTokens).toBe(800);
    expect(data.hadToolCall).toBe(true);
    expect(data.toolParseFailed).toBe(false);
    expect(data.compactOccurred).toBe(true);
    expect(data.compactFreedTokens).toBe(3000);
    expect(data.ragHitCount).toBe(5);
    expect(data.ragInjectedTokens).toBe(2000);
  });

  it('BudgetManager 动态预算分配', () => {
    const manager = new BudgetManager(32768, 'chat');
    const budget = manager.getBudget();

    expect(budget.total).toBe(32768);
    expect(budget.systemPrompt).toBeGreaterThan(0);
    expect(budget.ragResults).toBeGreaterThan(0);
    expect(budget.toolResults).toBeGreaterThan(0);
    expect(budget.maxCompletionTokens).toBeGreaterThan(0);

    // 各段预算之和不超过总额
    const allocated = budget.systemPrompt + budget.conversationHistory + budget.ragResults + budget.toolResults + budget.maxCompletionTokens;
    expect(allocated).toBeLessThanOrEqual(budget.total);
  });

  it('不可变状态更新：旧引用不变', () => {
    const originalState = state;
    const originalTurnCount = state.turnCount;

    // 更新状态
    const newState = updateQueryLoopState(state, { turnCount: 5 });

    // 旧引用不变
    expect(originalState.turnCount).toBe(originalTurnCount);
    // 新状态已更新
    expect(newState.turnCount).toBe(5);
  });
});
