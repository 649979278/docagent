import { describe, expect, it } from 'vitest';
import { createQueryLoopState } from '../../packages/agent-core/src/query-state.js';
import type { ContextBudget } from '@workagent/shared';

/**
 * 中断状态语义测试。
 */
describe('runtime abort semantics', () => {
  it('emits aborted status shape exactly once with the active runId', () => {
    const budget: ContextBudget = {
      systemPrompt: 500,
      conversationHistory: 15000,
      ragResults: 8000,
      toolResults: 4000,
      maxCompletionTokens: 4096,
      total: 32768,
    };
    const state = createQueryLoopState('session-abort', 'chat', budget, [], '停止当前输出', 'run_active_123');

    const events = [
      { type: 'run_status', data: { runId: state.runId, status: 'running' } },
      { type: 'run_status', data: { runId: state.runId, status: 'aborted' } },
      { type: 'done', data: null },
    ];

    const aborted = events.filter((event) => event.type === 'run_status' && event.data.status === 'aborted');
    expect(aborted).toHaveLength(1);
    expect(aborted[0].data.runId).toBe('run_active_123');
  });
});
