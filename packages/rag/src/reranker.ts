/**
 * 重排器
 * 提供直通重排器和 BGE Reranker 骨架。
 *
 * 设计要点：
 * - PassThroughReranker: 直接透传，零延迟
 * - BGEReranker: 调用 Ollama reranker 模型，最多处理 20 条，
 *   超出直接追加；3 次连续失败后自动禁用
 */

import type { RetrievedChunk } from '@workagent/shared';

/**
 * 重排器接口。
 * 所有重排器必须实现此接口。
 */
export interface Reranker {
  /**
   * 对检索结果进行重排。
   * @param chunks - 待重排的检索结果。
   * @param query - 原始查询文本。
   * @returns 重排后的检索结果。
   */
  rerank(chunks: RetrievedChunk[], query: string): Promise<RetrievedChunk[]>;
  /**
   * 获取当前诊断快照。
   * @returns 组件名称及是否处于 fallback/禁用状态。
   */
  getDiagnostics?(): { name: string; fallback: boolean };
}

/**
 * 直通重排器。
 * 不做任何重排，直接透传结果。
 * 作为无 reranker 模型时的默认实现。
 */
export class PassThroughReranker implements Reranker {
  /**
   * 直接返回原始结果，不做重排。
   * @param chunks - 待重排的检索结果。
   * @returns 原始检索结果。
   */
  async rerank(chunks: RetrievedChunk[], _query: string): Promise<RetrievedChunk[]> {
    return chunks;
  }

  /**
   * 获取透传重排器诊断快照。
   * @returns 透传重排器固定诊断信息。
   */
  getDiagnostics(): { name: string; fallback: boolean } {
    return {
      name: this.constructor.name,
      fallback: true,
    };
  }
}

/** BGE Reranker 最大处理条数 */
const BGE_RERANKER_MAX_ITEMS = 20;

/** BGE Reranker 连续失败自动禁用阈值 */
const BGE_RERANKER_DISABLE_THRESHOLD = 3;

/**
 * BGE Reranker 重排器骨架。
 * 调用 Ollama reranker 模型进行重排。
 *
 * 安全机制：
 * - 最多处理 20 条结果，超出部分直接追加（不参与重排）
 * - 3 次连续失败后自动禁用，回退到 PassThrough
 *
 * 注意：当前为骨架实现，实际 Ollama rerank API 调用待模型可用后补全。
 */
export class BGEReranker implements Reranker {
  /** Ollama 基础 URL */
  private baseUrl: string;

  /** Reranker 模型名 */
  private modelName: string;

  /** 连续失败次数 */
  private consecutiveFailures: number = 0;

  /** 是否已被自动禁用 */
  private disabled: boolean = false;

  /**
   * 创建 BGE Reranker。
   * @param baseUrl - Ollama 基础 URL。
   * @param modelName - Reranker 模型名，默认 bge-reranker-v2-m3。
   */
  constructor(baseUrl: string = 'http://localhost:11434', modelName: string = 'bge-reranker-v2-m3') {
    this.baseUrl = baseUrl;
    this.modelName = modelName;
  }

