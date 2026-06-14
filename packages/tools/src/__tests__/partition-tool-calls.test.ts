/**
 * partitionToolCalls 分区测试
 * 验证：
 * 1. 只读工具正确分入 readOnlyCalls
 * 2. 写入工具正确分入 writeCalls
 * 3. 未注册工具归入 writeCalls（保守策略）
 * 4. 空列表返回空分区
 * 5. 混合工具正确分区
 */

import { describe, it, expect } from 'vitest';
import { partitionToolCalls } from '../executor.js';
import { ToolRegistry } from '../base.js';
import type { AgentTool } from '../base.js';
import type { ToolCall, ToolSafety, ToolMode, PermissionDecision, ToolContext } from '@workagent/shared';

// ============================================================
// Mock 工具
// ============================================================

/** 创建 mock 工具 */
function createMockTool(
  name: string,
  isReadOnlyFlag: boolean,
): AgentTool {
  return {
    name,
    description: `Mock ${name}`,
    inputSchema: { type: 'object' },
    safety: (isReadOnlyFlag ? 'read_only' : 'write_output') as ToolSafety,
    mode: 'both' as ToolMode,
    isReadOnly: () => isReadOnlyFlag,
    checkPermission: (_input: unknown, _context: ToolContext): PermissionDecision => ({
      allowed: true,
      reason: '测试',
    }),
    call: async () => `结果: ${name}`,
    renderSummary: () => `摘要: ${name}`,
  };
}

/** 创建 mock 工具调用 */
function createToolCall(name: string, id?: string): ToolCall {
  return { id: id ?? `call_${name}`, name, arguments: {} };
}

// ============================================================
// 测试
// ============================================================

describe('partitionToolCalls', () => {
  it('只读工具分入 readOnlyCalls', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool('file_list', true));
    registry.register(createMockTool('rag_search', true));

    const calls = [createToolCall('file_list'), createToolCall('rag_search')];
    const result = partitionToolCalls(calls, registry);

    expect(result.readOnlyCalls).toHaveLength(2);
    expect(result.writeCalls).toHaveLength(0);
    expect(result.readOnlyCalls.map(c => c.name)).toEqual(['file_list', 'rag_search']);
  });

  it('写入工具分入 writeCalls', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool('doc_write', false));
    registry.register(createMockTool('doc_overwrite', false));

    const calls = [createToolCall('doc_write'), createToolCall('doc_overwrite')];
    const result = partitionToolCalls(calls, registry);

    expect(result.readOnlyCalls).toHaveLength(0);
    expect(result.writeCalls).toHaveLength(2);
    expect(result.writeCalls.map(c => c.name)).toEqual(['doc_write', 'doc_overwrite']);
  });

  it('未注册工具归入 writeCalls（保守策略）', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool('file_list', true));

    const calls = [createToolCall('file_list'), createToolCall('unknown_tool')];
    const result = partitionToolCalls(calls, registry);

    expect(result.readOnlyCalls).toHaveLength(1);
    expect(result.readOnlyCalls[0].name).toBe('file_list');
    expect(result.writeCalls).toHaveLength(1);
    expect(result.writeCalls[0].name).toBe('unknown_tool');
  });

  it('空列表返回空分区', () => {
    const registry = new ToolRegistry();
    const result = partitionToolCalls([], registry);

    expect(result.readOnlyCalls).toHaveLength(0);
    expect(result.writeCalls).toHaveLength(0);
  });

  it('混合工具正确分区', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool('file_list', true));
    registry.register(createMockTool('rag_search', true));
    registry.register(createMockTool('doc_write', false));
    registry.register(createMockTool('doc_read', true));
    registry.register(createMockTool('doc_overwrite', false));

    const calls = [
      createToolCall('doc_write'),
      createToolCall('file_list'),
      createToolCall('doc_overwrite'),
      createToolCall('rag_search'),
      createToolCall('doc_read'),
    ];
    const result = partitionToolCalls(calls, registry);

    expect(result.readOnlyCalls).toHaveLength(3);
    expect(result.writeCalls).toHaveLength(2);
    expect(result.readOnlyCalls.map(c => c.name)).toEqual(['file_list', 'rag_search', 'doc_read']);
    expect(result.writeCalls.map(c => c.name)).toEqual(['doc_write', 'doc_overwrite']);
  });

  it('分区保持原始调用对象的引用', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool('file_list', true));

    const call = createToolCall('file_list');
    const result = partitionToolCalls([call], registry);

    expect(result.readOnlyCalls[0]).toBe(call);
  });
});
