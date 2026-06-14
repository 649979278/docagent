/**
 * 只读工具并发执行测试
 * 验证：
 * 1. 多个只读工具并发执行（不串行等待）
 * 2. 结果按原始顺序返回
 * 3. 某个只读工具失败不影响其他工具
 * 4. enableConcurrent=false 时回退到串行
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolExecutor, partitionToolCalls } from '../executor.js';
import type { ExecutorConfig } from '../executor.js';
import { ToolRegistry } from '../base.js';
import type { AgentTool, ToolExecutionResult } from '../base.js';
import { PermissionBroker } from '../permission.js';
import type { ToolCall, ToolSafety, ToolMode, PermissionDecision, ToolContext } from '@workagent/shared';

// ============================================================
// Mock 工具
// ============================================================

/** 创建可追踪执行时间的 mock 只读工具 */
function createTrackedReadOnlyTool(
  name: string,
  executionTime: number,
): AgentTool & { executionLog: number[] } {
  const log: number[] = [];
  const tool: AgentTool & { executionLog: number[] } = {
    name,
    description: `Tracked ${name}`,
    inputSchema: { type: 'object' },
    safety: 'read_only' as ToolSafety,
    mode: 'both' as ToolMode,
    isReadOnly: () => true,
    checkPermission: (): PermissionDecision => ({ allowed: true, reason: '测试' }),
    call: async () => {
      log.push(Date.now());
      await new Promise(resolve => setTimeout(resolve, executionTime));
      return `${name} 结果`;
    },
    renderSummary: () => `${name} 摘要`,
    executionLog: log,
  };
  return tool;
}

/** 创建总是失败的只读工具 */
function createFailingReadOnlyTool(name: string): AgentTool {
  return {
    name,
    description: `Failing ${name}`,
    inputSchema: { type: 'object' },
    safety: 'read_only' as ToolSafety,
    mode: 'both' as ToolMode,
    isReadOnly: () => true,
    checkPermission: (): PermissionDecision => ({ allowed: true, reason: '测试' }),
    call: async () => { throw new Error(`${name} 失败`); },
    renderSummary: () => `${name} 摘要`,
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

describe('只读工具并发执行', () => {
  let registry: ToolRegistry;
  let broker: PermissionBroker;

  beforeEach(() => {
    registry = new ToolRegistry();
    broker = createMockPermissionBroker();
  });

  it('3个只读工具并发执行，总耗时远小于串行', async () => {
    const tool1 = createTrackedReadOnlyTool('read_1', 100);
    const tool2 = createTrackedReadOnlyTool('read_2', 100);
    const tool3 = createTrackedReadOnlyTool('read_3', 100);

    registry.register(tool1);
    registry.register(tool2);
    registry.register(tool3);

    const executor = new ToolExecutor(registry, broker);
    const calls = [createToolCall('read_1'), createToolCall('read_2'), createToolCall('read_3')];

    const start = Date.now();
    const results = await executor.executeAll(calls, { sessionId: 'test', mode: 'chat', permissions: {} });
    const elapsed = Date.now() - start;

    // 并发执行：总耗时应远小于 300ms（3 * 100ms）
    expect(elapsed).toBeLessThan(250);
    // 结果数量正确
    expect(results).toHaveLength(3);
    // 结果都不是错误
    expect(results.every(r => !r.isError)).toBe(true);
  });

  it('并发执行结果按原始顺序返回', async () => {
    const tool1 = createTrackedReadOnlyTool('alpha', 50);
    const tool2 = createTrackedReadOnlyTool('beta', 20); // beta 更快但排在后面
    const tool3 = createTrackedReadOnlyTool('gamma', 30);

    registry.register(tool1);
    registry.register(tool2);
    registry.register(tool3);

    const executor = new ToolExecutor(registry, broker);
    const calls = [createToolCall('alpha'), createToolCall('beta'), createToolCall('gamma')];

    const results = await executor.executeAll(calls, { sessionId: 'test', mode: 'chat', permissions: {} });

    // 结果顺序应与调用顺序一致
    expect(results[0].call.name).toBe('alpha');
    expect(results[1].call.name).toBe('beta');
    expect(results[2].call.name).toBe('gamma');
  });

  it('某个只读工具失败不影响其他工具', async () => {
    const tool1 = createTrackedReadOnlyTool('good_1', 50);
    const tool2 = createFailingReadOnlyTool('bad');
    const tool3 = createTrackedReadOnlyTool('good_2', 50);

    registry.register(tool1);
    registry.register(tool2);
    registry.register(tool3);

    const executor = new ToolExecutor(registry, broker);
    const calls = [createToolCall('good_1'), createToolCall('bad'), createToolCall('good_2')];

    const results = await executor.executeAll(calls, { sessionId: 'test', mode: 'chat', permissions: {} });

    expect(results).toHaveLength(3);
    expect(results[0].isError).toBe(false);
    expect(results[1].isError).toBe(true);
    expect(results[2].isError).toBe(false);
  });

  it('enableConcurrent=false 时回退到串行执行', async () => {
    const tool1 = createTrackedReadOnlyTool('read_1', 80);
    const tool2 = createTrackedReadOnlyTool('read_2', 80);

    registry.register(tool1);
    registry.register(tool2);

    const executor = new ToolExecutor(registry, broker, { enableConcurrent: false });
    const calls = [createToolCall('read_1'), createToolCall('read_2')];

    const start = Date.now();
    const results = await executor.executeAll(calls, { sessionId: 'test', mode: 'chat', permissions: {} });
    const elapsed = Date.now() - start;

    // 串行执行：总耗时应接近 160ms
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(results).toHaveLength(2);
  });

  it('空调用列表返回空结果', async () => {
    const executor = new ToolExecutor(registry, broker);
    const results = await executor.executeAll([], { sessionId: 'test', mode: 'chat', permissions: {} });

    expect(results).toHaveLength(0);
  });
});
