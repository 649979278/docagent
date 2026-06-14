/**
 * Router 单元测试 - 验证显式状态机路由逻辑
 * 测试场景：error_retry、plan_draft→WaitApproval、execute→Done、mode_suggestion
 */

import { describe, it, expect } from 'vitest';
import { routeAfterResponse, shouldSuggestPlanMode } from '../router.js';
import type { LoopState } from '../state.js';
import { createLoopState, createTurnState } from '../state.js';
import type { Plan } from '@workagent/shared';

/** 创建带错误标记的 LoopState */
function createLoopStateWithError(
  mode: 'chat' | 'plan' | 'execute' = 'chat',
  options?: { hasError?: boolean; retried?: boolean },
): LoopState {
  const state = createLoopState('test-session', mode);
  state.currentTurn = createTurnState('turn-1', '测试输入');
  if (options?.hasError !== undefined) state.currentTurn.hasError = options.hasError;
  if (options?.retried !== undefined) state.currentTurn.retried = options.retried;
  return state;
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

describe('routeAfterResponse', () => {
  describe('error retry', () => {
    it('hasError=true + retried=false 时路由为 Continue + error_retry', () => {
      const state = createLoopStateWithError('chat', { hasError: true, retried: false });
      const result = routeAfterResponse(state, false, null);

      expect(result.decision).toBe('Continue');
      expect(result.transition).toBe('error_retry');
      expect(result.reason).toContain('重试');
    });

    it('hasError=true + retried=true 时不重试，路由到 Done', () => {
      const state = createLoopStateWithError('chat', { hasError: true, retried: true });
      const result = routeAfterResponse(state, false, null);

      expect(result.decision).toBe('Done');
      expect(result.transition).toBe('completed');
    });

    it('hasError=false 时不受错误逻辑影响', () => {
      const state = createLoopStateWithError('chat', { hasError: false });
      const result = routeAfterResponse(state, false, null);

      expect(result.decision).toBe('Done');
      expect(result.transition).toBe('completed');
    });
  });

  describe('tool calls routing', () => {
    it('有工具调用时继续执行，transition=next_turn', () => {
      const state = createLoopStateWithError('chat');
      const result = routeAfterResponse(state, true, null);

      expect(result.decision).toBe('Continue');
      expect(result.transition).toBe('next_turn');
    });

    it('plan mode 有工具调用时也继续执行', () => {
      const state = createLoopStateWithError('plan');
      const result = routeAfterResponse(state, true, null);

      expect(result.decision).toBe('Continue');
      expect(result.transition).toBe('next_turn');
    });
  });

  describe('plan mode routing', () => {
    it('activePlan=draft 时路由为 WaitApproval', () => {
      const state = createLoopStateWithError('plan');
      const plan = createTestPlan('draft');
      const result = routeAfterResponse(state, false, plan);

      expect(result.decision).toBe('WaitApproval');
      expect(result.transition).toBe('wait_approval');
      expect(result.phaseSwitch).toBe('PLAN_REVIEW');
    });

    it('activePlan=approved 时路由为 EnterPlan + execute_plan', () => {
      const state = createLoopStateWithError('plan');
      const plan = createTestPlan('approved');
      const result = routeAfterResponse(state, false, plan);

      expect(result.decision).toBe('EnterPlan');
      expect(result.transition).toBe('execute_plan');
      expect(result.modeSwitch).toBe('execute');
      expect(result.phaseSwitch).toBe('EXECUTE_DRAFT');
    });

    it('activePlan=executing 时继续执行', () => {
      const state = createLoopStateWithError('plan');
      const plan = createTestPlan('executing');
      const result = routeAfterResponse(state, false, plan);

      expect(result.decision).toBe('Continue');
      expect(result.transition).toBe('next_turn');
    });

    it('无 activePlan 时默认继续收集信息', () => {
      const state = createLoopStateWithError('plan');
      const result = routeAfterResponse(state, false, null);

      expect(result.decision).toBe('Continue');
      expect(result.transition).toBe('next_turn');
      expect(result.phaseSwitch).toBe('PLAN_COLLECT');
    });
  });

  describe('execute mode routing', () => {
    it('activePlan=completed 时路由为 Done', () => {
      const state = createLoopStateWithError('execute');
      const plan = createTestPlan('completed');
      const result = routeAfterResponse(state, false, plan);

      expect(result.decision).toBe('Done');
      expect(result.transition).toBe('completed');
      expect(result.phaseSwitch).toBe('EXECUTE_EXPORT');
    });

    it('activePlan=cancelled 时路由为 Done', () => {
      const state = createLoopStateWithError('execute');
      const plan = createTestPlan('cancelled');
      const result = routeAfterResponse(state, false, plan);

      expect(result.decision).toBe('Done');
      expect(result.transition).toBe('completed');
    });

    it('activePlan=executing 时继续执行', () => {
      const state = createLoopStateWithError('execute');
      const plan = createTestPlan('executing');
      const result = routeAfterResponse(state, false, plan);

      expect(result.decision).toBe('Continue');
      expect(result.transition).toBe('next_turn');
    });
  });

  describe('chat mode routing', () => {
    it('无工具调用、无特殊状态时路由为 Done + completed', () => {
      const state = createLoopStateWithError('chat');
      const result = routeAfterResponse(state, false, null);

      expect(result.decision).toBe('Done');
      expect(result.transition).toBe('completed');
    });
  });
});

describe('shouldSuggestPlanMode', () => {
  it('包含公文关键词时返回 true', () => {
    expect(shouldSuggestPlanMode('帮我写一份通知')).toBe(true);
    expect(shouldSuggestPlanMode('起草一份报告')).toBe(true);
    expect(shouldSuggestPlanMode('撰写公文')).toBe(true);
  });

  it('不包含关键词时返回 false', () => {
    expect(shouldSuggestPlanMode('今天天气怎么样')).toBe(false);
    expect(shouldSuggestPlanMode('帮我查个资料')).toBe(false);
  });
});
