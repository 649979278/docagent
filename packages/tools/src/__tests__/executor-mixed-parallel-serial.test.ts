/**
 * 混合只读+写入工具编排测试
 * 验证：
 * 1. 只读工具并发 + 写入工具串行的混合编排
 * 2. 结果按原始调用顺序合并
 * 3. 只读工具先执行，写入工具后执行
 * 4. 部分只读失败不影响写入工具执行
 * 5. 部分写入失败不影响其他工具结果
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolExecutor } from '../executor.js';
import { ToolRegistry } from '../base.js';
import type { AgentTool } from '../base.js';
import { PermissionBroker } from '../permission.js';
import type { ToolCall, ToolSafety, ToolMode, PermissionDecision, ToolContext } from '@workagent/shared';

// ============================================================
// Mock 工具
// ============================================================

/** 创建带延迟的只读工具 */
function createDelayedReadOnlyTool(name: string, delay: number): AgentTool {
  return {
    name,
    description: `Read ${name}`,
    inputSchema: { type: 'object' },
    safety: 'read_only' as ToolSafety,
    mode: 'both' as ToolMode,
    isReadOnly: () => true,
    checkPermission: (): PermissionDecision => ({ allowed: true, reason: '测试' }),
    call: async () => {
      await new Promise(resolve => setTimeout(resolve, delay));
      return `读取结果: ${name}`;
    },
    renderSummary: () => `摘要: ${name}`,
  };
}

/** 创建带延迟的写入工具 */
function createDelayedWriteTool(name: string, delay: number): AgentTool {
  return {
    name,
    description: `Write ${name}`,
    inputSchema: { type: 'object' },
    safety: 'write_output' as ToolSafety,
    mode: 'both' as ToolMode,
    isReadOnly: () => false,
    checkPermission: (): PermissionDecision => ({ allowed: true, reason: '测试' }),
    call: async () => {
      await new Promise(resolve => setTimeout(resolve, delay));
      return `写入结果: ${name}`;
    },
    renderSummary: () => `摘要: ${name}`,
  };
}

/** 创建 mock PermissionBroker */
function createMockPermissionBroker(): PermissionBroker {
  return {
    check: vi.fn().mockResolvedValue({ allowed: true, reason: '测试' }),
    requestPermission: vi.fn(),
  } as unknown as PermissionBroker;
}

/** 创建工具调用 */
function createToolCall(name: string, id?: string): ToolCall {
  return { id: id ?? `call_${name}`, name, arguments: {} };
}

// ============================================================
// 测试
// ============================================================

