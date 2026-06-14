/**
 * 压缩后计划摘要恢复测试
 * 验证：
 * 1. 有活跃计划时注入计划摘要
 * 2. 计划摘要包含标题、目标、状态、步骤
 * 3. 无活跃计划时不注入
 * 4. 计划摘要消息角色为 system
 * 5. 计划摘要受预算限制
 */

import { describe, it, expect } from 'vitest';
import { recoverFromCompact } from '../context/compact-recovery.js';
import type { Memory, Plan } from '@workagent/shared';
import type { QueryLoopState } from '../query-state.js';
import { createQueryLoopState } from '../query-state.js';

// ============================================================
// Mock 工具函数
// ============================================================

/** 创建活跃计划 */
function createActivePlan(): Plan {
  return {
    id: 'plan-1',
    sessionId: 'session-1',
    status: 'executing',
    title: '起草关于培训的通知',
    goal: '根据材料起草一份正式通知文档',
    outline: {
      title: '起草关于培训的通知',
      goal: '根据材料起草一份正式通知文档',
      materialBasis: '参考培训方案文档',
      structure: [
        { id: 'step-1', description: '研读参考材料', status: 'completed' },
        { id: 'step-2', description: '生成提纲', status: 'completed' },
        { id: 'step-3', description: '起草正文', status: 'in_progress' },
        { id: 'step-4', description: '校对和导出', status: 'pending' },
      ],
      expectedOutput: '正式通知文档（docx格式）',
      risks: ['需确认培训时间', '需核实参加人员范围'],
      questions: ['是否需要领导签批？'],
      citations: ['chunk-1'],
    },
    createdAt: Date.now(),
  };
}

/** 创建已完成计划 */
function createCompletedPlan(): Plan {
  return {
    id: 'plan-2',
    sessionId: 'session-1',
    status: 'completed',
    title: '已完成的通知',
    goal: '已完成通知起草',
    outline: {
      title: '已完成的通知',
      goal: '已完成通知起草',
      materialBasis: '',
      structure: [
        { id: 'step-1', description: '研读材料', status: 'completed' },
      ],
      expectedOutput: '',
      risks: [],
      questions: [],
      citations: [],
    },
    createdAt: Date.now(),
  };
}

/** 创建测试用状态 */
function createTestState(overrides?: Partial<QueryLoopState>): QueryLoopState {
  const memories: Memory[] = [];
  const base = createQueryLoopState('session-1', 'plan', {
    systemPrompt: 500, conversationHistory: 15000, ragResults: 8000, toolResults: 4000, maxCompletionTokens: 4096, total: 32768,
  }, memories, '请参考文档起草通知');

  return { ...base, ...overrides };
}

// ============================================================
// 测试
// ============================================================

describe('压缩后计划摘要恢复', () => {
  it('有活跃计划时注入计划摘要', async () => {
    const plan = createActivePlan();
    const state = createTestState({ activePlan: plan });

    const result = await recoverFromCompact(state);

    expect(result.planInjected).toBe(true);
    const planMessages = result.state.messages.filter(
      m => m.id.startsWith('recovery-plan-'),
    );
    expect(planMessages.length).toBeGreaterThan(0);
  });

  it('计划摘要包含标题、目标、状态', async () => {
    const plan = createActivePlan();
    const state = createTestState({ activePlan: plan });

    const result = await recoverFromCompact(state);

    const planMessages = result.state.messages.filter(
      m => m.id.startsWith('recovery-plan-'),
    );
    expect(planMessages.length).toBeGreaterThan(0);
    const content = planMessages[0].content;
    expect(content).toContain('起草关于培训的通知');
    expect(content).toContain('根据材料起草一份正式通知文档');
    expect(content).toContain('executing');
  });

  it('计划摘要包含步骤信息', async () => {
    const plan = createActivePlan();
    const state = createTestState({ activePlan: plan });

    const result = await recoverFromCompact(state);

    const planMessages = result.state.messages.filter(
      m => m.id.startsWith('recovery-plan-'),
    );
    if (planMessages.length > 0) {
      const content = planMessages[0].content;
      // 应包含步骤描述
      expect(content).toContain('研读参考材料');
      expect(content).toContain('起草正文');
    }
  });

  it('无活跃计划时不注入', async () => {
    const state = createTestState({ activePlan: null });

    const result = await recoverFromCompact(state);

    expect(result.planInjected).toBe(false);
    const planMessages = result.state.messages.filter(
      m => m.id.startsWith('recovery-plan-'),
    );
    expect(planMessages.length).toBe(0);
  });

  it('计划摘要消息角色为 system', async () => {
    const plan = createActivePlan();
    const state = createTestState({ activePlan: plan });

    const result = await recoverFromCompact(state);

    const planMessages = result.state.messages.filter(
      m => m.id.startsWith('recovery-plan-'),
    );
    if (planMessages.length > 0) {
      expect(planMessages[0].role).toBe('system');
    }
  });

  it('计划摘要受预算限制', async () => {
    const plan = createActivePlan();
    const state = createTestState({ activePlan: plan });

    // 极小预算
    const result = await recoverFromCompact(state, null, {
      fileAttachmentBudget: 5, // 不够注入任何消息
    });

    // 预算不够时可能无法注入
    expect(result.totalRecoveryTokens).toBeLessThanOrEqual(5);
  });

  it('完成状态的计划也会注入摘要', async () => {
    const plan = createCompletedPlan();
    const state = createTestState({ activePlan: plan });

    const result = await recoverFromCompact(state);

    expect(result.planInjected).toBe(true);
  });
});
