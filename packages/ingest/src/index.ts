/**
 * @workagent/ingest - 文档解析与索引任务管理模块入口
 * 导出文档解析器、解析流水线和任务管理器
 */

// 解析器接口与流水线
export { DocumentExtractor, IngestPipeline } from './pipeline.js';

// 文档解析器实现
export { DocxExtractor, computeHash } from './docx.js';
export { PdfExtractor } from './pdf.js';
export { PptxExtractor } from './pptx.js';
export { TxtExtractor } from './txt.js';

// 索引任务管理
export { JobManager } from './job-manager.js';
export type { JobStatusCallback } from './job-manager.js';
