/**
 * 公文样式定义
 * GB/T 9704 标准公文格式关键参数
 * 一期只定义常量，不实际应用字体（字体可能不存在）
 */

/**
 * 公文格式参数（GB/T 9704标准）
 * 定义标准公文的排版规格，包括字号、行距、缩进等
 */
export const OFFICIAL_DOC_STYLE = {
  /** 页面设置 */
  page: {
    /** 纸张大小 */
    paperSize: 'A4' as const,
    /** 上边距(mm) - 上白边 37mm */
    marginTop: 37,
    /** 下边距(mm) - 下白边 35mm */
    marginBottom: 35,
    /** 左边距(mm) - 左白边 28mm */
    marginLeft: 28,
    /** 右边距(mm) - 右白边 26mm */
    marginRight: 26,
  },

  /** 份号 */
  fileNumber: {
    /** 字体：黑体 */
    fontFamily: '黑体',
    /** 字号 */
    fontSize: 16,
  },

  /** 密级和保密期限 */
  secrecy: {
    /** 字体：黑体 */
    fontFamily: '黑体',
    /** 字号 */
    fontSize: 16,
  },

  /** 紧急程度 */
  urgency: {
    /** 字体：黑体 */
    fontFamily: '黑体',
    /** 字号 */
    fontSize: 16,
  },

  /** 发文机关标志 */
  orgMark: {
    /** 字体：小标宋体（推荐方正小标宋简体） */
    fontFamily: '方正小标宋简体',
    /** 字号(pt) - 上行文<=22pt，下行文<=22pt */
    fontSize: 22,
    /** 颜色：红色 */
    color: 'red',
  },

  /** 发文字号 */
  docRefNumber: {
    /** 字体：仿宋 */
    fontFamily: '仿宋',
    /** 字号(pt) */
    fontSize: 16,
  },

  /** 标题 */
  title: {
    /** 字体：方正小标宋简体 */
    fontFamily: '方正小标宋简体',
    /** 字号(pt) - 二号字约22pt */
    fontSize: 22,
    /** 对齐方式：居中 */
    textAlign: 'center' as const,
    /** 行距(pt) */
    lineHeight: 28,
  },

  /** 主送机关 */
  mainRecipient: {
    /** 字体：仿宋 */
    fontFamily: '仿宋',
    /** 字号(pt) - 三号字约16pt */
    fontSize: 16,
    /** 对齐方式：左对齐 */
    textAlign: 'left' as const,
  },

  /** 正文 */
  body: {
    /** 字体：仿宋 */
    fontFamily: '仿宋',
    /** 字号(pt) - 三号字约16pt */
    fontSize: 16,
    /** 行距(pt) - 固定值28pt */
    lineHeight: 28,
    /** 首行缩进：2字符 */
    firstLineIndent: 2,
    /** 对齐方式：两端对齐 */
    textAlign: 'justify' as const,
  },

  /** 一级标题（一、） */
  heading1: {
    /** 字体：黑体 */
    fontFamily: '黑体',
    /** 字号(pt) */
    fontSize: 16,
  },

  /** 二级标题（（一）） */
  heading2: {
    /** 字体：楷体 */
    fontFamily: '楷体',
    /** 字号(pt) */
    fontSize: 16,
  },

  /** 三级标题（1.） */
  heading3: {
    /** 字体：仿宋加粗 */
    fontFamily: '仿宋',
    /** 字号(pt) */
    fontSize: 16,
    /** 加粗 */
    bold: true,
  },

  /** 附件说明 */
  attachment: {
    /** 字体：仿宋 */
    fontFamily: '仿宋',
    /** 字号(pt) */
    fontSize: 16,
    /** 左缩进：2字符 */
    leftIndent: 2,
  },

  /** 发文机关署名 */
  orgSignature: {
    /** 字体：仿宋 */
    fontFamily: '仿宋',
    /** 字号(pt) */
    fontSize: 16,
    /** 对齐方式：右对齐 */
    textAlign: 'right' as const,
  },

  /** 成文日期 */
  dateLine: {
    /** 字体：仿宋 */
    fontFamily: '仿宋',
    /** 字号(pt) */
    fontSize: 16,
    /** 对齐方式：右对齐 */
    textAlign: 'right' as const,
    /** 右缩进：4字符 */
    rightIndent: 4,
  },

  /** 附注 */
  annotation: {
    /** 字体：仿宋 */
    fontFamily: '仿宋',
    /** 字号(pt) */
    fontSize: 14,
    /** 对齐方式：左对齐 */
    textAlign: 'left' as const,
  },

  /** 抄送 */
  cc: {
    /** 字体：仿宋 */
    fontFamily: '仿宋',
    /** 字号(pt) - 四号字约14pt */
    fontSize: 14,
  },

  /** 印发机关和日期 */
  printInfo: {
    /** 字体：仿宋 */
    fontFamily: '仿宋',
    /** 字号(pt) */
    fontSize: 14,
  },
} as const;

/**
 * 公文层级标题格式映射
 * 将中文序号格式映射到对应标题级别
 */
export const HEADING_FORMATS = {
  /** 一级标题格式：一、二、三、 */
  level1: /^([一二三四五六七八九十]+)、/,
  /** 二级标题格式：（一）（二） */
  level2: /^（[一二三四五六七八九十]+）/,
  /** 三级标题格式：1. 2. 3. */
  level3: /^(\d+)\./,
  /** 四级标题格式：（1）（2） */
  level4: /^（\d+）/,
} as const;

/**
 * Markdown到公文格式的标题映射
 * 用于将Markdown标题转换为公文对应的层级标题
 */
export const MARKDOWN_HEADING_MAP = {
  /** # 映射到公文标题 */
  1: { prefix: '', style: OFFICIAL_DOC_STYLE.title },
  /** ## 映射到一级标题 */
  2: { prefix: '', style: OFFICIAL_DOC_STYLE.heading1 },
  /** ### 映射到二级标题 */
  3: { prefix: '', style: OFFICIAL_DOC_STYLE.heading2 },
  /** #### 映射到三级标题 */
  4: { prefix: '', style: OFFICIAL_DOC_STYLE.heading3 },
} as const;
