/**
 * 写入工具串行执行测试
 * 验证：
 * 1. 写入工具严格串行执行（后一个等前一个完成）
 * 2. 写入工具执行顺序与调用顺序一致
 * 3. 某个写入工具失败不影响后续写入工具
 * 4. 单个写入工具正常执行
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

/** 创建可追踪执行顺序的写入工具 */
function createTrackedWriteTool(
  name: string,
  executionTime: number,
): AgentTool & { executionOrder: number[]; orderCounter: number } {
  let orderCounter = 0;
  const tool: AgentTool & { executionOrder: number[]; orderCounter: number } = {
    name,
    description: `Tracked Write ${name}`,
    inputSchema: { type: 'object' },
    safety: 'write_output' as ToolSafety,
    mode: 'both' as ToolMode,
    isReadOnly: () => false,
    checkPermission: (): PermissionDecision => ({ allowed: true, reason: '测试' }),
    call: async () => {
      orderCounter++;
      tool.executionOrder.push(orderCounter);
      await new Promise(resolve => setTimeout(resolve, executionTime));
      return `${name} 写入结果`;
    },
    renderSummary: () => `${name} 摘要`,
    executionOrder: [],
    orderCounter: 0,
  };
  return tool;
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

describe('写入工具串行执行', () => {
  let registry: ToolRegistry;
  let broker: PermissionBroker;

  beforeEach(() => {
    registry = new ToolRegistry();
    broker = createMockPermissionBroker();
  });

  it('写入工具严格串行执行（后一个等前一个完成）', async () => {
    const tool1 = createTrackedWriteTool('write_1', 80);
    const tool2 = createTrackedWriteTool('write_2', 80);

    registry.register(tool1);
    registry.register(tool2);

    const executor = new ToolExecutor(registry, broker);
    const calls = [createToolCall('write_1'), createToolCall('write_2')];

    const start = Date.now();
    const results = await executor.executeAll(calls, { sessionId: 'test', mode: 'chat', permissions: {} });
    const elapsed = Date.now() - start;

    // 串行执行：总耗时应接近 160ms
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(results).toHaveLength(2);
  });

  it('写入工具执行顺序与调用顺序一致', async () => {
    const tool1 = createTrackedWriteTool('write_a', 30);
    const tool2 = createTrackedWriteTool('write_b', 30);
    const tool3 = createTrackedWriteTool('write_c', 30);

    registry.register(tool1);
    registry.register(tool2);
    registry.register(tool3);

    const executor = new ToolExecutor(registry, broker);
    const calls = [createToolCall('write_a'), createToolCall('write_b'), createToolCall('write_c')];

    const results = await executor.executeAll(calls, { sessionId: 'test', mode: 'chat', permissions: {} });

    expect(results[0].call.name).toBe('write_a');
    expect(results[1].call.name).toBe('write_b');
    expect(results[2].call.name).toBe('write_c');
  });

  it('某个写入工具失败不影响后续写入工具', async () => {
    const tool1 = createTrackedWriteTool('good_write', 30);
    const tool2: AgentTool = {
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
    const tool3 = createTrackedWriteTool('good_write_2', 30);

    registry.register(tool1);
    registry.register(tool2);
    registry.register(tool3);

    const executor = new ToolExecutor(registry, broker);
    const calls = [createToolCall('good_write'), createToolCall('bad_write'), createToolCall('good_write_2')];

    const results = await executor.executeAll(calls, { sessionId: 'test', mode: 'chat', permissions: {} });

    expect(results).toHaveLength(3);
    expect(results[0].isError).toBe(false);
    expect(results[1].isError).toBe(true);
    expect(results[2].isError).toBe(false);
  });

  it('单个写入工具正常执行', async () => {
    const tool = createTrackedWriteTool('single_write', 30);
    registry.register(tool);

    const executor = new ToolExecutor(registry, broker);
    const results = await executor.executeAll(
      [createToolCall('single_write')],
      { sessionId: 'test', mode: 'chat', permissions: {} },
    );

    expect(results).toHaveLength(1);
    expect(results[0].isError).toBe(false);
  });
});
