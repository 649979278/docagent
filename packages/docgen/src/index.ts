/**
 * @workagent/docgen - 公文生成模块入口
 * 导出文档生成器、样式定义、模板引擎
 */

// 文档生成器
export { generateMarkdown, generateFromTemplate, markdownToDocx } from './writer.js';
export type { GenerateResult } from './writer.js';

// 公文样式
export { OFFICIAL_DOC_STYLE, HEADING_FORMATS, MARKDOWN_HEADING_MAP } from './styles.js';

// 模板引擎
export {
  TEMPLATE_NOTICE,
  TEMPLATE_REQUEST,
  TEMPLATE_REPORT,
  TEMPLATE_LETTER,
  BUILTIN_TEMPLATES,
  fillTemplate,
  getTemplate,
  getAvailableDocTypes,
} from './templates.js';
export type { DocumentTemplate, TemplateField, TemplateData } from './templates.js';
