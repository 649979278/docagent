/**
 * 公文模板引擎
 * 内置通知、请示、报告、函四种公文模板
 * 每个模板定义文种、结构、必填字段和格式约束
 */

/**
 * 公文模板定义
 * 定义公文的结构、必填字段和格式约束
 */
export interface DocumentTemplate {
  /** 文种名称 */
  docType: string;
  /** 文种说明 */
  description: string;
  /** 模板结构定义（Markdown格式） */
  structure: string[];
  /** 必填字段 */
  requiredFields: TemplateField[];
  /** 可选字段 */
  optionalFields: TemplateField[];
  /** 格式约束 */
  constraints: string[];
}

/**
 * 模板字段定义
 */
export interface TemplateField {
  /** 字段名 */
  name: string;
  /** 字段标签（中文显示名） */
  label: string;
  /** 字段类型 */
  type: 'text' | 'date' | 'select' | 'multiline';
  /** 选项（仅select类型） */
  options?: string[];
  /** 默认值 */
  defaultValue?: string;
  /** 提示文本 */
  placeholder?: string;
}

/**
 * 模板填充数据
 * 键为字段名，值为填充内容
 */
export type TemplateData = Record<string, string>;

/**
 * 通知模板
 * 适用于发布、传达要求下级机关执行和有关单位周知或执行的事项
 */
export const TEMPLATE_NOTICE: DocumentTemplate = {
  docType: '通知',
  description: '适用于发布、传达要求下级机关执行和有关单位周知或者执行的事项，批转、转发公文',
  structure: [
    '# {title}',
    '',
    '{mainRecipient}：',
    '',
    '{body}',
    '',
    '{heading1}：',
    '{content1}',
    '',
    '{heading2}：',
    '{content2}',
    '',
    '---',
    '',
    '{orgName}',
    '{date}',
    '',
    '---',
    '*附件：{attachmentList}*',
  ],
  requiredFields: [
    { name: 'title', label: '标题', type: 'text', placeholder: '关于……的通知' },
    { name: 'mainRecipient', label: '主送机关', type: 'text', placeholder: '各……' },
    { name: 'body', label: '正文', type: 'multiline', placeholder: '通知正文内容' },
    { name: 'orgName', label: '发文机关', type: 'text', placeholder: '发文机关名称' },
    { name: 'date', label: '成文日期', type: 'date' },
  ],
  optionalFields: [
    { name: 'heading1', label: '一级标题1', type: 'text', placeholder: '一、……' },
    { name: 'content1', label: '一级标题1内容', type: 'multiline' },
    { name: 'heading2', label: '一级标题2', type: 'text', placeholder: '二、……' },
    { name: 'content2', label: '一级标题2内容', type: 'multiline' },
    { name: 'attachmentList', label: '附件列表', type: 'text', placeholder: '1.……' },
  ],
  constraints: [
    '标题应采用"关于……的通知"格式',
    '主送机关较多时可用"各有关单位"概括',
    '正文应先说明发文缘由，再明确具体要求',
    '如有附件应在正文下空一行左空二字标注',
  ],
};

/**
 * 请示模板
 * 适用于向上级机关请求指示、批准
 */
export const TEMPLATE_REQUEST: DocumentTemplate = {
  docType: '请示',
  description: '适用于向上级机关请求指示、批准',
  structure: [
    '# {title}',
    '',
    '{mainRecipient}：',
    '',
    '{reason}',
    '',
    '{requestContent}',
    '',
    '以上请示，请批示。',
    '',
    '---',
    '',
    '{orgName}',
    '{date}',
  ],
  requiredFields: [
    { name: 'title', label: '标题', type: 'text', placeholder: '关于……的请示' },
    { name: 'mainRecipient', label: '主送机关', type: 'text', placeholder: '上级机关名称' },
    { name: 'reason', label: '请示缘由', type: 'multiline', placeholder: '说明请示的背景和原因' },
    { name: 'requestContent', label: '请示事项', type: 'multiline', placeholder: '具体请求事项' },
    { name: 'orgName', label: '发文机关', type: 'text', placeholder: '发文机关名称' },
    { name: 'date', label: '成文日期', type: 'date' },
  ],
  optionalFields: [],
  constraints: [
    '标题应采用"关于……的请示"格式',
    '一文一事，不得在一份请示中涉及多个事项',
    '请示缘由应充分、具体',
    '结尾固定用语："以上请示，请批示"或"妥否，请批示"',
    '不得抄送下级机关',
  ],
};

/**
 * 报告模板
 * 适用于向上级机关汇报工作、反映情况、回复上级机关的询问
 */
