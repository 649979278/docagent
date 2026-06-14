/**
 * Session 恢复 - 从 transcript JSONL 恢复会话状态
 *
 * 恢复流程：
 * 1. 通过 RunLookupStore 查找指定 session 最新的 run
 * 2. 读取对应 runId 的 transcript JSONL 文件
 * 3. 解析事件序列，重建最后状态快照
 * 4. 返回恢复信息供 UI 展示（标记 terminal status）
 *
 * 设计要点：
 * - RunLookupStore 为注入接口，agent-core 不依赖 @workagent/store
 * - 恢复只读不写，不会修改任何持久化数据
 * - UI 通过 terminalStatus 判断是否需要人工确认
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AgentEventEnvelope } from '@workagent/shared';

// ============================================================
// 注入接口
// ============================================================

/**
 * 数据库查询接口（注入，避免依赖 @workagent/store）。
 * 用于查找 session 最新的 run 信息。
 */
export interface RunLookupStore {
  /**
   * 查找指定 session 最新的 run ID 及状态。
   * @param sessionId - 会话 ID。
   * @returns 最新 run 的 ID 和状态，或 null。
   */
  getLatestRun(sessionId: string): {
    runId: string;
    status: string;
    terminalReason: string | null;
  } | null;
}

// ============================================================
// 恢复结果
// ============================================================

/** 会话恢复快照 */
export interface SessionResumeSnapshot {
  /** 恢复的 run ID */
  runId: string;
  /** 最后事件序号 */
  lastSequence: number;
  /** 终端状态（UI 用此标记是否需要人工确认） */
  terminalStatus: string | null;
  /** 最后一条助手消息内容 */
  lastAssistantContent: string;
  /** 活跃计划快照（如有） */
  activePlanSnapshot: Record<string, unknown> | null;
  /** 恢复的事件总数 */
  totalEvents: number;
  /** transcript 文件路径 */
  transcriptPath: string;
}

// ============================================================
// 恢复函数
// ============================================================

/**
 * 从 transcript JSONL 恢复会话状态快照。
 * 恢复最新 run 快照，UI 标记 terminal status。
 *
 * @param sessionId - 会话 ID。
 * @param transcriptDir - transcript 存储目录。
 * @param runLookup - 数据库查询接口。
 * @returns 恢复的状态快照，或 null。
 */
export function resumeSession(
  sessionId: string,
  transcriptDir: string,
  runLookup: RunLookupStore,
): SessionResumeSnapshot | null {
  // 1. 查找最新 run
  const latestRun = runLookup.getLatestRun(sessionId);
  if (!latestRun) return null;

  // 2. 读取 transcript JSONL
  const filePath = path.join(transcriptDir, `${latestRun.runId}.jsonl`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    if (lines.length === 0) return null;

    // 3. 解析事件序列，提取关键信息
    let lastSequence = 0;
    let lastAssistantContent = '';
    let activePlanSnapshot: Record<string, unknown> | null = null;

    for (const line of lines) {
      try {
        const event: AgentEventEnvelope = JSON.parse(line);
        lastSequence = Math.max(lastSequence, event.sequence);

        // 提取最后一条助手消息
        if (event.type === 'token' && event.data) {
          const data = event.data as { text: string };
          // 只取最后一段 token 的开头（避免累积过长）
          if (data.text) {
            lastAssistantContent = data.text.slice(0, 200);
          }
        }

        // 提取计划快照
        if (event.type === 'plan_generated' || event.type === 'plan_approved') {
          const data = event.data as { plan: Record<string, unknown> };
          if (data.plan) {
            activePlanSnapshot = data.plan;
          }
        }
      } catch {
        // 单行解析失败不影响其他行
      }
    }

    return {
      runId: latestRun.runId,
      lastSequence,
      terminalStatus: latestRun.status,
      lastAssistantContent,
      activePlanSnapshot,
      totalEvents: lines.length,
      transcriptPath: filePath,
    };
  } catch {
    return null;
  }
}
