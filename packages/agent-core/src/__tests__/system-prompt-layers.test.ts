/**
 * System Prompt 分层测试
 * 验证：
 * 1. 5 段分层正确分离
 * 2. 各段内容非空
 * 3. 不同 mode 生成不同 mode prompt
 * 4. mergeSystemPromptLayers 正确拼接
 * 5. 记忆注入在末段
 */

import { describe, it, expect } from 'vitest';
import {
  buildSystemPromptLayers,
  mergeSystemPromptLayers,
  buildFullSystemPrompt,
  buildRolePrompt,
  buildModePrompt,
  buildSafetyPrompt,
  buildToolContractPrompt,
  buildOutputContractPrompt,
} from '../context/system-prompt.js';
import type { Memory } from '@workagent/shared';

// ============================================================
// Mock 工具函数
// ============================================================

function createMemories(): Memory[] {
  return [
    { id: 'mem-1', type: 'user_requirement', content: '必须使用正式格式', source: 's1', enabled: true, createdAt: Date.now() },
    { id: 'mem-2', type: 'style_preference', content: '避免口语化', source: 's1', enabled: false, createdAt: Date.now() },
  ];
}

// ============================================================
// 测试
// ============================================================

describe('System Prompt 分层', () => {
  it('5 段分层正确分离且非空', () => {
    const layers = buildSystemPromptLayers('chat');

    expect(layers.role).toBeTruthy();
    expect(layers.mode).toBeTruthy();
    expect(layers.safety).toBeTruthy();
    expect(layers.toolContract).toBeTruthy();
    expect(layers.outputContract).toBeTruthy();
  });

  it('chat 模式包含对话模式说明', () => {
    const modePrompt = buildModePrompt('chat');
    expect(modePrompt).toContain('对话模式');
  });

  it('plan 模式包含计划模式说明', () => {
    const modePrompt = buildModePrompt('plan');
    expect(modePrompt).toContain('计划模式');
  });

  it('execute 模式包含执行模式说明', () => {
    const modePrompt = buildModePrompt('execute');
    expect(modePrompt).toContain('执行模式');
  });

  it('mergeSystemPromptLayers 正确拼接', () => {
    const layers = buildSystemPromptLayers('chat');
    const merged = mergeSystemPromptLayers(layers);

    // 应包含所有段的关键内容
    expect(merged).toContain('WorkAgent');
    expect(merged).toContain('对话模式');
    expect(merged).toContain('工具使用安全规则');
    expect(merged).toContain('工具使用合同');
    expect(merged).toContain('输出合同');
  });

  it('记忆注入在末段且仅注入 enabled 的记忆', () => {
    const memories = createMemories();
    const layers = buildSystemPromptLayers('chat');
    const merged = mergeSystemPromptLayers(layers, memories);

    // enabled 的记忆应该在用户偏好段中
    expect(merged).toContain('[user_requirement] 必须使用正式格式');
    // disabled 的记忆不应该出现在用户偏好段中
    // 注意：输出合同中有"避免口语化、网络用语"，但记忆中的"[style_preference] 避免口语化"不应出现
    expect(merged).not.toContain('[style_preference]');
  });

  it('buildFullSystemPrompt 等价于 layers + merge', () => {
    const memories = createMemories();
    const layers = buildSystemPromptLayers('chat', memories);
    const fromMerge = mergeSystemPromptLayers(layers, memories);
    const fromFull = buildFullSystemPrompt('chat', memories);

    expect(fromFull).toBe(fromMerge);
  });

  it('角色 prompt 包含 WorkAgent 定义', () => {
    const rolePrompt = buildRolePrompt();
    expect(rolePrompt).toContain('WorkAgent');
    expect(rolePrompt).toContain('公文写作助手');
  });

  it('安全 prompt 包含权限控制规则', () => {
    const safetyPrompt = buildSafetyPrompt();
    expect(safetyPrompt).toContain('权限控制');
    expect(safetyPrompt).toContain('只读工具');
  });

  it('输出合同包含引用格式要求', () => {
    const outputContract = buildOutputContractPrompt();
    expect(outputContract).toContain('[ref_N]');
  });
});