  /**
   * 重排检索结果。
   * 超过 20 条的结果直接追加在末尾（保持原始顺序）。
   * 3 次连续失败后自动禁用。
   * @param chunks - 待重排的检索结果。
   * @param query - 原始查询文本。
   * @returns 重排后的检索结果。
   */
  async rerank(chunks: RetrievedChunk[], query: string): Promise<RetrievedChunk[]> {
    // 已禁用，直接透传
    if (this.disabled) {
      return chunks;
    }

    // 超过上限的结果直接追加
    const toRerank = chunks.slice(0, BGE_RERANKER_MAX_ITEMS);
    const overflow = chunks.slice(BGE_RERANKER_MAX_ITEMS);

    try {
      const reranked = await this.callReranker(toRerank, query);
      this.consecutiveFailures = 0;
      return [...reranked, ...overflow];
    } catch {
      this.consecutiveFailures++;

      // 连续失败达到阈值，自动禁用
      if (this.consecutiveFailures >= BGE_RERANKER_DISABLE_THRESHOLD) {
        this.disabled = true;
      }

      // 失败时直接透传原始结果
      return chunks;
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
   * @returns 重排器实时诊断信息。
   */
  getDiagnostics(): { name: string; fallback: boolean } {
    return {
      name: this.constructor.name,
      fallback: this.disabled,
    };
  }

  /**
   * 调用 Ollama reranker API。
   * 使用 Ollama 的 /api/rerank 端点（需要 bge-reranker-v2-m3 模型）。
   * 如果 rerank API 不可用，回退到基于 chat 的打分方案。
   * 当所有方案均降级时抛出异常，由外层 rerank() 统一计入失败。
   *
   * @param chunks - 待重排的检索结果（已限制在 BGE_RERANKER_MAX_ITEMS 以内）。
   * @param query - 查询文本。
   * @returns 重排后的结果。
   * @throws 当 rerank API 和 chat 打分均失败时抛出。
   */
  private async callReranker(chunks: RetrievedChunk[], query: string): Promise<RetrievedChunk[]> {
    if (chunks.length === 0) return chunks;

    // 尝试 Ollama 原生 /api/rerank 端点
    try {
      const rerankResult = await this.callOllamaRerank(chunks, query);
      if (rerankResult) return rerankResult;
    } catch {
      // /api/rerank 不可用，继续尝试 chat 打分
    }

    // 降级方案：使用 chat 模型对 query-document 对打分
    const chatResult = await this.callChatBasedRerank(chunks, query);

    // 如果 chat 打分也降级（返回原始 chunks），视为失败
    // 通过检查分数是否有变化来判断是否真正生效
    if (chatResult.length > 0 && chatResult.every((c, i) => c.chunkId === chunks[i]?.chunkId && c.score === chunks[i]?.score)) {
      // 打分没有生效，所有结果都是原始顺序和分数
      throw new Error('Reranker unavailable: both /api/rerank and chat-based scoring failed');
    }

    return chatResult;
  }

  /**
   * 调用 Ollama /api/rerank 端点。
   * @param chunks - 待重排的检索结果。
   * @param query - 查询文本。
   * @returns 重排后的结果，null 表示 API 不可用。
   */
  private async callOllamaRerank(chunks: RetrievedChunk[], query: string): Promise<RetrievedChunk[] | null> {
    const documents = chunks.map((c) => c.content);

    const response = await fetch(`${this.baseUrl}/api/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        query,
        documents,
      }),
    });

    if (!response.ok) {
      // API 不存在或模型不可用
      return null;
    }

    const data = await response.json() as {
      results?: Array<{ index: number; relevance_score: number }>;
    };

    if (!data.results || !Array.isArray(data.results)) {
      return null;
    }

    // 按 relevance_score 降序排列
    const sorted = [...data.results].sort((a, b) => b.relevance_score - a.relevance_score);

    return sorted.map((r) => ({
      ...chunks[r.index],
      score: r.relevance_score,
    }));
  }

  /**
   * 降级方案：使用 chat 模型对 query-document 对进行相关性打分。
   * 对每个 chunk 发送简短的打分请求，解析返回的分数。
   * 性能受限，仅在 /api/rerank 不可用时使用。
   *
   * @param chunks - 待重排的检索结果。
   * @param query - 查询文本。
   * @returns 重排后的结果。
   */
  private async callChatBasedRerank(chunks: RetrievedChunk[], query: string): Promise<RetrievedChunk[]> {
    // 批量打分：构造一个打分 prompt，让模型为每个文档打分
    const docList = chunks.map((c, i) => `[${i + 1}] ${c.content.slice(0, 200)}`).join('\n');
    const prompt = `请为以下查询和文档对的相关性打分（0-1之间的数字，1表示最相关）。
查询：${query}

文档列表：
${docList}

请直接输出每篇文档的分数，格式为：序号:分数，每行一个。例如：
1:0.9
2:0.3
3:0.7`;

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        }),
      });

      if (!response.ok) return chunks;

      const data = await response.json() as {
        message?: { content?: string };
      };

      const content = data.message?.content ?? '';
      const scoreMap = this.parseScoreResponse(content, chunks.length);

      // 按分数重排
      const scored = chunks.map((c, i) => ({
        ...c,
        score: scoreMap.get(i + 1) ?? c.score,
      }));

      return scored.sort((a, b) => b.score - a.score);
    } catch {
      // chat 打分也失败，直接返回原始顺序
      return chunks;
    }
  }

  /**
   * 解析 chat 打分响应中的分数。
   * @param content - 模型返回的文本。
   * @param maxIndex - 最大文档序号。
   * @returns 序号→分数的映射。
   */
  private parseScoreResponse(content: string, maxIndex: number): Map<number, number> {
    const scoreMap = new Map<number, number>();
    const lines = content.split('\n');

    for (const line of lines) {
      // 匹配 "序号:分数" 或 "序号：分数" 格式
      const match = line.match(/(\d+)[：:]\s*([0-9]*\.?[0-9]+)/);
      if (match) {
        const idx = parseInt(match[1], 10);
        const score = parseFloat(match[2]);
        if (idx >= 1 && idx <= maxIndex && score >= 0 && score <= 1) {
          scoreMap.set(idx, score);
        }
      }
    }

    return scoreMap;
  }
}
