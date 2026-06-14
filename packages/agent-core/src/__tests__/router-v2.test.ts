/**
 * Router QueryLoopState 版本测试
 * 验证 routeAfterQueryLoop 直接接受 QueryLoopState 的路由逻辑
 * 与 router.test.ts 中的 LoopState 版本对应，确保行为一致
 */

import { describe, it, expect } from 'vitest';
import { routeAfterQueryLoop, shouldSuggestPlanMode } from '../router.js';
import { createQueryLoopState, updateQueryLoopState } from '../query-state.js';
import type { QueryLoopState } from '../query-state.js';
import type { Plan, ContextBudget } from '@workagent/shared';

/** 创建测试用预算 */
function createTestBudget(): ContextBudget {
  return {
    systemPrompt: 500,
    conversationHistory: 15000,
    ragResults: 8000,
    toolResults: 4000,
    maxCompletionTokens: 4096,
    total: 32768,
  };
}

/** 创建测试用 Plan */
function createTestPlan(status: Plan['status']): Plan {
  return {
    id: 'plan-1',
    sessionId: 'test-session',
    status,
    title: '测试计划',
    goal: '测试目标',
    outline: {
      title: '测试计划',
      goal: '测试目标',
      materialBasis: '',
      structure: [],
      expectedOutput: '',
      risks: [],
      questions: [],
      citations: [],
    },
    createdAt: Date.now(),
  };
}

/** 创建 chat 模式的基础 state */
function createChatState(overrides?: Partial<QueryLoopState>): QueryLoopState {
  const state = createQueryLoopState('test-session', 'chat', createTestBudget(), [], '测试输入');
  if (overrides) return updateQueryLoopState(state, overrides);
  return state;
}

/** 创建 plan 模式的基础 state */
function createPlanState(overrides?: Partial<QueryLoopState>): QueryLoopState {
  const state = createQueryLoopState('test-session', 'plan', createTestBudget(), [], '写报告');
  if (overrides) return updateQueryLoopState(state, overrides);
  return state;
}

/** 创建 execute 模式的基础 state */
function createExecuteState(overrides?: Partial<QueryLoopState>): QueryLoopState {
  const state = createQueryLoopState('test-session', 'execute', createTestBudget(), [], '执行');
  if (overrides) return updateQueryLoopState(state, overrides);
  return state;
}

describe('routeAfterQueryLoop', () => {
  describe('error retry', () => {
    it('hasError=true + retried=false → Continue + error_retry', () => {
      const state = createChatState({ hasError: true, retried: false });
      const result = routeAfterQueryLoop(state, null);

      expect(result.decision).toBe('Continue');
      expect(result.transition).toBe('error_retry');
      expect(result.reason).toContain('重试');
    });

    it('hasError=true + retried=true → Done + completed', () => {
      const state = createChatState({ hasError: true, retried: true });
      const result = routeAfterQueryLoop(state, null);

      expect(result.decision).toBe('Done');
      expect(result.transition).toBe('completed');
    });

    it('hasError=false → 不受错误逻辑影响', () => {
      const state = createChatState({ hasError: false });
      const result = routeAfterQueryLoop(state, null);

      expect(result.decision).toBe('Done');
      expect(result.transition).toBe('completed');
    });
  });

  describe('tool calls routing', () => {
    it('hasToolCalls=true → Continue + next_turn', () => {
      const state = createChatState({ hasToolCalls: true });
      const result = routeAfterQueryLoop(state, null);

      expect(result.decision).toBe('Continue');
      expect(result.transition).toBe('next_turn');
    });

    it('plan 模式 + hasToolCalls=true → 继续', () => {
      const state = createPlanState({ hasToolCalls: true });
      const result = routeAfterQueryLoop(state, null);

      expect(result.decision).toBe('Continue');
      expect(result.transition).toBe('next_turn');
    });
  });

  describe('plan mode routing', () => {
    it('activePlan=draft → WaitApproval', () => {
      const state = createPlanState();
      const plan = createTestPlan('draft');
      const result = routeAfterQueryLoop(state, plan);

      expect(result.decision).toBe('WaitApproval');
      expect(result.transition).toBe('wait_approval');
      expect(result.phaseSwitch).toBe('PLAN_REVIEW');
    });

    it('activePlan=approved → EnterPlan + execute_plan', () => {
      const state = createPlanState();
      const plan = createTestPlan('approved');
      const result = routeAfterQueryLoop(state, plan);

      expect(result.decision).toBe('EnterPlan');
      expect(result.transition).toBe('execute_plan');
      expect(result.modeSwitch).toBe('execute');
      expect(result.phaseSwitch).toBe('EXECUTE_DRAFT');
    });

    it('activePlan=executing → Continue', () => {
      const state = createPlanState();
      const plan = createTestPlan('executing');
      const result = routeAfterQueryLoop(state, plan);

      expect(result.decision).toBe('Continue');
      expect(result.transition).toBe('next_turn');
    });

    it('无 activePlan → 继续收集', () => {
      const state = createPlanState();
      const result = routeAfterQueryLoop(state, null);

      expect(result.decision).toBe('Continue');
      expect(result.transition).toBe('next_turn');
      expect(result.phaseSwitch).toBe('PLAN_COLLECT');
    });
  });

  describe('execute mode routing', () => {
    it('activePlan=completed → Done', () => {
      const state = createExecuteState();
      const plan = createTestPlan('completed');
      const result = routeAfterQueryLoop(state, plan);

      expect(result.decision).toBe('Done');
      expect(result.transition).toBe('completed');
      expect(result.phaseSwitch).toBe('EXECUTE_EXPORT');
    });

    it('activePlan=cancelled → Done', () => {
      const state = createExecuteState();
      const plan = createTestPlan('cancelled');
      const result = routeAfterQueryLoop(state, plan);

      expect(result.decision).toBe('Done');
      expect(result.transition).toBe('completed');
    });

    it('activePlan=executing → Continue', () => {
      const state = createExecuteState();
      const plan = createTestPlan('executing');
      const result = routeAfterQueryLoop(state, plan);

      expect(result.decision).toBe('Continue');
      expect(result.transition).toBe('next_turn');
    });
  });

  describe('chat mode routing', () => {
    it('无工具调用 → Done + completed', () => {
      const state = createChatState();
      const result = routeAfterQueryLoop(state, null);

      expect(result.decision).toBe('Done');
      expect(result.transition).toBe('completed');
    });
  });

  describe('路由优先级', () => {
    it('错误优先于工具调用', () => {
      // hasError=true + hasToolCalls=true + retried=false → error_retry
      const state = createChatState({ hasError: true, hasToolCalls: true, retried: false });
      const result = routeAfterQueryLoop(state, null);

      expect(result.transition).toBe('error_retry');
    });

    it('工具调用优先于 mode 路由', () => {
      // plan 模式 + hasToolCalls=true + hasError=false → next_turn
      const state = createPlanState({ hasToolCalls: true, hasError: false });
      const result = routeAfterQueryLoop(state, null);

      expect(result.transition).toBe('next_turn');
    });
  });
});
