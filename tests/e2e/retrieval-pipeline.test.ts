import { describe, expect, it } from 'vitest';
import { RetrievalPipeline } from '@workagent/rag';

/**
 * 检索管道阶段顺序测试。
 */
describe('retrieval pipeline', () => {
  it('runs retrieval through named stages', async () => {
    const pipeline = new RetrievalPipeline(
      {
        async search() {
          return [
            {
              chunkId: 'chunk-1',
              content: '国发〔2024〕3号',
              locator: '第1段',
              score: 0.91,
              sourceFile: 'policy.txt',
              sourceType: 'txt',
            },
          ];
        },
      } as any,
      {
        async embed() {
          return [0.1, 0.2, 0.3];
        },
      } as any,
    );

    const result = await pipeline.retrieve({
      query: '国发〔2024〕3号',
      options: { topK: 5 },
    });

    expect(result.stageTimings.map((item) => item.stage)).toEqual([
      'normalize',
      'rewrite',
      'dense',
      'sparse',
      'fusion',
      'rerank',
      'grade',
      'truncate',
      'pack',
    ]);
  });
});
