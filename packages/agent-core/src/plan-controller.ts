/**
 * 计划模式控制器 - 管理公文写作的Plan-Execute流程
 * PlanPhase: PLAN_COLLECT → PLAN_RESEARCH → PLAN_DRAFT → PLAN_REVIEW → EXECUTE_DRAFT → EXECUTE_EXPORT
 * 模型不能自行决定执行，必须用户批准后由Controller驱动
 */

import type {
  PlanPhase,
  Plan,
  PlanStep,
  PlanOutline,
  PlanStatus,
  AgentMode,
} from '@workagent/shared';
import type { AgentTool, ToolRegistry } from '@workagent/tools';

// ============================================================
// 计划控制器事件
// ============================================================

/** 计划控制器事件类型 - 事件名与 shared/events.ts 对齐 */
export type PlanControllerEvent =
  | { type: 'phase_change'; from: PlanPhase; to: PlanPhase }
  | { type: 'plan_generated'; plan: Plan }
  | { type: 'plan_approved'; plan: Plan }
  | { type: 'plan_cancelled' }
  | { type: 'step_updated'; step: PlanStep }
  | { type: 'execution_started' }
  | { type: 'execution_completed' };

/** 计划控制器事件回调 */
export type PlanControllerCallback = (event: PlanControllerEvent) => void;

// ============================================================
// PlanModeController
// ============================================================

/**
 * 计划模式控制器 - 驱动公文写作的Plan-Execute流程
 *
 * 核心规则：
 * - 模型不能自行决定执行，必须用户批准后由Controller驱动
 * - Plan模式只允许read_only + plan工具
 * - Execute模式允许read_only + execute工具
 * - phase转换由Controller控制，模型只能请求转换
 */
export class PlanModeController {
  /** 当前计划阶段 */
  private phase: PlanPhase = 'PLAN_COLLECT';
  /** 当前激活的计划 */
  private activePlan: Plan | null = null;
  /** 事件回调集合（支持多个 listener） */
  private callbacks = new Set<PlanControllerCallback>();
  /** 当前Agent模式 */
  private mode: AgentMode = 'chat';

  /**
   * 创建计划模式控制器
   */
  constructor() {}

