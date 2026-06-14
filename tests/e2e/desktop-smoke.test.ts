import { describe, expect, it } from 'vitest';
import { useRunStore } from '../../apps/desktop/src/stores/run-store.js';
import { useKnowledgeStore } from '../../apps/desktop/src/stores/knowledge-store.js';

/**
 * 桌面工作台 smoke 测试。
 */
describe('desktop smoke', () => {
  it('tracks knowledge progress, plan approval state, and runtime status in stores', () => {
    useRunStore.getState().setPlanPhase('PLAN_REVIEW');
    useRunStore.getState().setDiagnostics({
      runStatus: 'running',
      activePlanId: 'plan-1',
      modeSuggestion: {
        suggestedMode: 'plan',
        reason: 'complex task',
      },
    });
    useKnowledgeStore.getState().updateIndexJob('job-1', {
      documentId: 'doc-1',
      status: 'embedding',
      progress: 50,
      error: null,
    });

    expect(useRunStore.getState().planPhase).toBe('PLAN_REVIEW');
    expect(useRunStore.getState().diagnostics.activePlanId).toBe('plan-1');
    expect(useRunStore.getState().diagnostics.runStatus).toBe('running');
    expect(useKnowledgeStore.getState().indexJobs).toHaveLength(1);
  });
});
