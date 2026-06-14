import type { AgentEventEnvelope, Plan, PlanOutline } from '@workagent/shared';
import {
  createPlan,
  getPlan,
  updatePlan,
  updateSession,
  type Database,
} from '@workagent/store';
import type { AgentRuntime } from '@workagent/agent-core';

/**
 * RAG 组件诊断快照。
 */
export interface RetrievalDiagnosticsSnapshot {
  queryRewriter: {
    name: string;
    fallback: boolean;
  };
  reranker: {
    name: string;
    fallback: boolean;
  };
  relevanceGrader: {
    name: string;
  };
}

/**
 * 计划持久化桥接依赖。
 */
export interface PlanPersistenceBridgeOptions {
  /** 数据库实例。 */
  db: Database;
  /** AgentRuntime 实例。 */
  runtime: AgentRuntime;
  /** 可选的统一事件出口。 */
  emitEvent?: (event: AgentEventEnvelope) => void;
  /** 当前检索组件诊断快照。 */
  retrievalDiagnostics: RetrievalDiagnosticsSnapshot;
}

/**
 * 绑定计划控制器和运行时事件到持久化层。
 * @param options - 计划持久化桥配置。
 * @returns 取消监听函数。
 */
export function bindPlanPersistenceBridge(options: PlanPersistenceBridgeOptions): () => void {
  const { db, runtime, emitEvent } = options;
  const controller = runtime.getPlanController();
  let latestPlan: Plan | null = controller.getActivePlan();

  const unsubs: Array<() => void> = [];

  unsubs.push(controller.onEvent((event) => {
    const activePlan = controller.getActivePlan() ?? latestPlan;

    if (event.type === 'plan_generated') {
      latestPlan = event.plan;
      persistGeneratedPlan(db, event.plan);
      updateSession(db, event.plan.sessionId, {
        mode: 'plan',
        activePlanId: event.plan.id,
      });
      db.save();
      emitEvent?.(createPlanBridgeEvent(event.plan.sessionId, 'rag_diagnostics', {
        diagnostics: options.retrievalDiagnostics,
      }));
      return;
    }

    if (event.type === 'plan_approved') {
      latestPlan = event.plan;
      persistApprovedPlan(db, event.plan);
      updateSession(db, event.plan.sessionId, {
        mode: 'execute',
        activePlanId: event.plan.id,
      });
      db.save();
      return;
    }

    if (!activePlan) {
      return;
    }

    if (event.type === 'phase_change') {
      if (event.to === 'EXECUTE_DRAFT' && activePlan.status === 'executing') {
        updatePlan(db, activePlan.id, {
          status: 'executing',
          outlineJson: JSON.stringify(activePlan.outline),
        });
        updateSession(db, activePlan.sessionId, {
          mode: 'execute',
          activePlanId: activePlan.id,
        });
        db.save();
      }
      return;
    }

    if (event.type === 'step_updated') {
      updatePlan(db, activePlan.id, {
        outlineJson: JSON.stringify(activePlan.outline),
      });
      db.save();
      return;
    }

    if (event.type === 'execution_completed') {
      updatePlan(db, activePlan.id, {
        status: 'completed',
        outlineJson: JSON.stringify(activePlan.outline),
        finalDocPath: activePlan.finalDocPath ?? null,
      });
      db.save();
      return;
    }

    if (event.type === 'plan_cancelled') {
      const sessionId = activePlan.sessionId;
      updatePlan(db, activePlan.id, {
        status: 'cancelled',
      });
      updateSession(db, sessionId, {
        mode: 'chat',
        activePlanId: null,
      });
      db.save();
      latestPlan = null;
    }
  }));

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}

/**
 * 将用户修改后的 outline 应用到运行时计划控制器。
 * @param runtime - AgentRuntime 实例。
 * @param outline - 用户修改后的计划提纲。
 */
export function approvePlanWithOutline(runtime: AgentRuntime, outline?: PlanOutline): void {
  runtime.getPlanController().approvePlan(outline);
}

/**
 * 为测试和 IPC 提供计划状态与最终文档路径回写。
 * @param runtime - AgentRuntime 实例。
 * @param finalDocPath - 输出文档路径。
 */
export function markActivePlanCompleted(runtime: AgentRuntime, finalDocPath?: string): void {
  const plan = runtime.getPlanController().getActivePlan();
  if (!plan) {
    return;
  }
  if (finalDocPath) {
    plan.finalDocPath = finalDocPath;
  }
}

/**
 * 持久化新生成的计划。
 * @param db - 数据库实例。
 * @param plan - 当前计划。
 */
function persistGeneratedPlan(db: Database, plan: Plan): void {
  const existing = getPlan(db, plan.id);
  const outlineJson = JSON.stringify(plan.outline);
  if (!existing) {
    createPlan(db, {
      id: plan.id,
      sessionId: plan.sessionId,
      title: plan.title || plan.outline.title || '未命名计划',
      goal: plan.goal || plan.outline.goal,
      outlineJson,
      status: plan.status,
    });
    return;
  }
  updatePlan(db, plan.id, {
    title: plan.title || plan.outline.title || existing.title,
    goal: plan.goal || plan.outline.goal || existing.goal,
    outlineJson,
    status: 'draft',
  });
}

/**
 * 持久化已批准计划。
 * @param db - 数据库实例。
 * @param plan - 当前计划。
 */
function persistApprovedPlan(db: Database, plan: Plan): void {
  persistGeneratedPlan(db, plan);
  updatePlan(db, plan.id, {
    status: 'approved',
    approvedAt: plan.approvedAt ?? Date.now(),
    outlineJson: JSON.stringify(plan.outline),
  });
}

/**
 * 创建桥接层自定义事件。
 * @param sessionId - 会话ID。
 * @param type - 事件类型。
 * @param data - 事件数据。
 * @returns 统一事件信封。
 */
function createPlanBridgeEvent(
  sessionId: string,
  type: 'rag_diagnostics',
  data: Record<string, unknown>,
): AgentEventEnvelope {
  return {
    sessionId,
    turnId: '',
    sequence: Date.now(),
    type,
    data,
    createdAt: Date.now(),
    source: 'runtime',
  } as AgentEventEnvelope;
}
