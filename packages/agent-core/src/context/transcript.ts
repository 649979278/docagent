/**
 * 会话转录持久化。
 * 以 JSONL 形式按 run 追加事件，便于恢复和排障。
 */

import fs from 'node:fs';
import path from 'node:path';

import type { AgentEventEnvelope } from '@workagent/shared';

/**
 * 转录持久化器。
 */
export class TranscriptStore {
  /** 转录目录。 */
  private readonly transcriptDir: string;

  /**
   * 创建转录存储。
   * @param transcriptDir - JSONL 文件目录。
   */
  constructor(transcriptDir: string) {
    this.transcriptDir = transcriptDir;
  }

  /**
   * 追加单条事件。
   * @param runId - 运行 ID。
   * @param event - 事件内容。
   */
  append(runId: string, event: AgentEventEnvelope): void {
    fs.mkdirSync(this.transcriptDir, { recursive: true });
    const transcriptPath = path.join(this.transcriptDir, `${runId}.jsonl`);
    fs.appendFileSync(transcriptPath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  /**
   * 写入会话摘要。
   * @param sessionId - 会话 ID。
   * @param summary - 摘要内容。
   */
  writeSessionSummary(sessionId: string, summary: string): void {
    fs.mkdirSync(this.transcriptDir, { recursive: true });
    const summaryPath = path.join(this.transcriptDir, `${sessionId}.md`);
    fs.writeFileSync(summaryPath, summary, 'utf8');
  }
}
