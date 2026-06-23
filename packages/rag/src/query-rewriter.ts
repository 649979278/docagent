/**
 * 查询重写器
 * 提供规则基础和 LLM 驱动两种查询重写，支持可降级组装。
 *
 * 实现：
 * - RuleBasedQueryRewriter: 基于规则的查询扩展（去除停用词、提取关键实体）
 * - OllamaQueryRewriter: LLM 驱动的查询扩展（语义改写 + 关键词补充）
 */

/**
 * 查询重写器接口。
 * 所有重写器必须实现此接口。
 */
export interface QueryRewriter {
  /**
   * 重写查询文本。
   * @param query - 原始查询文本。
   * @returns 重写后的查询文本。
   */
  rewrite(query: string): Promise<string>;
  /**
   * 获取当前诊断快照。
   * @returns 组件名称及是否处于 fallback/禁用状态。
   */
  getDiagnostics?(): { name: string; fallback: boolean };
}

/**
 * 基于规则的查询重写器。
 * 去除中文常见停用词、保留关键实体（如政策文号）。
 * 无需 LLM，零延迟。
 */
export class RuleBasedQueryRewriter implements QueryRewriter {
  /** 中文常见停用词集合 */
  private static readonly STOP_WORDS = new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人',
    '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去',
    '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '他',
    '她', '它', '们', '什么', '怎么', '如何', '为什么', '哪', '哪些',
    '哪个', '吗', '呢', '吧', '啊', '呀', '哦', '嗯', '哈',
  ]);

  /**
   * 重写查询：去除停用词，保留关键实体。
   * @param query - 原始查询文本。
   * @returns 重写后的查询文本。
   */
  async rewrite(query: string): Promise<string> {
    if (!query || !query.trim()) return query;

    // 1. 提取政策文号等特殊模式（如 "国发〔2024〕3号"）
    const specialPatterns = this.extractSpecialPatterns(query);

    // 2. 分词并去除停用词
    const tokens = this.tokenize(query);
    const filtered = tokens.filter((t) => !RuleBasedQueryRewriter.STOP_WORDS.has(t));

    // 3. 合并：特殊模式 + 过滤后的词
    const result = [...specialPatterns, ...filtered].join(' ');

    return result || query;
  }

  /**
   * 获取规则重写器诊断快照。
   * @returns 规则重写器的固定诊断信息。
   */
  getDiagnostics(): { name: string; fallback: boolean } {
    return {
      name: this.constructor.name,
      fallback: true,
    };
  }

  /**
   * 提取查询中的特殊模式（政策文号、法规编号等）。
   * @param query - 查询文本。
   * @returns 提取的特殊模式列表。
   */
  private extractSpecialPatterns(query: string): string[] {
    const patterns: string[] = [];

    // 匹配政策文号：国发〔2024〕3号、国办发[2024]3号
    const docNumberRegex = /[一-龥]+[发办][〔\[]\d{4}[〕\]][\d]+号?/g;
    let match: RegExpExecArray | null;
    while ((match = docNumberRegex.exec(query)) !== null) {
      patterns.push(match[0]);
    }

    // 匹配法规编号：GB/T 12345-2020、JGJ 130-2011
    const stdNumberRegex = /[A-Z]{2,}\/?[A-Z]?\s*\d+[-‐]\d+/g;
    while ((match = stdNumberRegex.exec(query)) !== null) {
      patterns.push(match[0]);
    }

    return patterns;
  }

  /**
   * 简单中文分词：按标点、空格分割，单字拆分。
   * @param query - 查询文本。
   * @returns 分词结果。
   */
  private tokenize(query: string): string[] {
    // 按标点和空格分割
    const parts = query.split(/[\s,，。、；：！？；""''（）()【】\[\]{}<>《》\/\\]+/);
    const tokens: string[] = [];

    for (const part of parts) {
      if (!part) continue;
      // 如果是纯中文且长度>1，尝试按2-gram拆分
      if (/^[一-龥]+$/.test(part) && part.length > 4) {
        // 长中文串保留原样 + 2-gram
        tokens.push(part);
        for (let i = 0; i < part.length - 1; i++) {
          tokens.push(part.slice(i, i + 2));
        }
      } else {
        tokens.push(part);
      }
    }

    return tokens;
  }
}

