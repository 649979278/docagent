/**
 * @workagent/tools - 工具系统入口
 * 导出工具基础定义、权限代理、执行器和所有具体工具
 */

// 基础定义
export { ToolRegistry, toToolDefinition, getDefaultPermissionDecision } from './base.js';
export type { AgentTool, ToolExecutionResult } from './base.js';

// 权限代理
export { PermissionBroker } from './permission.js';
export type { PermissionPersistence, PermissionRequestCallback } from './permission.js';

// 执行器
export { ToolExecutor, partitionToolCalls } from './executor.js';
export type { ExecutorConfig, PartitionedCalls } from './executor.js';

// RAG检索工具
export { RagSearchTool } from './rag-search/index.js';
export type { RAGSearchProvider, RagSearchInput, RagSearchOutput } from './rag-search/index.js';

// 文档读取工具
export { DocReadTool } from './doc-read/index.js';
export type { IngestPipeline, DocReadInput, DocReadOutput } from './doc-read/index.js';

// 文件列表工具
export { FileListTool } from './file-list/index.js';
export type { FileListInput, FileListOutput, FileInfo } from './file-list/index.js';

// 知识库添加工具
export { KnowledgeAddTool } from './knowledge-add/index.js';
export type { IndexManager, KnowledgeAddInput, KnowledgeAddOutput } from './knowledge-add/index.js';

// 提纲生成工具
export { DraftOutlineTool } from './draft-outline/index.js';
export type { DraftOutlineInput, DraftOutlineOutput } from './draft-outline/index.js';

// 文档生成工具
export { DocWriteTool } from './doc-write/index.js';
export type { DocumentGenerator, DocWriteInput, DocWriteOutput } from './doc-write/index.js';

// 覆盖文档工具
export { DocOverwriteTool } from './doc-overwrite/index.js';
export type { DocOverwriteInput, DocOverwriteOutput } from './doc-overwrite/index.js';
