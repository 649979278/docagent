import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSession, getPlan, initDatabase } from '@workagent/store';
import type { ToolCall, ToolContext } from '@workagent/shared';
import { createDesktopRuntimeBundle } from '../../apps/desktop/electron/runtime-factory.js';

/**
 * 输出闭环测试。
 * 验证文档输出工具执行成功后，计划记录会回写 final_doc_path，
 * 并通过统一事件流暴露 doc_ready 事件。
 */
describe('output closure', () => {
  it('persists final_doc_path and emits doc_ready after doc_overwrite succeeds', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workagent-output-closure-'));
    const db = await initDatabase({
      dbPath: path.join(tempDir, 'output-closure.db'),
    });

    createSession(db, {
      id: 'session-output-closure',
      title: 'output closure',
      mode: 'plan',
    });

    const events: Array<{ type: string; data: unknown }> = [];
    const bundle = await createDesktopRuntimeBundle({
      db,
      autoApprovePermissions: true,
      appDataDir: tempDir,
      emitEvent: (event) => {
        events.push({ type: event.type, data: event.data });
      },
    });

    const controller = bundle.runtime.getPlanController();
    controller.enterPlanMode('session-output-closure');
    const plan = controller.getActivePlan();
    expect(plan).not.toBeNull();

    controller.approvePlan({
      ...plan!.outline,
      title: '输出闭环计划',
      goal: '生成最终文档',
      structure: [],
    });
    controller.startExecution();

    const outputPath = path.join(tempDir, 'final-output.docx');
    const toolCall: ToolCall = {
      id: 'call-doc-overwrite',
      name: 'doc_overwrite',
      arguments: {
        filePath: outputPath,
        content: '# 输出闭环\n\n这是最终文档。',
      },
    };
    const toolContext: ToolContext = {
      sessionId: 'session-output-closure',
      mode: 'execute',
      permissions: {},
    };

    const [result] = await bundle.executor.executeAll([toolCall], toolContext);
    expect(result.isError).toBe(false);
    expect(fs.existsSync(outputPath)).toBe(true);

    const storedPlan = getPlan(db, plan!.id);
    expect(storedPlan?.finalDocPath).toBe(outputPath);
    expect(events.some((event) => event.type === 'doc_ready' && (event.data as { filePath?: string }).filePath === outputPath)).toBe(true);
  });
});