  /**
   * 注册计划控制器事件监听器。
   * @param callback - 事件回调函数。
   * @returns 取消监听函数（用于防泄漏，应在 finally 中调用）。
   */
  onEvent(callback: PlanControllerCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * 获取当前计划阶段
   * @returns 当前阶段
   */
  getPhase(): PlanPhase {
    return this.phase;
  }

  /**
   * 获取当前激活的计划
   * @returns 当前计划
   */
  getActivePlan(): Plan | null {
    return this.activePlan;
  }

  /**
   * 获取当前Agent模式
   * @returns 当前模式
   */
  getMode(): AgentMode {
    return this.mode;
  }

  /**
   * 进入计划模式
   * @param sessionId - 会话ID
   */
  enterPlanMode(sessionId: string): void {
    const previousMode = this.mode;
    this.mode = 'plan';
    this.phase = 'PLAN_COLLECT';

    // 创建初始计划
    this.activePlan = {
      id: `plan-${Date.now()}`,
      sessionId,
      status: 'draft',
      title: '',
      goal: '',
      outline: {
        title: '',
        goal: '',
        materialBasis: '',
        structure: [],
        expectedOutput: '',
        risks: [],
        questions: [],
        citations: [],
      },
      createdAt: Date.now(),
    };

    this.emitEvent({ type: 'plan_generated', plan: this.activePlan });
  }

  /**
   * 根据当前阶段获取可用工具列表
   * Plan模式：只允许read_only + plan工具
   * Execute模式：允许read_only + execute工具
   * @param registry - 工具注册中心
   * @returns 可用工具列表
   */
  getToolsForPhase(registry: ToolRegistry): AgentTool[] {
    const currentMode = this.getEffectiveMode();
    const allTools = registry.getTools(currentMode);

    // 根据安全级别进一步过滤
    return allTools.filter((tool) => {
      // Plan模式：只允许read_only和plan模式的工具
      if (this.mode === 'plan') {
        return tool.isReadOnly() || tool.mode === 'plan';
      }

      // Execute模式：允许read_only和execute模式的工具
      if (this.mode === 'execute') {
        return tool.isReadOnly() || tool.mode === 'execute';
      }

      return true;
    });
  }

  /**
   * 获取当前阶段的有效工具模式
   * @returns 工具模式
   */
  private getEffectiveMode(): 'chat' | 'plan' | 'execute' {
    if (this.mode === 'plan') {
      return 'plan';
    }
    if (this.mode === 'execute') {
      return 'execute';
    }
    return 'chat';
  }

  /**
   * 推进到下一个阶段
   * @param nextPhase - 目标阶段
   */
  advancePhase(nextPhase: PlanPhase): void {
    if (!this.isValidTransition(this.phase, nextPhase)) {
      return;
    }

    const from = this.phase;
    this.phase = nextPhase;

    // 根据阶段切换模式
    if (nextPhase === 'EXECUTE_DRAFT' || nextPhase === 'EXECUTE_EXPORT') {
      this.mode = 'execute';
    } else if (nextPhase !== 'PLAN_REVIEW') {
      this.mode = 'plan';
    }

    this.emitEvent({ type: 'phase_change', from, to: nextPhase });
  }

  /**
   * 批准计划。
   * 只将状态设为 approved，不切换 phase/mode。
   * phase/mode 切换由 startExecution() 负责，在下次 runTurn 检测到 approved 时调用。
   *
   * @param updatedOutline - 用户修改后的提纲（可选）
   */
  approvePlan(updatedOutline?: PlanOutline): void {
    if (!this.activePlan) return;

    // 如果用户修改了提纲，更新计划
    if (updatedOutline) {
      this.activePlan.outline = updatedOutline;
      this.activePlan.title = updatedOutline.title;
      this.activePlan.goal = updatedOutline.goal;
    }

    this.activePlan.status = 'approved';
    this.activePlan.approvedAt = Date.now();

    this.emitEvent({ type: 'plan_approved', plan: this.activePlan });
  }

  /**
   * 取消计划
   */
  cancelPlan(): void {
    if (this.activePlan) {
      this.activePlan.status = 'cancelled';
    }
    this.activePlan = null;
    this.mode = 'chat';
    this.phase = 'PLAN_COLLECT';

    this.emitEvent({ type: 'plan_cancelled' });
  }

  /**
   * 更新计划步骤状态
   * @param stepId - 步骤ID
   * @param status - 新状态
   * @param result - 步骤执行结果
   */
  updateStep(stepId: string, status: PlanStep['status'], result?: string): void {
    if (!this.activePlan) return;

    const step = this.activePlan.outline.structure.find((s) => s.id === stepId);
    if (!step) return;

    step.status = status;
    if (result) {
      step.result = result;
    }

    this.emitEvent({ type: 'step_updated', step });

    // 检查是否所有步骤都已完成
    if (this.activePlan.outline.structure.every((s) => s.status === 'completed')) {
      this.activePlan.status = 'completed';
      this.emitEvent({ type: 'execution_completed' });
    }
  }

  /**
   * 开始执行计划。
   * 由 runtime 在检测到 activePlan.status === 'approved' 且 mode === 'execute' 时调用。
   * 将状态从 approved 切换为 executing，并发出 phase_change 和 execution_started 事件。
   */
  startExecution(): void {
    if (!this.activePlan || this.activePlan.status !== 'approved') {
      return;
    }

    const from = this.phase;
    this.activePlan.status = 'executing';
    this.mode = 'execute';
    this.phase = 'EXECUTE_DRAFT';

    this.emitEvent({ type: 'phase_change', from, to: 'EXECUTE_DRAFT' });
    this.emitEvent({ type: 'execution_started' });
  }

  /**
   * 检查阶段转换是否合法
 * @param from - 当前阶段
 * @param to - 目标阶段
 * @returns 是否合法
 */
  private isValidTransition(from: PlanPhase, to: PlanPhase): boolean {
    const validTransitions: Record<PlanPhase, PlanPhase[]> = {
      PLAN_COLLECT: ['PLAN_RESEARCH', 'PLAN_DRAFT'],
      PLAN_RESEARCH: ['PLAN_COLLECT', 'PLAN_DRAFT'],
      PLAN_DRAFT: ['PLAN_REVIEW', 'PLAN_COLLECT'],
      PLAN_REVIEW: ['EXECUTE_DRAFT', 'PLAN_DRAFT', 'PLAN_COLLECT'],
      EXECUTE_DRAFT: ['EXECUTE_EXPORT', 'PLAN_REVIEW'],
      EXECUTE_EXPORT: ['PLAN_REVIEW'],
    };

    return validTransitions[from]?.includes(to) ?? false;
  }

  /**
   * 发射事件到所有已注册的监听器。
   * @param event - 事件对象
   */
  private emitEvent(event: PlanControllerEvent): void {
    for (const cb of this.callbacks) {
      cb(event);
    }
  }
}
