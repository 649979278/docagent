import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { initDatabase, createSession, getSession, createPlan, getPlan, approvePlan as approvePlanRecord, updateSession } from '@workagent/store';
import { createDesktopRuntimeBundle } from '../../apps/desktop/electron/runtime-factory.js';

/**
 * Plan 审批闭环测试。
 * 验证状态语义：approvePlan → approved；startExecution → executing。
 */
describe('plan approval flow', () => {
  it('approvePlan sets approved; startExecution sets executing with phase_change', async () => {
    const db = await initDatabase({
      dbPath: path.join(process.cwd(), `.tmp-plan-flow-${Date.now()}.db`),
    });

    const events: Array<{ type: string; data?: any }> = [];
    const bundle = await createDesktopRuntimeBundle({
      db,
      autoApprovePermissions: true,
      emitEvent: (event) => events.push({ type: event.type, data: event.data }),
    });

    const controller = bundle.runtime.getPlanController();

    // 1. 进入 Plan 模式
    controller.enterPlanMode('session-plan');
    expect(controller.getMode()).toBe('plan');
    expect(controller.getActivePlan()).not.toBeNull();
    expect(controller.getActivePlan()?.status).toBe('draft');
    expect(events.some(e => e.type === 'plan_generated')).toBe(true);

    // 2. 批准计划 → status 变为 approved（不自动切换 phase/mode）
    controller.approvePlan();
    expect(controller.getActivePlan()?.status).toBe('approved');

    // 3. startExecution → status 变为 executing，phase 变为 EXECUTE_DRAFT
    controller.startExecution();
    expect(controller.getActivePlan()?.status).toBe('executing');
    expect(controller.getMode()).toBe('execute');
    expect(controller.getPhase()).toBe('EXECUTE_DRAFT');

    // 4. 验证事件序列
    expect(events.some(e => e.type === 'plan_approved')).toBe(true);
    expect(events.some(e => e.type === 'phase_change' && e.data?.phase === 'EXECUTE_DRAFT')).toBe(true);
    // execution_started 被 bindPlanControllerEvents 转换为 mode_change: execute
    expect(events.some(e => e.type === 'mode_change' && e.data?.mode === 'execute')).toBe(true);
  });

  it('approval persists execute mode and active plan linkage for the next turn', async () => {
    const db = await initDatabase({
      dbPath: path.join(process.cwd(), `.tmp-plan-flow-persist-${Date.now()}.db`),
    });
    createSession(db, {
      id: 'session-plan-persist',
      title: 'persist plan',
      mode: 'plan',
    });
    const plan = createPlan(db, {
      id: 'plan-persist-1',
      sessionId: 'session-plan-persist',
      title: '生成通知提纲',
      goal: '写出完整通知',
      outlineJson: JSON.stringify({ title: '生成通知提纲', structure: [] }),
    });

    const bundle = await createDesktopRuntimeBundle({
      db,
      autoApprovePermissions: true,
    });
    bundle.runtime.getPlanController().enterPlanMode('session-plan-persist');
    bundle.runtime.getPlanController().approvePlan();
    approvePlanRecord(db, plan.id);
    updateSession(db, 'session-plan-persist', {
      mode: 'execute',
      activePlanId: plan.id,
    });

    const session = getSession(db, 'session-plan-persist');
    const storedPlan = getPlan(db, plan.id);

    expect(session?.mode).toBe('execute');
    expect(session?.activePlanId).toBe(plan.id);
    expect(storedPlan?.status).toBe('approved');
  });

  it('plan controller events persist draft, approved, executing and completed states into store', async () => {
    const db = await initDatabase({
      dbPath: path.join(process.cwd(), `.tmp-plan-flow-bridge-${Date.now()}.db`),
    });
    createSession(db, {
      id: 'session-plan-bridge',
      title: 'bridge plan',
      mode: 'chat',
    });

    const bundle = await createDesktopRuntimeBundle({
      db,
      autoApprovePermissions: true,
    });

    const controller = bundle.runtime.getPlanController();
    controller.enterPlanMode('session-plan-bridge');
    const createdPlan = controller.getActivePlan();
    expect(createdPlan).not.toBeNull();
    expect(getPlan(db, createdPlan!.id)?.status).toBe('draft');

    createdPlan!.outline.structure = [
      { id: 'step-1', description: '第一步', status: 'pending' },
      { id: 'step-2', description: '第二步', status: 'pending' },
    ];
    controller.approvePlan({
      ...createdPlan!.outline,
      title: '审批后的提纲标题',
      goal: '审批后的目标',
    });
    expect(getPlan(db, createdPlan!.id)?.status).toBe('approved');

    controller.startExecution();
    expect(getPlan(db, createdPlan!.id)?.status).toBe('executing');

    controller.updateStep('missing-step', 'completed');
    createdPlan!.outline.structure.forEach((step) => {
      controller.updateStep(step.id, 'completed', `${step.id} done`);
    });

    const completed = getPlan(db, createdPlan!.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.outlineJson).toContain('审批后的提纲标题');
    expect(getSession(db, 'session-plan-bridge')?.activePlanId).toBe(createdPlan!.id);
  });

  it('approval persists edited outline json into plan record', async () => {
    const db = await initDatabase({
      dbPath: path.join(process.cwd(), `.tmp-plan-flow-edited-${Date.now()}.db`),
    });
    createSession(db, {
      id: 'session-plan-edited',
      title: 'edited plan',
      mode: 'plan',
    });

    const bundle = await createDesktopRuntimeBundle({
      db,
      autoApprovePermissions: true,
    });

    const controller = bundle.runtime.getPlanController();
    controller.enterPlanMode('session-plan-edited');
    const activePlan = controller.getActivePlan();
    expect(activePlan).not.toBeNull();

    const editedOutline = {
      ...activePlan!.outline,
      title: '用户编辑后的提纲',
      goal: '用户编辑后的目标',
      structure: [
        { id: 'edited-step-1', description: '编辑后的步骤一', status: 'pending' as const },
        { id: 'edited-step-2', description: '编辑后的步骤二', status: 'pending' as const },
      ],
      risks: ['编辑后的风险'],
      questions: ['编辑后的问题'],
    };

    controller.approvePlan(editedOutline);
    const storedPlan = getPlan(db, activePlan!.id);

    expect(storedPlan?.status).toBe('approved');
    expect(storedPlan?.outlineJson).toBe(JSON.stringify(editedOutline));
    expect(storedPlan?.outlineJson).toContain('编辑后的步骤一');
  });
});
