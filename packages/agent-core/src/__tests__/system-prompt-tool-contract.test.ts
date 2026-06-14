/**
 * System Prompt 工具合同测试
 * 验证：
 * 1. toolContract 包含何时必须先检索
 * 2. toolContract 包含何时必须给计划草稿
 * 3. toolContract 包含工具失败时行为约束
 * 4. toolContract 包含引用材料规则
 * 5. toolContract 包含工具使用流程
 */

import { describe, it, expect } from 'vitest';
import { buildToolContractPrompt, buildSystemPromptLayers } from '../context/system-prompt.js';

// ============================================================
// 测试
// ============================================================

describe('System Prompt 工具合同', () => {
  it('toolContract 包含何时必须先检索', () => {
    const contract = buildToolContractPrompt();
    expect(contract).toContain('何时必须先检索');
    expect(contract).toContain('参考文档');
    expect(contract).toContain('凭空编造');
  });

  it('toolContract 包含何时必须给计划草稿', () => {
    const contract = buildToolContractPrompt();
    expect(contract).toContain('何时必须给计划草稿');
    expect(contract).toContain('计划模式');
    expect(contract).toContain('提纲');
  });

  it('toolContract 包含工具失败时行为约束', () => {
    const contract = buildToolContractPrompt();
    expect(contract).toContain('工具失败时');
    expect(contract).toContain('静默跳过');
    expect(contract).toContain('编造结果');
  });

  it('toolContract 包含引用材料规则', () => {
    const contract = buildToolContractPrompt();
    expect(contract).toContain('引用材料时');
    expect(contract).toContain('[ref_N]');
    expect(contract).toContain('标注来源');
  });

  it('toolContract 包含工具使用流程', () => {
    const contract = buildToolContractPrompt();
    expect(contract).toContain('工具使用流程');
    expect(contract).toContain('doc_read');
    expect(contract).toContain('rag_search');
    expect(contract).toContain('draft_outline');
    expect(contract).toContain('doc_write');
  });

  it('分层 prompt 中包含 toolContract', () => {
    const layers = buildSystemPromptLayers('chat');
    expect(layers.toolContract).toContain('工具使用合同');
  });
});
