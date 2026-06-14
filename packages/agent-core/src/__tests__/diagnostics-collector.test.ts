/**
 * DiagnosticsCollector 测试
 * 验证：
 * 1. 初始状态所有字段为零值/空值
 * 2. recordSection 记录触发的 prompt section
 * 3. recordTokenUsage 累积 token 使用
 * 4. recordToolCall 记录工具调用和解析失败
 * 5. recordCompact 记录压缩
 * 6. recordTerminal 记录终止原因
 * 7. recordPlanTransition 记录计划转换
 * 8. recordRag 记录 RAG 注入
 * 9. getData 返回不可变副本
 * 10. reset 重置所有字段
 */

import { describe, it, expect } from 'vitest';
import { DiagnosticsCollector } from '../diagnostics.js';

// ============================================================
// 测试
// ============================================================

describe('DiagnosticsCollector', () => {
  it('初始状态所有字段为零值/空值', () => {
    const collector = new DiagnosticsCollector();
    const data = collector.getData();

    expect(data.triggeredSections).toEqual([]);
    expect(data.historyTokens).toBe(0);
    expect(data.ragTokens).toBe(0);
    expect(data.toolTokens).toBe(0);
    expect(data.completionTokens).toBe(0);
    expect(data.hadToolCall).toBe(false);
    expect(data.toolParseFailed).toBe(false);
    expect(data.compactOccurred).toBe(false);
    expect(data.compactFreedTokens).toBe(0);
    expect(data.terminalReason).toBeNull();
    expect(data.planTransition).toBeNull();
    expect(data.ragHitCount).toBe(0);
    expect(data.ragInjectedTokens).toBe(0);
  });

  it('recordSection 记录触发的 prompt section', () => {
    const collector = new DiagnosticsCollector();

    collector.recordSection('role');
    collector.recordSection('mode');
    collector.recordSection('role'); // 重复不添加

    const data = collector.getData();
    expect(data.triggeredSections).toEqual(['role', 'mode']);
  });

  it('recordTokenUsage 累积 token 使用', () => {
    const collector = new DiagnosticsCollector();

    collector.recordTokenUsage(100, 50, 30, 200);
    collector.recordTokenUsage(200, 0, 0, 100);

    const data = collector.getData();
    expect(data.historyTokens).toBe(300);
    expect(data.ragTokens).toBe(50);
    expect(data.toolTokens).toBe(30);
    expect(data.completionTokens).toBe(300);
  });

  it('recordToolCall 记录工具调用和解析失败', () => {
    const collector = new DiagnosticsCollector();

    collector.recordToolCall(true, false);
    const data1 = collector.getData();
    expect(data1.hadToolCall).toBe(true);
    expect(data1.toolParseFailed).toBe(false);

    collector.recordToolCall(false, true);
    const data2 = collector.getData();
    expect(data2.hadToolCall).toBe(true); // 一旦为 true 保持
    expect(data2.toolParseFailed).toBe(true);
  });

  it('recordCompact 记录压缩', () => {
    const collector = new DiagnosticsCollector();

    collector.recordCompact(true, 5000);
    const data1 = collector.getData();
    expect(data1.compactOccurred).toBe(true);
    expect(data1.compactFreedTokens).toBe(5000);

    collector.recordCompact(true, 3000);
    const data2 = collector.getData();
    expect(data2.compactFreedTokens).toBe(8000); // 累积

    collector.recordCompact(false, 0);
    const data3 = collector.getData();
    expect(data3.compactOccurred).toBe(true); // 仍为 true
  });

  it('recordTerminal 记录终止原因', () => {
    const collector = new DiagnosticsCollector();

    collector.recordTerminal('completed');

    const data = collector.getData();
    expect(data.terminalReason).toBe('completed');
  });

  it('recordPlanTransition 记录计划转换', () => {
    const collector = new DiagnosticsCollector();

    collector.recordPlanTransition('PLAN_DRAFT → PLAN_REVIEW');

    const data = collector.getData();
    expect(data.planTransition).toBe('PLAN_DRAFT → PLAN_REVIEW');
  });

  it('recordRag 记录 RAG 注入', () => {
    const collector = new DiagnosticsCollector();

    collector.recordRag(5, 2000);
    collector.recordRag(3, 1000);

    const data = collector.getData();
    expect(data.ragHitCount).toBe(8);
    expect(data.ragInjectedTokens).toBe(3000);
  });

  it('getData 返回不可变副本', () => {
    const collector = new DiagnosticsCollector();
    collector.recordSection('test');

    const data1 = collector.getData();
    data1.triggeredSections.push('modified');

    const data2 = collector.getData();
    expect(data2.triggeredSections).toEqual(['test']); // 原数据不受影响
  });

  it('reset 重置所有字段', () => {
    const collector = new DiagnosticsCollector();

    collector.recordSection('test');
    collector.recordTokenUsage(100, 50, 30, 200);
    collector.recordToolCall(true, false);
    collector.recordCompact(true, 5000);
    collector.recordTerminal('completed');
    collector.recordRag(5, 2000);

    collector.reset();

    const data = collector.getData();
    expect(data.triggeredSections).toEqual([]);
    expect(data.historyTokens).toBe(0);
    expect(data.hadToolCall).toBe(false);
    expect(data.compactOccurred).toBe(false);
    expect(data.terminalReason).toBeNull();
    expect(data.ragHitCount).toBe(0);
  });
});
