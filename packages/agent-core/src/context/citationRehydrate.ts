/**
 * 引用重水合 - 根据计划中的引用ID重新取回关键RAG片段
 * 上下文压缩后，摘要中只保留了引用ID，需要重新取回完整片段内容
 */

import type { RetrievedChunk, Plan } from '@workagent/shared';
import type { KnowledgeIndex } from '@workagent/rag';

// ============================================================
// 引用重水合结果
// ============================================================

/** 引用重水合结果 */
export interface CitationRehydrateResult {
  /** 重水合后的片段列表 */
  chunks: RetrievedChunk[];
  /** 成功取回的片段数 */
  rehydratedCount: number;
  /** 未能取回的引用ID列表 */
  missingIds: string[];
}

// ============================================================
// 引用重水合函数
// ============================================================

/**
 * 根据计划中的引用ID重新取回关键RAG片段
 * 在上下文压缩后，摘要中只保留了引用ID
 * 重水合可以在生成草稿时提供完整的材料内容
 * @param plan - 当前计划（包含citations列表）
 * @param knowledgeIndex - 知识库索引实例
 * @returns 重水合结果
 */
export async function citationRehydrate(
  plan: Plan | null,
  knowledgeIndex: KnowledgeIndex | null,
): Promise<CitationRehydrateResult> {
  if (!plan || !knowledgeIndex) {
    return { chunks: [], rehydratedCount: 0, missingIds: [] };
  }

  const citationIds = plan.outline.citations;
  if (!citationIds || citationIds.length === 0) {
    return { chunks: [], rehydratedCount: 0, missingIds: [] };
  }

  const chunks: RetrievedChunk[] = [];
  const missingIds: string[] = [];

  // 逐个取回引用的片段
  for (const chunkId of citationIds) {
    try {
      // 使用getByChunkId直接按ID定位片段
      const result = await knowledgeIndex.getByChunkId(chunkId);

      if (result) {
        chunks.push(result);
      } else {
        missingIds.push(chunkId);
      }
    } catch {
      missingIds.push(chunkId);
    }
  }

  return {
    chunks,
    rehydratedCount: chunks.length,
    missingIds,
  };
}

/**
 * 从消息内容中提取引用ID
 * 用于从压缩摘要中提取残留的引用ID
 * @param content - 消息内容
 * @returns 引用ID列表
 */
export function extractCitationIds(content: string): string[] {
  const ids: string[] = [];
  // 匹配形如 [ref:chunk-xxx] 或 citation:chunk-xxx 的引用标记
  const regex = /\[ref:([^\]]+)\]|citation:([^\s,\]]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const id = match[1] || match[2];
    if (id) {
      ids.push(id);
    }
  }

  return ids;
}

/**
 * 格式化RAG片段为上下文注入文本
 * @param chunks - RAG片段列表
 * @returns 格式化后的文本
 */
export function formatChunksForContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '';

  const parts = chunks.map((chunk, index) => {
    return `[引用${index + 1}] 来源: ${chunk.sourceFile} (${chunk.locator})\n${chunk.content}`;
  });

  return `## 参考材料\n\n${parts.join('\n\n---\n\n')}`;
}
