import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MockModelProvider } from '@workagent/model-provider';
import { AgentRuntime } from '@workagent/agent-core';
import { initDatabase, createSession, listAgentRunsBySession } from '@workagent/store';
import { ToolExecutor, ToolRegistry, PermissionBroker } from '@workagent/tools';
import { createDesktopRuntimeBundle } from '../../apps/desktop/electron/runtime-factory.js';

/**
 * 事件恢复链路测试。
 */
describe('recovery transcript', () => {
  it('persists transcript jsonl and session summary files for recovery', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workagent-recovery-'));
    const artifactsDir = path.join(tempDir, 'artifacts');
    const db = await initDatabase({
      dbPath: path.join(tempDir, 'recovery.db'),
    });

    createSession(db, {
      id: 'session-recovery',
      title: 'recovery',
    });

    const registry = new ToolRegistry();
    const runtime = new AgentRuntime(
      new MockModelProvider({ delay: 0 }),
      registry,
      new ToolExecutor(registry, new PermissionBroker({
        saveDecision() {},
        loadDecisions() {
          return [];
        },
        removeDecision() {},
      })),
      db,
      {
        transcriptDir: path.join(artifactsDir, 'transcripts'),
        sessionMemoryDir: path.join(artifactsDir, 'session-memory'),
      },
    );

    for (let index = 0; index < 5; index += 1) {
      // 凑满 5 轮，触发会话摘要持久化。
      // eslint-disable-next-line no-empty
      for await (const _event of runtime.runTurn('session-recovery', `第 ${index + 1} 轮，请整理恢复信息`)) {
      }
    }

    const runs = listAgentRunsBySession(db, 'session-recovery');
    expect(runs.length).toBeGreaterThan(0);

    const latestRun = runs[0];
    const transcriptPath = path.join(artifactsDir, 'transcripts', `${latestRun.id}.jsonl`);
    const summaryPath = path.join(artifactsDir, 'session-memory', 'session-recovery.md');

    expect(fs.existsSync(transcriptPath)).toBe(true);
    expect(fs.existsSync(summaryPath)).toBe(true);

    const transcriptContent = fs.readFileSync(transcriptPath, 'utf8');
    const summaryContent = fs.readFileSync(summaryPath, 'utf8');

    expect(transcriptContent).toContain('"type":"run_status"');
    expect(transcriptContent).toContain('"type":"done"');
    expect(summaryContent).toContain('## 会话摘要');
  });

  it('desktop runtime bundle can resume latest session snapshot from transcript artifacts', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workagent-recovery-bundle-'));
    const artifactsDir = path.join(tempDir, 'artifacts');
    const db = await initDatabase({
      dbPath: path.join(tempDir, 'recovery-bundle.db'),
    });
    createSession(db, {
      id: 'session-resume-bundle',
      title: 'resume bundle',
    });

    const registry = new ToolRegistry();
    const runtime = new AgentRuntime(
      new MockModelProvider({ delay: 0 }),
      registry,
      new ToolExecutor(registry, new PermissionBroker({
        saveDecision() {},
        loadDecisions() {
          return [];
        },
        removeDecision() {},
      })),
      db,
      {
        transcriptDir: path.join(artifactsDir, 'transcripts'),
        sessionMemoryDir: path.join(artifactsDir, 'session-memory'),
      },
    );

    for await (const _event of runtime.runTurn('session-resume-bundle', '请生成恢复快照测试内容')) {
      // 等待运行完成并写入 transcript
    }

    const bundle = await createDesktopRuntimeBundle({
      db,
      autoApprovePermissions: true,
      appDataDir: artifactsDir,
    });
    const snapshot = bundle.resumeSession('session-resume-bundle');
    expect(snapshot).not.toBeNull();
    expect(snapshot?.runId).toMatch(/^run_/);
    expect(snapshot?.totalEvents).toBeGreaterThan(0);
    expect(snapshot?.transcriptPath).toContain('transcripts');
  });
});
