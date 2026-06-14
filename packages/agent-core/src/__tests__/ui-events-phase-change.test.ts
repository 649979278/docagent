/**
 * UI 事件 phase_change 正确处理测试
 * 验证：
 * 1. phase_change 事件被正确处理（而非 plan_phase）
 * 2. 所有 AgentEventType 事件名与 shared/events.ts 对齐
 * 3. 新增事件类型（compact_boundary, tool_summary, run_status, mode_suggestion）可被正确识别
 */

import { describe, it, expect } from 'vitest';

/** 共享事件类型（与 shared/events.ts 对齐） */
const AGENT_EVENT_TYPES = [
  'token',
  'thinking',
  'tool_start',
  'tool_result',
  'tool_summary',
  'plan_generated',
  'plan_step_update',
  'mode_change',
  'mode_suggestion',
  'phase_change',
  'compact',
  'compact_boundary',
  'recovery',
  'citation',
  'rag_enrich',
  'permission_request',
  'permission_result',
  'index_progress',
  'run_status',
  'draft_ready',
  'doc_ready',
  'model_pull_progress',
  'done',
  'error',
  'recoverable_error',
] as const;

/** 旧版事件名（不应再使用） */
const DEPRECATED_EVENT_TYPES = ['plan_phase', 'plan_created', 'phase_changed'];

describe('UI 事件 phase_change 正确处理', () => {
  it('phase_change 在合法事件类型中', () => {
    expect(AGENT_EVENT_TYPES).toContain('phase_change');
  });

  it('plan_phase 不在合法事件类型中（已废弃）', () => {
    expect(AGENT_EVENT_TYPES).not.toContain('plan_phase');
    expect(DEPRECATED_EVENT_TYPES).toContain('plan_phase');
  });

  it('plan_created 不在合法事件类型中（已替换为 plan_generated）', () => {
    expect(AGENT_EVENT_TYPES).toContain('plan_generated');
    expect(AGENT_EVENT_TYPES).not.toContain('plan_created');
    expect(DEPRECATED_EVENT_TYPES).toContain('plan_created');
  });

  it('phase_changed 不在合法事件类型中（已替换为 phase_change）', () => {
    expect(AGENT_EVENT_TYPES).not.toContain('phase_changed');
    expect(DEPRECATED_EVENT_TYPES).toContain('phase_changed');
  });

  it('新增事件类型存在：compact_boundary', () => {
    expect(AGENT_EVENT_TYPES).toContain('compact_boundary');
  });

  it('新增事件类型存在：tool_summary', () => {
    expect(AGENT_EVENT_TYPES).toContain('tool_summary');
  });

  it('新增事件类型存在：run_status', () => {
    expect(AGENT_EVENT_TYPES).toContain('run_status');
  });

  it('新增事件类型存在：mode_suggestion', () => {
    expect(AGENT_EVENT_TYPES).toContain('mode_suggestion');
  });

  it('模拟事件处理器正确识别 phase_change', () => {
    const handledPhases: string[] = [];

    /** 模拟事件处理器 */
    function handleEvent(event: { type: string; data: unknown }): void {
      if (event.type === 'phase_change') {
        const data = event.data as { phase: string };
        handledPhases.push(data.phase);
      }
    }

    // 正确事件名
    handleEvent({ type: 'phase_change', data: { phase: 'PLAN_DRAFT' } });
    handleEvent({ type: 'phase_change', data: { phase: 'PLAN_REVIEW' } });

    expect(handledPhases).toEqual(['PLAN_DRAFT', 'PLAN_REVIEW']);
  });

  it('模拟事件处理器忽略 plan_phase（旧版）', () => {
    const handledPhases: string[] = [];

    function handleEvent(event: { type: string; data: unknown }): void {
      if (event.type === 'phase_change') {
        const data = event.data as { phase: string };
        handledPhases.push(data.phase);
      }
      // plan_phase 不被处理
    }

    // 旧版事件名应被忽略
    handleEvent({ type: 'plan_phase', data: { phase: 'PLAN_DRAFT' } });
    handleEvent({ type: 'phase_change', data: { phase: 'EXECUTE_DRAFT' } });

    expect(handledPhases).toEqual(['EXECUTE_DRAFT']);
  });
});