/** OllamaQueryRewriter 连续失败自动禁用阈值 */
const OLLAMA_REWRITER_DISABLE_THRESHOLD = 3;

/**
 * 基于 Ollama LLM 的查询重写器。
 * 使用 LLM 对查询进行语义改写和关键词补充，
 * 提升检索召回率。3 次连续失败后自动禁用，降级为规则重写。
 */
export class OllamaQueryRewriter implements QueryRewriter {
  /** Ollama 基础 URL */
  private baseUrl: string;

  /** 聊天模型名 */
  private modelName: string;

  /** 规则重写器（降级时使用） */
  private fallback: RuleBasedQueryRewriter;

  /** 连续失败次数 */
  private consecutiveFailures: number = 0;

  /** 是否已被自动禁用 */
  private disabled: boolean = false;

  /**
   * 创建 Ollama 查询重写器。
   * @param baseUrl - Ollama 基础 URL，默认 http://localhost:11434。
   * @param modelName - 聊天模型名，默认 qwen3.5:9b。
   */
  constructor(baseUrl: string = 'http://localhost:11434', modelName: string = 'qwen3.5:9b') {
    this.baseUrl = baseUrl;
    this.modelName = modelName;
    this.fallback = new RuleBasedQueryRewriter();
  }

  /**
   * 重写查询文本。
   * 先尝试 LLM 改写，失败时降级到规则重写。
   * @param query - 原始查询文本。
   * @returns 重写后的查询文本。
   */
  async rewrite(query: string): Promise<string> {
    if (!query || !query.trim()) return query;

    // 已禁用，直接降级
    if (this.disabled) {
      return this.fallback.rewrite(query);
    }

    try {
      const rewritten = await this.callOllamaRewrite(query);
      this.consecutiveFailures = 0;
      // 如果 LLM 返回空或过短，降级
      if (!rewritten || rewritten.trim().length < 2) {
        return this.fallback.rewrite(query);
      }
      return rewritten;
    } catch {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= OLLAMA_REWRITER_DISABLE_THRESHOLD) {
        this.disabled = true;
      }
      return this.fallback.rewrite(query);
    }
  }

  /**
   * 检查是否已被自动禁用。
   * @returns 是否已禁用。
   */
  isDisabled(): boolean {
    return this.disabled;
  }

  /**
   * 获取当前诊断快照。
   * @returns 查询重写器实时诊断信息。
   */
  getDiagnostics(): { name: string; fallback: boolean } {
    return {
      name: this.constructor.name,
      fallback: this.disabled,
    };
  }

  /**
   * 调用 Ollama chat API 进行查询改写。
   * @param query - 原始查询文本。
   * @returns 改写后的查询文本。
   */
  private async callOllamaRewrite(query: string): Promise<string> {
    const prompt = `你是一个查询改写助手。用户正在知识库中检索信息，请将用户的自然语言查询改写为更适合检索的关键词形式。

改写要求：
1. 保留所有关键实体（如政策文号、法规编号、专有名词）
2. 去除口语化表达和无关虚词
3. 补充可能的相关同义词或缩写
4. 优先输出 JSON 字符串数组，例如 ["改写查询1","关键词1 关键词2"]；如果无法输出 JSON，则只输出空格分隔关键词
5. 不要输出解释、Markdown 或额外前后缀

用户查询：${query}

改写结果：`;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.1, num_predict: 128 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama chat API returned ${response.status}`);
    }

    const data = await response.json() as {
      message?: { content?: string };
    };

    return normalizeRewriteResponse(data.message?.content ?? '');
  }
}

/**
 * 规范化 LLM 查询改写响应。
 * @param content - 模型原始输出。
 * @returns 可直接用于检索的查询串。
 */
function normalizeRewriteResponse(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return '';
  }

  const jsonCandidate = extractJsonArray(trimmed);
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim())
          .join(' ');
      }
    } catch {
      // 非合法 JSON 时继续按关键词串处理。
    }
  }

  return trimmed
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从模型输出中提取 JSON 数组片段。
 * @param content - 模型输出。
 * @returns JSON 数组文本。
 */
function extractJsonArray(content: string): string | null {
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return content.slice(start, end + 1);
}
