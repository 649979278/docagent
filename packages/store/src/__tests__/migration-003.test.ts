/**
 * Migration 003 测试 - 验证新表创建和增量扩展
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase } from '../database.js';
import type { Database } from '../database.js';
import {
  createWorkspace, getWorkspace, listWorkspaces, updateWorkspace, deleteWorkspace,
  bindSessionToWorkspace, unbindSessionFromWorkspace, getWorkspaceSessionIds, getSessionWorkspaceIds,
} from '../workspaces.js';
import {
  createAgentRun, getAgentRun, updateAgentRun, listAgentRunsBySession, listActiveAgentRuns, endAgentRun,
} from '../agent-runs.js';
import {
  createAgentEvent, createAgentEventsBatch, listAgentEventsByRun, getLatestAgentEvent, getLatestSequence,
} from '../agent-events.js';
import { createSession } from '../sessions.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

let db: Database;
let tmpDbPath: string;

beforeAll(async () => {
  // 使用临时文件避免与真实数据库冲突
  tmpDbPath = path.join(os.tmpdir(), `workagent-test-${Date.now()}.db`);
  db = await initDatabase({ dbPath: tmpDbPath, log: () => {} });
});

afterAll(() => {
  closeDatabase(db);
  // 清理临时数据库文件
  try { fs.unlinkSync(tmpDbPath); } catch { /* ignore */ }
});

describe('Migration 003 - 新表创建', () => {
  it('workspaces 表可正常 CRUD', () => {
    const ws = createWorkspace(db, { id: 'ws-1', name: '测试工作区', rootPath: '/tmp/test' });
    expect(ws.id).toBe('ws-1');
    expect(ws.name).toBe('测试工作区');
    expect(ws.rootPath).toBe('/tmp/test');

    const loaded = getWorkspace(db, 'ws-1');
    expect(loaded).toBeDefined();
    expect(loaded!.name).toBe('测试工作区');
  });

  it('workspaces 列表查询正确', () => {
    createWorkspace(db, { id: 'ws-2', name: '第二个工作区', rootPath: '/tmp/test2' });
    const list = listWorkspaces(db);
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('workspaces 更新正确', () => {
    updateWorkspace(db, 'ws-1', { name: '更新后名称' });
    const loaded = getWorkspace(db, 'ws-1');
    expect(loaded!.name).toBe('更新后名称');
  });

  it('workspaces 删除正确（级联删除关联）', () => {
    createWorkspace(db, { id: 'ws-del', name: '待删除', rootPath: '/tmp/del' });
    deleteWorkspace(db, 'ws-del');
    expect(getWorkspace(db, 'ws-del')).toBeUndefined();
  });
});

describe('Workspace-Session 关联', () => {
  it('绑定和解绑正确', () => {
    createSession(db, { id: 'sess-ws-test', title: '关联测试' });
    bindSessionToWorkspace(db, 'sess-ws-test', 'ws-1');

    const sessionIds = getWorkspaceSessionIds(db, 'ws-1');
    expect(sessionIds).toContain('sess-ws-test');

    const workspaceIds = getSessionWorkspaceIds(db, 'sess-ws-test');
    expect(workspaceIds).toContain('ws-1');

    unbindSessionFromWorkspace(db, 'sess-ws-test', 'ws-1');
    expect(getWorkspaceSessionIds(db, 'ws-1')).not.toContain('sess-ws-test');
  });

  it('重复绑定不报错', () => {
    bindSessionToWorkspace(db, 'sess-ws-test', 'ws-1');
    bindSessionToWorkspace(db, 'sess-ws-test', 'ws-1');
    // 不应抛出异常
    const sessionIds = getWorkspaceSessionIds(db, 'ws-1');
    expect(sessionIds).toContain('sess-ws-test');
  });
});

describe('AgentRuns CRUD', () => {
  it('创建和获取 run', () => {
    const run = createAgentRun(db, { id: 'run-1', sessionId: 'sess-ws-test', mode: 'chat' });
    expect(run.id).toBe('run-1');
    expect(run.sessionId).toBe('sess-ws-test');
    expect(run.mode).toBe('chat');
    expect(run.status).toBe('running');
  });

  it('更新 run', () => {
    updateAgentRun(db, 'run-1', { status: 'completed', totalTokens: 1000 });
    const loaded = getAgentRun(db, 'run-1');
    expect(loaded!.status).toBe('completed');
    expect(loaded!.totalTokens).toBe(1000);
  });

  it('按 session 列出 runs', () => {
    const runs = listAgentRunsBySession(db, 'sess-ws-test');
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });

  it('列出活跃 runs', () => {
    createAgentRun(db, { id: 'run-active', sessionId: 'sess-ws-test', mode: 'plan' });
    const active = listActiveAgentRuns(db);
    expect(active.some(r => r.id === 'run-active')).toBe(true);
  });

  it('endAgentRun 设置终止原因', () => {
    createAgentRun(db, { id: 'run-end', sessionId: 'sess-ws-test', mode: 'chat' });
    endAgentRun(db, 'run-end', 'completed', 'max_turns', 500);
    const loaded = getAgentRun(db, 'run-end');
    expect(loaded!.status).toBe('completed');
    expect(loaded!.terminalReason).toBe('max_turns');
    expect(loaded!.totalTokens).toBe(500);
    expect(loaded!.endedAt).toBeDefined();
  });

  it('diagnosticsJson 可写入', () => {
    const diagnostics = { historyTokens: 100, ragTokens: 50, hadToolCall: true };
    updateAgentRun(db, 'run-1', { diagnosticsJson: JSON.stringify(diagnostics) });
    const loaded = getAgentRun(db, 'run-1');
    expect(loaded!.diagnosticsJson).toBeDefined();
    const parsed = JSON.parse(loaded!.diagnosticsJson!);
    expect(parsed.historyTokens).toBe(100);
  });
});

describe('AgentEvents CRUD', () => {
  it('创建单条事件', () => {
    createAgentRun(db, { id: 'run-ev', sessionId: 'sess-ws-test', mode: 'chat' });
    const id = createAgentEvent(db, {
      runId: 'run-ev',
      sequence: 1,
      type: 'token',
      data: JSON.stringify({ text: 'hello' }),
    });
    expect(id).toBeGreaterThan(0);
  });

  it('批量创建事件', () => {
    createAgentEventsBatch(db, [
      { runId: 'run-ev', sequence: 2, type: 'token', data: JSON.stringify({ text: 'world' }) },
      { runId: 'run-ev', sequence: 3, type: 'tool_start', data: JSON.stringify({ name: 'file_list' }), toolName: 'file_list' },
    ]);

    const events = listAgentEventsByRun(db, 'run-ev');
    expect(events.length).toBe(3);
  });

  it('事件按 sequence 排序', () => {
    const events = listAgentEventsByRun(db, 'run-ev');
    expect(events[0].sequence).toBe(1);
    expect(events[1].sequence).toBe(2);
    expect(events[2].sequence).toBe(3);
  });

  it('获取最新事件', () => {
    const latest = getLatestAgentEvent(db, 'run-ev');
    expect(latest).toBeDefined();
    expect(latest!.sequence).toBe(3);
  });

  it('获取最新 sequence', () => {
    const seq = getLatestSequence(db, 'run-ev');
    expect(seq).toBe(3);
  });

  it('获取不存在 run 的事件返回空', () => {
    const events = listAgentEventsByRun(db, 'nonexistent-run');
    expect(events).toEqual([]);
  });

  it('获取不存在 run 的最新 sequence 返回 0', () => {
    const seq = getLatestSequence(db, 'nonexistent-run');
    expect(seq).toBe(0);
  });
});
