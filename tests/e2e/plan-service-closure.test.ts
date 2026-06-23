import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPlan, createSession, getPlan, getSession, initDatabase } from '@workagent/store';
import { MockModelProvider } from '@workagent/model-provider';
import { createDesktopRuntimeBundle } from '../../apps/desktop/electron/runtime-factory.js';

describe('plan service closure', () => {
  it('approves a persisted plan and next execute turn starts execution', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workagent-plan-service-'));
    const db = initDatabase({ dbPath: path.join(tempDir, 'plan.db') });
    createSession(db, { id: 'session-plan-service', title: '计划服务', mode: 'plan' });
    createPlan(db, {
      id: 'plan-service-1',
      sessionId: 'session-plan-service',
      title: '测试提纲',
      goal: '生成测试文档',
      outlineJson: JSON.stringify({
        title: '测试提纲',
        goal: '生成测试文档',
        materialBasis: '',
        structure: [{ id: 'step-1', description: '起草正文', status: 'pending' }],
        expectedOutput: 'docx',
        risks: [],
        questions: [],
        citations: [],
      }),
    });

    const bundle = await createDesktopRuntimeBundle({
      db,
      autoApprovePermissions: true,
      appDataDir: tempDir,
      modelProvider: new MockModelProvider({ delay: 0 }),
    });

    const approval = bundle.planService.approve({
      sessionId: 'session-plan-service',
      planId: 'plan-service-1',
      approved: true,
    });
    expect(approval.approved).toBe(true);
    expect(getSession(db, 'session-plan-service')?.mode).toBe('execute');
    expect(getPlan(db, 'plan-service-1')?.status).toBe('approved');

    for await (const event of bundle.runtime.runTurn('session-plan-service', '继续执行计划', 'execute')) {
      if (event.type === 'run_status' && (event.data as { status?: string }).status === 'started') {
        break;
      }
      if (bundle.runtime.getPlanController().getActivePlan()?.status === 'executing') {
        break;
      }
    }

    expect(bundle.runtime.getPlanController().getActivePlan()?.status).toBe('executing');
    expect(getPlan(db, 'plan-service-1')?.status).toBe('executing');
  });
});
