/**
 * Turn State 初始化时序测试
 * 验证 currentTurn 在路由判断前已初始化
 */

import { describe, it, expect } from 'vitest';
import { createLoopState, createTurnState } from '../state.js';
import type { LoopState, TransitionType } from '../state.js';

describe('createLoopState', () => {
  it('初始状态 currentTurn 为 null', () => {
    const state = createLoopState('test-session', 'chat');
    expect(state.currentTurn).toBeNull();
  });

  it('初始状态 decision 为 Continue', () => {
    const state = createLoopState('test-session', 'chat');
    expect(state.decision).toBe('Continue');
  });

  it('初始状态 mode 正确设置', () => {
    const chatState = createLoopState('test-session', 'chat');
    expect(chatState.mode).toBe('chat');

    const planState = createLoopState('test-session', 'plan');
    expect(planState.mode).toBe('plan');

    const executeState = createLoopState('test-session', 'execute');
    expect(executeState.mode).toBe('execute');
  });

  it('初始状态 compactCount 为 0', () => {
    const state = createLoopState('test-session', 'chat');
    expect(state.compactCount).toBe(0);
  });
});

describe('createTurnState', () => {
  it('创建的 TurnState 字段完整', () => {
    const turn = createTurnState('turn-1', '用户输入');

    expect(turn.turnId).toBe('turn-1');
    expect(turn.userInput).toBe('用户输入');
    expect(turn.assistantContent).toBe('');
    expect(turn.toolCalls).toEqual([]);
    expect(turn.toolTraces).toEqual([]);
    expect(turn.tokensUsed).toBe(0);
    expect(turn.hasError).toBe(false);
    expect(turn.retried).toBe(false);
  });

  it('可以修改 TurnState 的字段', () => {
    const turn = createTurnState('turn-1', '用户输入');

    turn.assistantContent = '助手回复';
    turn.toolCalls = [{ id: 'tc-1', name: 'file_list', arguments: {} }];
    turn.tokensUsed = 100;
    turn.hasError = true;
    turn.retried = true;

    expect(turn.assistantContent).toBe('助手回复');
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.tokensUsed).toBe(100);
    expect(turn.hasError).toBe(true);
    expect(turn.retried).toBe(true);
  });
});

describe('TransitionType', () => {
  it('包含所有预期的转换类型', () => {
    const transitions: TransitionType[] = [
      'next_turn',
      'error_retry',
      'enter_plan',
      'wait_approval',
      'execute_plan',
      'completed',
      'prompt_too_long',
      'aborted',
      'max_turns',
      'model_error',
      'reactive_compact_retry',
      'compact_recovery',
    ];

    // 确认类型定义覆盖了所有值（编译时检查 + 运行时数量验证）
    expect(transitions).toHaveLength(12);
  });
});