export const TEMPLATE_REPORT: DocumentTemplate = {
  docType: '报告',
  description: '适用于向上级机关汇报工作、反映情况、回复上级机关的询问',
  structure: [
    '# {title}',
    '',
    '{mainRecipient}：',
    '',
    '{background}',
    '',
    '{heading1}：',
    '{content1}',
    '',
    '{heading2}：',
    '{content2}',
    '',
    '{conclusion}',
    '',
    '特此报告。',
    '',
    '---',
    '',
    '{orgName}',
    '{date}',
  ],
  requiredFields: [
    { name: 'title', label: '标题', type: 'text', placeholder: '关于……的报告' },
    { name: 'mainRecipient', label: '主送机关', type: 'text', placeholder: '上级机关名称' },
    { name: 'background', label: '背景概述', type: 'multiline', placeholder: '报告的背景和总体情况' },
    { name: 'orgName', label: '发文机关', type: 'text', placeholder: '发文机关名称' },
    { name: 'date', label: '成文日期', type: 'date' },
  ],
  optionalFields: [
    { name: 'heading1', label: '一级标题1', type: 'text', placeholder: '一、工作进展' },
    { name: 'content1', label: '一级标题1内容', type: 'multiline' },
    { name: 'heading2', label: '一级标题2', type: 'text', placeholder: '二、存在问题' },
    { name: 'content2', label: '一级标题2内容', type: 'multiline' },
    { name: 'conclusion', label: '结论/下一步计划', type: 'multiline' },
  ],
  constraints: [
    '标题应采用"关于……的报告"格式',
    '报告不得夹带请示事项',
    '结尾固定用语："特此报告"',
    '汇报工作应有数据支撑',
  ],
};

/**
 * 函模板
 * 适用于不相隶属机关之间商洽工作、询问和答复问题、请求批准和答复审批事项
 */
export const TEMPLATE_LETTER: DocumentTemplate = {
  docType: '函',
  description: '适用于不相隶属机关之间商洽工作、询问和答复问题、请求批准和答复审批事项',
  structure: [
    '# {title}',
    '',
    '{mainRecipient}：',
    '',
    '{reason}',
    '',
    '{body}',
    '',
    '{closing}',
    '',
    '---',
    '',
    '{orgName}',
    '{date}',
  ],
  requiredFields: [
    { name: 'title', label: '标题', type: 'text', placeholder: '关于……的函' },
    { name: 'mainRecipient', label: '主送机关', type: 'text', placeholder: '对方机关名称' },
    { name: 'reason', label: '发函缘由', type: 'multiline', placeholder: '说明发函的原因和目的' },
    { name: 'body', label: '函件事项', type: 'multiline', placeholder: '具体商洽/询问/请求事项' },
    { name: 'orgName', label: '发文机关', type: 'text', placeholder: '发文机关名称' },
    { name: 'date', label: '成文日期', type: 'date' },
  ],
  optionalFields: [
    {
      name: 'closing',
      label: '结语',
      type: 'select',
      options: ['请予函复', '请予批准', '特此函达', '特此函询', '盼复'],
      defaultValue: '请予函复',
    },
  ],
  constraints: [
    '标题应采用"关于……的函"格式',
    '语气应平和礼貌，尊重对方',
    '去函结语常用"请予函复""请予批准"',
    '复函结语常用"特此函复"',
    '函件应简洁明了，直入主题',
  ],
};

/**
 * 所有内置模板映射
 * 按文种名称索引
 */
export const BUILTIN_TEMPLATES: Record<string, DocumentTemplate> = {
  通知: TEMPLATE_NOTICE,
  请示: TEMPLATE_REQUEST,
  报告: TEMPLATE_REPORT,
  函: TEMPLATE_LETTER,
};

/**
 * 填充模板，生成Markdown内容
 * 将数据填充到模板结构中，替换占位符
 * @param template - 文档模板
 * @param data - 填充数据
 * @returns 生成的Markdown文本
 */
export function fillTemplate(template: DocumentTemplate, data: TemplateData): string {
  // 检查必填字段
  const missingFields: string[] = [];
  for (const field of template.requiredFields) {
    if (!data[field.name]?.trim()) {
      missingFields.push(field.label);
    }
  }

  // 如果缺少必填字段，在输出开头添加提示
  let warning = '';
  if (missingFields.length > 0) {
    warning = `> **注意**：以下必填字段未填写：${missingFields.join('、')}\n\n`;
  }

  // 填充模板结构
  const lines = template.structure.map((line) => {
    // 替换 {fieldName} 占位符
    return line.replace(/\{(\w+)\}/g, (match, fieldName) => {
      return data[fieldName]?.trim() || match;
    });
  });

  return warning + lines.join('\n');
}

/**
 * 获取指定文种的模板
 * @param docType - 文种名称
 * @returns 模板定义，不存在时返回null
 */
export function getTemplate(docType: string): DocumentTemplate | null {
  return BUILTIN_TEMPLATES[docType] ?? null;
}

/**
 * 获取所有可用文种列表
 * @returns 文种名称数组
 */
export function getAvailableDocTypes(): string[] {
  return Object.keys(BUILTIN_TEMPLATES);
}
