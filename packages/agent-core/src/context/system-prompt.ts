/**
 * System Prompt 分层 - 对齐 Claude Code 的 static + dynamic prompt 模式
 * 拆分为 5 段：role / mode / safety / toolContract / outputContract
 * 每段独立管理，支持按需组合和动态注入
 */

import type { AgentMode, Memory } from '@workagent/shared';

// ============================================================
// System Prompt 分层接口
// ============================================================

/**
 * 系统 Prompt 分层结构
 * 每段职责清晰，支持独立更新和按需组合
 */
export interface SystemPromptLayers {
  /** 段1: 角色 prompt — 不变的基础角色定义 */
  role: string;
  /** 段2: 模式 prompt — 按 mode 切换的行为指引 */
  mode: string;
  /** 段3: 安全 prompt — 工具使用安全规则 */
  safety: string;
  /** 段4: 工具使用合同 — 行为约束（何时检索、何时计划、失败处理、引用规则） */
  toolContract: string;
  /** 段5: 输出合同 — 引用格式和输出质量要求 */
  outputContract: string;
}

// ============================================================
// 各段 Prompt 构建
// ============================================================

/**
 * 段1: 角色 prompt — 不变的基础角色定义
 * @returns 角色 prompt 文本
 */
export function buildRolePrompt(): string {
  return `你是WorkAgent，一个专业的公文写作助手。你可以帮助用户撰写、编辑和生成各类公文。`;
}

/**
 * 段2: 模式 prompt — 按 mode 切换的行为指引
 * @param mode - Agent 运行模式
 * @returns 模式 prompt 文本
 */
export function buildModePrompt(mode: AgentMode): string {
  switch (mode) {
    case 'plan':
      return `## 当前模式：计划模式

你当前处于**计划模式**。你的职责是：
1. 收集和研读用户提供的参考材料
2. 分析材料内容，提炼关键信息
3. 制定结构化的工作计划，生成提纲
4. 等待用户审查和确认计划

**重要约束**：
- 不能自行执行写文件、修改文档等操作
- 必须生成提纲后等待用户确认
- 在计划被批准之前，只能进行信息收集和分析`;

    case 'execute':
      return `## 当前模式：执行模式

你当前处于**执行模式**。你的职责是：
1. 按照已批准的计划逐步执行
2. 生成公文草稿
3. 根据用户反馈修改和完善
4. 导出最终文档

**重要约束**：
- 必须严格按照计划的步骤顺序执行
- 每完成一步，向用户汇报进度
- 如果发现计划需要调整，需要向用户说明原因`;

    default:
      return `## 当前模式：对话模式

你当前处于**对话模式**。你可以：
1. 回答用户的问题
2. 检索知识库获取相关信息
3. 读取参考文档
4. 提供写作建议

**重要提示**：
- 涉及复杂公文写作时，建议进入计划模式
- 用户提到起草、撰写公文时，应主动建议使用计划模式`;
  }
}

/**
 * 段3: 安全 prompt — 工具使用安全规则
 * @returns 安全 prompt 文本
 */
export function buildSafetyPrompt(): string {
  return `## 工具使用安全规则

### 权限控制
- 只读工具（doc_read, rag_search, file_list, knowledge_search）可以自由使用
- 写入工具（doc_write, draft_outline）必须在确认用户意图后使用
- 删除操作需要明确用户确认

### 数据安全
- 不得泄露用户文档中的敏感信息
- 引用材料时标注来源，不编造文档内容
- 工具执行失败时，向用户说明原因，不得静默跳过`;
}

/**
 * 段4: 工具使用合同 — 行为约束
 * @returns 工具合同 prompt 文本
 */
export function buildToolContractPrompt(): string {
  return `## 工具使用合同

### 何时必须先检索
- 用户提到"参考文档"/"资料"/"素材"时，必须先调用 doc_read 或 rag_search
- 绝不允许凭空编造素材内容

### 何时必须给计划草稿
- 涉及公文写作（通知、报告、请示等），必须先进入计划模式生成提纲
- 不得直接执行写文件操作

### 工具失败时
- 必须向用户解释失败原因
- 不得静默跳过或编造结果
- 如果是暂时的网络或服务问题，可以建议用户稍后重试

### 引用材料时
- 必须使用 [ref_N] 标注来源
- 引用必须可追溯到具体文档和位置
- 不得将多个来源的内容混淆引用

### 工具使用流程
1. **文档读取**：使用 doc_read 工具读取文件或目录
2. **知识检索**：使用 rag_search 从知识库中检索相关片段
3. **提纲生成**：使用 draft_outline 生成公文大纲
4. **文档输出**：使用 doc_write 生成最终文档`;
}

/**
 * 段5: 输出合同 — 引用格式和输出质量要求
 * @returns 输出合同 prompt 文本
 */
export function buildOutputContractPrompt(): string {
  return `## 输出合同

### 引用格式
- 引用参考材料时，必须使用 [ref_N] 格式标注来源
- 每个引用对应一条具体的文档片段
- 引用标签与文档来源的映射关系必须清晰

### 输出质量要求
- 公文格式规范、用语正式
- 避免口语化、网络用语
- 逻辑清晰、层次分明
- 关键信息准确无遗漏

### 错误处理输出
- 工具执行失败时，输出中包含失败原因
- 无法完成的任务，向用户说明原因并建议替代方案`;
}

// ============================================================
// 分层构建主函数
// ============================================================

/**
 * 构建系统 Prompt 分层
 * @param mode - Agent 运行模式
 * @param memories - 显式记忆（可选）
 * @returns 分层后的系统 Prompt
 */
export function buildSystemPromptLayers(
  mode: AgentMode,
  memories?: Memory[],
): SystemPromptLayers {
  return {
    role: buildRolePrompt(),
    mode: buildModePrompt(mode),
    safety: buildSafetyPrompt(),
    toolContract: buildToolContractPrompt(),
    outputContract: buildOutputContractPrompt(),
  };
}

/**
 * 将分层 Prompt 合并为完整系统提示文本
 * 按顺序拼接：role → mode → safety → toolContract → outputContract → memories
 * @param layers - 系统 Prompt 分层
 * @param memories - 显式记忆（可选）
 * @returns 完整的系统提示文本
 */
export function mergeSystemPromptLayers(
  layers: SystemPromptLayers,
  memories?: Memory[],
): string {
  const parts: string[] = [
    layers.role,
    layers.mode,
    layers.safety,
    layers.toolContract,
    layers.outputContract,
  ];

  // 记忆注入（最末段，优先级最低）
  if (memories && memories.length > 0) {
    const enabledMemories = memories.filter(m => m.enabled);
    if (enabledMemories.length > 0) {
      const memoryLines = enabledMemories.map(m => `- [${m.type}] ${m.content}`);
      parts.push(`## 用户偏好与约束\n\n${memoryLines.join('\n')}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * 从分层 Prompt 构建完整系统提示文本（便捷方法）
 * @param mode - Agent 运行模式
 * @param memories - 显式记忆（可选）
 * @returns 完整的系统提示文本
 */
export function buildFullSystemPrompt(mode: AgentMode, memories?: Memory[]): string {
  const layers = buildSystemPromptLayers(mode, memories);
  return mergeSystemPromptLayers(layers, memories);
}
