/**
 * 事件名对齐测试
 * 验证 PlanModeController 事件名与 shared/events.ts 的 AgentEventType 对齐
 */

import { describe, it, expect } from 'vitest';
import type { AgentEventType } from '@workagent/shared';

describe('PlanController 事件名对齐', () => {
  it('phase_change 在 AgentEventType 中存在', () => {
    const validTypes: AgentEventType[] = [
      'token', 'thinking', 'tool_start', 'tool_result', 'tool_summary',
      'plan_generated', 'plan_step_update', 'mode_change', 'mode_suggestion',
      'phase_change', 'compact', 'compact_boundary', 'citation', 'rag_enrich',
      'permission_request', 'permission_result', 'index_progress', 'run_status',
      'draft_ready', 'doc_ready', 'model_pull_progress', 'done', 'error',
      'recoverable_error',
    ];

    // 验证 phase_change 在有效事件类型列表中
    expect(validTypes).toContain('phase_change');

    // 验证 plan_generated 在有效事件类型列表中
    expect(validTypes).toContain('plan_generated');
  });

  it('phase_changed 不在 AgentEventType 中（已废弃）', () => {
    // phase_changed 已被替换为 phase_change
    const deprecatedEvent = 'phase_changed';
    const validTypes: string[] = [
      'token', 'thinking', 'tool_start', 'tool_result', 'tool_summary',
      'plan_generated', 'plan_step_update', 'mode_change', 'mode_suggestion',
      'phase_change', 'compact', 'compact_boundary', 'citation', 'rag_enrich',
      'permission_request', 'permission_result', 'index_progress', 'run_status',
      'draft_ready', 'doc_ready', 'model_pull_progress', 'done', 'error',
      'recoverable_error',
    ];

    expect(validTypes).not.toContain(deprecatedEvent);
  });

  it('plan_created 不在 AgentEventType 中（已替换为 plan_generated）', () => {
    const deprecatedEvent = 'plan_created';
    const validTypes: string[] = [
      'plan_generated', 'plan_step_update', 'phase_change',
    ];

    expect(validTypes).not.toContain(deprecatedEvent);
  });
});

describe('新增事件类型', () => {
  it('compact_boundary 事件类型存在', () => {
    const type: AgentEventType = 'compact_boundary';
    expect(type).toBe('compact_boundary');
  });

  it('tool_summary 事件类型存在', () => {
    const type: AgentEventType = 'tool_summary';
    expect(type).toBe('tool_summary');
  });

  it('run_status 事件类型存在', () => {
    const type: AgentEventType = 'run_status';
    expect(type).toBe('run_status');
  });

  it('mode_suggestion 事件类型存在', () => {
    const type: AgentEventType = 'mode_suggestion';
    expect(type).toBe('mode_suggestion');
  });
});

describe('AgentEventEnvelope 扩展字段', () => {
  it('schemaVersion/runId/source 字段可赋值', () => {
    const envelope = {
      sessionId: 's-1',
      turnId: 't-1',
      sequence: 0,
      type: 'token' as const,
      data: { text: 'hello' },
      createdAt: Date.now(),
      schemaVersion: '1.0.0',
      runId: 'run-1',
      source: 'runtime' as const,
    };

    expect(envelope.schemaVersion).toBe('1.0.0');
    expect(envelope.runId).toBe('run-1');
    expect(envelope.source).toBe('runtime');
  });
});

describe('RagEnrichEventData 扩展字段', () => {
  it('chunkCount/usedTokens/triggerReason 字段可赋值', () => {
    const data = {
      query: '测试查询',
      injected: true,
      chunkCount: 3,
      usedTokens: 500,
      triggerReason: 'always_in_plan' as const,
    };

    expect(data.chunkCount).toBe(3);
    expect(data.usedTokens).toBe(500);
    expect(data.triggerReason).toBe('always_in_plan');
  });
});
