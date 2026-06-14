/**
 * 条件路由 - 决定Agent循环的下一步动作
 * 根据当前状态决定继续/进入计划/等待批准/完成
 */

import type { AgentMode, Plan, PlanPhase } from '@workagent/shared';
import type { LoopState, LoopDecision } from './state.js';

// ============================================================
// 路由结果
// ============================================================

/** 路由结果详情 */
export interface RouteResult {
  /** 循环决策 */
  decision: LoopDecision;
  /** 决策原因 */
  reason: string;
  /** 模式切换（如果需要） */
  modeSwitch?: AgentMode;
  /** 阶段切换（如果需要） */
  phaseSwitch?: PlanPhase;
}

// ============================================================
// 路由规则
// ============================================================

/**
 * 根据Agent循环状态决定下一步动作
 * @param state - 当前循环状态
 * @param hasToolCalls - 模型是否请求了工具调用
 * @param activePlan - 当前激活的计划（如果有）
 * @returns 路由决策结果
 */
export function routeAfterResponse(
  state: LoopState,
  hasToolCalls: boolean,
  activePlan: Plan | null,
): RouteResult {
  // 1. 如果有错误且未重试，继续重试
  if (state.currentTurn?.hasError && !state.currentTurn.retried) {
    return {
      decision: 'Continue',
      reason: '工具执行失败，尝试一次fallback重试',
    };
  }

  // 2. 如果有工具调用，继续执行
  if (hasToolCalls) {
    // 检查是否需要切换到计划模式
    if (state.mode === 'chat' && shouldEnterPlanMode(state)) {
      return {
        decision: 'EnterPlan',
        reason: '检测到复杂任务，建议进入计划模式',
        modeSwitch: 'plan',
        phaseSwitch: 'PLAN_COLLECT',
      };
    }
    return {
      decision: 'Continue',
      reason: '有工具调用待执行',
    };
  }

  // 3. 计划模式下的路由
  if (state.mode === 'plan') {
    return routePlanMode(state, activePlan);
  }

  // 4. 执行模式下的路由
  if (state.mode === 'execute') {
    return routeExecuteMode(state, activePlan);
  }

  // 5. 无工具调用且无特殊情况，完成当前轮次
  return {
    decision: 'Done',
    reason: '模型已生成最终回复',
  };
}

/**
 * 计划模式下的路由逻辑
 * Plan模式只允许read_only + plan工具
 * @param state - 循环状态
 * @param activePlan - 当前计划
 * @returns 路由决策
 */
function routePlanMode(state: LoopState, activePlan: Plan | null): RouteResult {
  const phase = state.currentTurn?.userInput
    ? detectPhaseFromContext(state)
    : null;

  // 计划已生成，等待用户批准
  if (activePlan && activePlan.status === 'draft') {
    return {
      decision: 'WaitApproval',
      reason: '计划已生成，等待用户审查和批准',
      phaseSwitch: 'PLAN_REVIEW',
    };
  }

  // 计划已批准，切换到执行模式
  if (activePlan && activePlan.status === 'approved') {
    return {
      decision: 'EnterPlan',
      reason: '计划已批准，进入执行阶段',
      modeSwitch: 'execute',
      phaseSwitch: 'EXECUTE_DRAFT',
    };
  }

  // 计划执行中
  if (activePlan && activePlan.status === 'executing') {
    return {
      decision: 'Continue',
      reason: '计划正在执行中',
      phaseSwitch: phase ?? undefined,
    };
  }

  // 默认继续收集信息
  return {
    decision: 'Continue',
    reason: '继续收集信息和规划',
    phaseSwitch: phase ?? 'PLAN_COLLECT',
  };
}

/**
 * 执行模式下的路由逻辑
 * @param state - 循环状态
 * @param activePlan - 当前计划
 * @returns 路由决策
 */
function routeExecuteMode(state: LoopState, activePlan: Plan | null): RouteResult {
  // 计划已完成
  if (activePlan && activePlan.status === 'completed') {
    return {
      decision: 'Done',
      reason: '计划已执行完成',
      phaseSwitch: 'EXECUTE_EXPORT',
    };
  }

  // 计划已取消
  if (activePlan && activePlan.status === 'cancelled') {
    return {
      decision: 'Done',
      reason: '计划已取消',
    };
  }

  // 继续执行
  return {
    decision: 'Continue',
    reason: '继续执行计划步骤',
  };
}

/**
 * 判断是否应该进入计划模式
 * 当用户请求涉及复杂公文写作时，建议进入计划模式
 * @param state - 循环状态
 * @returns 是否应进入计划模式
 */
function shouldEnterPlanMode(state: LoopState): boolean {
  const input = state.currentTurn?.userInput ?? '';
  const planKeywords = [
    '写一份', '起草', '撰写', '生成文件', '帮我写',
    '公文', '通知', '报告', '请示', '批复', '函',
    '决定', '意见', '办法', '规定', '方案',
  ];

  return planKeywords.some((keyword) => input.includes(keyword));
}

/**
 * 从上下文中推断当前应处于的计划阶段
 * @param state - 循环状态
 * @returns 推断的计划阶段
 */
function detectPhaseFromContext(state: LoopState): PlanPhase {
  const input = state.currentTurn?.userInput ?? '';

  // 根据输入关键词推断阶段
  if (input.includes('搜索') || input.includes('查找') || input.includes('检索')) {
    return 'PLAN_RESEARCH';
  }
  if (input.includes('提纲') || input.includes('计划') || input.includes('规划')) {
    return 'PLAN_DRAFT';
  }

  return 'PLAN_COLLECT';
}
