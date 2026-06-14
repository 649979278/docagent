/**
 * 会话摘要持久化。
 * 将 Session Memory Lite 结果落为 Markdown 文件。
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 会话摘要持久化器。
 */
export class SessionMemoryPersist {
  /** 摘要目录。 */
  private readonly summaryDir: string;

  /**
   * 创建摘要持久化器。
   * @param summaryDir - 会话摘要目录。
   */
  constructor(summaryDir: string) {
    this.summaryDir = summaryDir;
  }

  /**
   * 写入会话摘要。
   * @param sessionId - 会话 ID。
   * @param summary - 摘要正文。
   */
  save(sessionId: string, summary: string): void {
    fs.mkdirSync(this.summaryDir, { recursive: true });
    const filePath = path.join(this.summaryDir, `${sessionId}.md`);
    const content = `## 会话摘要\n\n${summary}`.trimEnd() + '\n';
    fs.writeFileSync(filePath, content, 'utf8');
  }

  /**
   * 读取会话摘要。
   * @param sessionId - 会话 ID。
   * @returns 摘要内容，不存在时返回 null。
   */
  load(sessionId: string): string | null {
    const filePath = path.join(this.summaryDir, `${sessionId}.md`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf8');
  }
}
