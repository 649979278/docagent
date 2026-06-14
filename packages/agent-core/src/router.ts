/**
 * 显式状态机路由 - 决定Agent循环的下一步动作
 * 基于状态驱动而非关键词匹配，对齐 Claude Code 的 transition 模式
 * 路由决策基于 QueryLoopState.mode + QueryLoopState 当前轮状态的确定性推导
 */

import type { AgentMode, Plan, PlanPhase } from '@workagent/shared';
import type { LoopState, LoopDecision, TransitionType } from './state.js';
import type { QueryLoopState } from './query-state.js';

// ============================================================
// 路由结果
// ============================================================

/** 路由结果详情 */
export interface RouteResult {
  /** 循环决策 */
  decision: LoopDecision;
  /** 运行时转换类型 */
  transition: TransitionType;
  /** 决策原因 */
  reason: string;
  /** 模式切换（如果需要） */
  modeSwitch?: AgentMode;
  /** 阶段切换（如果需要） */
  phaseSwitch?: PlanPhase;
}

// ============================================================
// 主路由函数（QueryLoopState 版本 - 迭代2核心）
// ============================================================

/**
 * 根据QueryLoopState决定下一步动作（推荐入口）
 * 显式状态机：基于 state.mode + state.hasError/hasToolCalls 确定性推导
 * @param state - 当前不可变查询循环状态
 * @param activePlan - 当前激活的计划（如果有）
 * @returns 路由决策结果
 */
export function routeAfterQueryLoop(
  state: QueryLoopState,
  activePlan: Plan | null,
): RouteResult {
  // 1. 错误优先：有错误且未重试 → retry
  if (state.hasError && !state.retried) {
    return {
      decision: 'Continue',
      transition: 'error_retry',
      reason: '工具执行失败，尝试一次fallback重试',
    };
  }

  // 2. 有工具调用 → 继续执行
  if (state.hasToolCalls) {
    return {
      decision: 'Continue',
      transition: 'next_turn',
      reason: '有工具调用待执行',
    };
  }

  // 3. 按 mode 路由（显式状态驱动）
  switch (state.mode) {
    case 'plan':
      return routePlanModeFromState(state, activePlan);
    case 'execute':
      return routeExecuteModeFromState(state, activePlan);
    default:
      return {
        decision: 'Done',
        transition: 'completed',
        reason: '模型已生成最终回复',
      };
  }
}

// ============================================================
// 兼容旧路由函数（LoopState 版本 - 过渡保留）
// ============================================================

/**
 * 根据Agent循环状态决定下一步动作（LoopState 兼容版）
 * 显式状态机：基于 state.mode + state.currentTurn 确定性推导
 * @param state - 当前循环状态
 * @param hasToolCalls - 模型是否请求了工具调用
 * @param activePlan - 当前激活的计划（如果有）
 * @returns 路由决策结果
 * @deprecated 优先使用 routeAfterQueryLoop
 */
export function routeAfterResponse(
  state: LoopState,
  hasToolCalls: boolean,
  activePlan: Plan | null,
): RouteResult {
  // 1. 错误优先：有错误且未重试 → retry
  if (state.currentTurn?.hasError && !state.currentTurn.retried) {
    return {
      decision: 'Continue',
      transition: 'error_retry',
      reason: '工具执行失败，尝试一次fallback重试',
    };
  }

  // 2. 有工具调用 → 继续执行（不再自动切 plan）
  if (hasToolCalls) {
    return {
      decision: 'Continue',
      transition: 'next_turn',
      reason: '有工具调用待执行',
    };
  }

  // 3. 按 mode 路由（显式状态驱动）
  switch (state.mode) {
    case 'plan':
      return routePlanMode(state, activePlan);
    case 'execute':
      return routeExecuteMode(state, activePlan);
    default:
      return {
        decision: 'Done',
        transition: 'completed',
        reason: '模型已生成最终回复',
      };
  }
}

// ============================================================
// QueryLoopState 版本的 mode 路由
// ============================================================

/**
 * 计划模式下的路由逻辑（QueryLoopState 版本）
 * @param state - 查询循环状态
 * @param activePlan - 当前计划
 * @returns 路由决策
 */