describe('混合只读+写入工具编排', () => {
  let registry: ToolRegistry;
  let broker: PermissionBroker;

  beforeEach(() => {
    registry = new ToolRegistry();
    broker = createMockPermissionBroker();
  });

  it('只读并发+写入串行的混合编排', async () => {
    // 注册 3 个只读 + 2 个写入
    registry.register(createDelayedReadOnlyTool('read_1', 80));
    registry.register(createDelayedReadOnlyTool('read_2', 80));
    registry.register(createDelayedReadOnlyTool('read_3', 80));
    registry.register(createDelayedWriteTool('write_1', 60));
    registry.register(createDelayedWriteTool('write_2', 60));

    const executor = new ToolExecutor(registry, broker);
    const calls = [
      createToolCall('write_1'),  // 写入，串行
      createToolCall('read_1'),   // 只读，并发
      createToolCall('read_2'),   // 只读，并发
      createToolCall('read_3'),   // 只读，并发
      createToolCall('write_2'),  // 写入，串行
    ];

    const start = Date.now();
    const results = await executor.executeAll(calls, { sessionId: 'test', mode: 'chat', permissions: {} });
    const elapsed = Date.now() - start;

    // 只读并发(80ms) + 写入串行(120ms) = ~200ms，远小于全串行(80*3 + 60*2 = 360ms)
    expect(elapsed).toBeLessThan(350);
    expect(results).toHaveLength(5);
  });

  it('结果按原始调用顺序合并', async () => {
    registry.register(createDelayedReadOnlyTool('alpha', 30));
    registry.register(createDelayedWriteTool('beta', 30));
    registry.register(createDelayedReadOnlyTool('gamma', 30));

    const executor = new ToolExecutor(registry, broker);
    const calls = [
      createToolCall('alpha'),  // 只读
      createToolCall('beta'),   // 写入
      createToolCall('gamma'),  // 只读
    ];

    const results = await executor.executeAll(calls, { sessionId: 'test', mode: 'chat', permissions: {} });

    // 结果顺序与原始调用顺序一致
    expect(results[0].call.name).toBe('alpha');
    expect(results[1].call.name).toBe('beta');
    expect(results[2].call.name).toBe('gamma');
  });

  it('部分只读失败不影响写入工具执行', async () => {
    registry.register(createDelayedReadOnlyTool('good_read', 20));
    const failingRead: AgentTool = {
      name: 'bad_read',
      description: 'Failing read',
      inputSchema: { type: 'object' },
      safety: 'read_only' as ToolSafety,
      mode: 'both' as ToolMode,
      isReadOnly: () => true,
      checkPermission: (): PermissionDecision => ({ allowed: true, reason: '测试' }),
      call: async () => { throw new Error('读取失败'); },
      renderSummary: () => '失败摘要',
    };
    registry.register(failingRead);
    registry.register(createDelayedWriteTool('good_write', 20));

    const executor = new ToolExecutor(registry, broker);
    const calls = [
      createToolCall('good_read'),
      createToolCall('bad_read'),
      createToolCall('good_write'),
    ];

    const results = await executor.executeAll(calls, { sessionId: 'test', mode: 'chat', permissions: {} });

    expect(results).toHaveLength(3);
    expect(results[0].isError).toBe(false);
    expect(results[1].isError).toBe(true);
    expect(results[2].isError).toBe(false);
  });

  it('部分写入失败不影响其他工具结果', async () => {
    registry.register(createDelayedReadOnlyTool('read_1', 20));
    const failingWrite: AgentTool = {
      name: 'bad_write',
      description: 'Failing write',
      inputSchema: { type: 'object' },
      safety: 'write_output' as ToolSafety,
      mode: 'both' as ToolMode,
      isReadOnly: () => false,
      checkPermission: (): PermissionDecision => ({ allowed: true, reason: '测试' }),
      call: async () => { throw new Error('写入失败'); },
      renderSummary: () => '失败摘要',
    };
    registry.register(failingWrite);
    registry.register(createDelayedWriteTool('good_write', 20));

    const executor = new ToolExecutor(registry, broker);
    const calls = [
      createToolCall('read_1'),
      createToolCall('bad_write'),
      createToolCall('good_write'),
    ];

    const results = await executor.executeAll(calls, { sessionId: 'test', mode: 'chat', permissions: {} });

    expect(results).toHaveLength(3);
    expect(results[0].isError).toBe(false);
    expect(results[1].isError).toBe(true);
    expect(results[2].isError).toBe(false);
  });

  it('全是只读工具时走纯并发路径', async () => {
    registry.register(createDelayedReadOnlyTool('r1', 60));
    registry.register(createDelayedReadOnlyTool('r2', 60));
    registry.register(createDelayedReadOnlyTool('r3', 60));

    const executor = new ToolExecutor(registry, broker);
    const calls = [createToolCall('r1'), createToolCall('r2'), createToolCall('r3')];

    const start = Date.now();
    const results = await executor.executeAll(calls, { sessionId: 'test', mode: 'chat', permissions: {} });
    const elapsed = Date.now() - start;

    // 并发：应远小于 180ms
    expect(elapsed).toBeLessThan(160);
    expect(results).toHaveLength(3);
  });

  it('全是写入工具时走纯串行路径', async () => {
    registry.register(createDelayedWriteTool('w1', 50));
    registry.register(createDelayedWriteTool('w2', 50));

    const executor = new ToolExecutor(registry, broker);
    const calls = [createToolCall('w1'), createToolCall('w2')];

    const start = Date.now();
    const results = await executor.executeAll(calls, { sessionId: 'test', mode: 'chat', permissions: {} });
    const elapsed = Date.now() - start;

    // 串行：应接近 100ms
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(results).toHaveLength(2);
  });
});
