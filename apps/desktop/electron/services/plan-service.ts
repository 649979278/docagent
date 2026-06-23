import type { Plan, PlanOutline } from '@workagent/shared';
import type { AgentRuntime } from '@workagent/agent-core';
import type { Database, PlanRecord } from '@workagent/store';
import {
  approvePlan,
  getActivePlanBySession,
  getPlan,
  updatePlan,
  updateSession,
} from '@workagent/store';
import { approvePlanWithOutline } from '../plan-persistence.js';

/** 计划服务依赖。 */
export interface PlanServiceDeps {
  db: Database;
  runtime: AgentRuntime;
}

/**
 * 计划应用服务。
 * 统一处理 Plan 模式、审批、拒绝和运行时 active plan 恢复，避免 IPC/Worker/Runtime 状态分叉。
 */
export class PlanService {
  private readonly db: Database;
  private readonly runtime: AgentRuntime;

  /**
   * 创建计划服务。
   * @param deps - 服务依赖。
   */
  constructor(deps: PlanServiceDeps) {
    this.db = deps.db;
    this.runtime = deps.runtime;
  }

  /**
   * 进入或退出计划模式。
   * @param sessionId - 会话 ID。
   * @param enabled - 是否启用计划模式。
   * @returns 当前模式。
   */
  setPlanMode(sessionId: string, enabled: boolean): { mode: 'plan' | 'chat' } {
    const mode = enabled ? 'plan' : 'chat';
    updateSession(this.db, sessionId, {
      mode,
      activePlanId: enabled ? undefined : null,
    });

    if (enabled) {
      this.runtime.getPlanController().enterPlanMode(sessionId);
    } else {
      this.runtime.getPlanController().cancelPlan();
    }

    return { mode };
  }

  /**
   * 批准或拒绝计划。
   * @param params - 审批参数。
   * @returns 审批结果。
   */
  approve(params: {
    sessionId: string;
    planId: string;
    approved: boolean;
    updatedOutlineJson?: string;
  }): { planId: string; approved: boolean; sessionId: string } {
    const updatedOutline = parseUpdatedOutline(params.updatedOutlineJson);
    this.restoreActivePlan(params.sessionId, params.planId);

    if (!params.approved) {
      this.runtime.getPlanController().cancelPlan();
      updatePlan(this.db, params.planId, { status: 'cancelled' });
      updateSession(this.db, params.sessionId, { mode: 'chat', activePlanId: null });
      return { planId: params.planId, approved: false, sessionId: params.sessionId };
    }

    approvePlanWithOutline(this.runtime, updatedOutline);
    approvePlan(this.db, params.planId, params.updatedOutlineJson);
    updateSession(this.db, params.sessionId, { mode: 'execute', activePlanId: params.planId });
    return { planId: params.planId, approved: true, sessionId: params.sessionId };
  }

  /**
   * 按 session/plan 从数据库恢复运行时 active plan。
   * @param sessionId - 会话 ID。
   * @param planId - 可选计划 ID。
   * @returns 恢复后的计划。
   */
  restoreActivePlan(sessionId: string, planId?: string): Plan | null {
    const controller = this.runtime.getPlanController();
    const current = controller.getActivePlan();
    if (current && (!planId || current.id === planId)) {
      return current;
    }

    const record = planId ? getPlan(this.db, planId) : getActivePlanBySession(this.db, sessionId);
    if (!record) {
      return null;
    }

    const restored = planRecordToPlan(record);
    controller.restorePlan(restored);
    return restored;
  }
}

/**
 * 解析用户编辑后的计划提纲。
 * @param updatedOutlineJson - 提纲 JSON。
 * @returns 计划提纲。
 */
export function parseUpdatedOutline(updatedOutlineJson?: string): PlanOutline | undefined {
  if (!updatedOutlineJson) {
    return undefined;
  }
  try {
    return JSON.parse(updatedOutlineJson) as PlanOutline;
  } catch {
    return undefined;
  }
}

/**
 * 从计划记录解析提纲。
 * @param record - 计划记录。
 * @returns 计划提纲。
 */
function parsePlanOutline(record: PlanRecord): PlanOutline {
  try {
    return JSON.parse(record.outlineJson) as PlanOutline;
  } catch {
    return {
      title: record.title,
      goal: record.goal ?? '',
      materialBasis: '',
      structure: [],
      expectedOutput: '',
      risks: [],
      questions: [],
      citations: [],
    };
  }
}

/**
 * 将数据库计划记录转换成运行时计划快照。
 * @param record - 计划记录。
 * @returns 运行时计划。
 */
function planRecordToPlan(record: PlanRecord): Plan {
  return {
    id: record.id,
    sessionId: record.sessionId,
    status: record.status,
    title: record.title,
    goal: record.goal ?? '',
    outline: parsePlanOutline(record),
    approvedAt: record.approvedAt ?? undefined,
    finalDocPath: record.finalDocPath ?? undefined,
    createdAt: record.createdAt,
  };
}