function routePlanModeFromState(state: QueryLoopState, activePlan: Plan | null): RouteResult {
  // 计划已生成，等待用户批准
  if (activePlan && activePlan.status === 'draft') {
    return {
      decision: 'WaitApproval',
      transition: 'wait_approval',
      reason: '计划已生成，等待用户审查和批准',
      phaseSwitch: 'PLAN_REVIEW',
    };
  }

  // 计划已批准，切换到执行模式
  if (activePlan && activePlan.status === 'approved') {
    return {
      decision: 'EnterPlan',
      transition: 'execute_plan',
      reason: '计划已批准，进入执行阶段',
      modeSwitch: 'execute',
      phaseSwitch: 'EXECUTE_DRAFT',
    };
  }

  // 计划执行中
  if (activePlan && activePlan.status === 'executing') {
    return {
      decision: 'Continue',
      transition: 'next_turn',
      reason: '计划正在执行中',
    };
  }

  // 默认继续收集信息
  return {
    decision: 'Continue',
    transition: 'next_turn',
    reason: '继续收集信息和规划',
    phaseSwitch: 'PLAN_COLLECT',
  };
}

/**
 * 执行模式下的路由逻辑（QueryLoopState 版本）
 * @param state - 查询循环状态
 * @param activePlan - 当前计划
 * @returns 路由决策
 */
function routeExecuteModeFromState(state: QueryLoopState, activePlan: Plan | null): RouteResult {
  // 计划已完成
  if (activePlan && activePlan.status === 'completed') {
    return {
      decision: 'Done',
      transition: 'completed',
      reason: '计划已执行完成',
      phaseSwitch: 'EXECUTE_EXPORT',
    };
  }

  // 计划已取消
  if (activePlan && activePlan.status === 'cancelled') {
    return {
      decision: 'Done',
      transition: 'completed',
      reason: '计划已取消',
    };
  }

  // 继续执行
  return {
    decision: 'Continue',
    transition: 'next_turn',
    reason: '继续执行计划步骤',
  };
}

// ============================================================
// LoopState 版本的 mode 路由（兼容保留）
// ============================================================

/**
 * 计划模式下的路由逻辑 - 基于计划状态而非关键词
 * @param state - 循环状态
 * @param activePlan - 当前计划
 * @returns 路由决策
 * @deprecated
 */
function routePlanMode(state: LoopState, activePlan: Plan | null): RouteResult {
  // 计划已生成，等待用户批准
  if (activePlan && activePlan.status === 'draft') {
    return {
      decision: 'WaitApproval',
      transition: 'wait_approval',
      reason: '计划已生成，等待用户审查和批准',
      phaseSwitch: 'PLAN_REVIEW',
    };
  }

  // 计划已批准，切换到执行模式
  if (activePlan && activePlan.status === 'approved') {
    return {
      decision: 'EnterPlan',
      transition: 'execute_plan',
      reason: '计划已批准，进入执行阶段',
      modeSwitch: 'execute',
      phaseSwitch: 'EXECUTE_DRAFT',
    };
  }

  // 计划执行中
  if (activePlan && activePlan.status === 'executing') {
    return {
      decision: 'Continue',
      transition: 'next_turn',
      reason: '计划正在执行中',
    };
  }

  // 默认继续收集信息
  return {
    decision: 'Continue',
    transition: 'next_turn',
    reason: '继续收集信息和规划',
    phaseSwitch: 'PLAN_COLLECT',
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
      transition: 'completed',
      reason: '计划已执行完成',
      phaseSwitch: 'EXECUTE_EXPORT',
    };
  }

  // 计划已取消
  if (activePlan && activePlan.status === 'cancelled') {
    return {
      decision: 'Done',
      transition: 'completed',
      reason: '计划已取消',
    };
  }

  // 继续执行
  return {
    decision: 'Continue',
    transition: 'next_turn',
    reason: '继续执行计划步骤',
  };
}

// ============================================================
// UI 建议函数（不参与路由决策）
// ============================================================

/** 建议进入 plan 模式的关键词列表 */
const PLAN_SUGGESTION_KEYWORDS = [
  '写一份', '起草', '撰写', '生成文件', '帮我写',
  '公文', '通知', '报告', '请示', '批复', '函',
  '决定', '意见', '办法', '规定', '方案',
];

/**
 * 判断用户输入是否暗示需要进入计划模式
 * 仅作为 UI 建议信号，不参与路由决策
 * @param userInput - 用户输入文本
 * @returns 是否建议进入计划模式
 */
export function shouldSuggestPlanMode(userInput: string): boolean {
  return PLAN_SUGGESTION_KEYWORDS.some((keyword) => userInput.includes(keyword));
}
