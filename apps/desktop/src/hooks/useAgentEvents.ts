/**
 * useAgentEvents Hook
 * 封装 Agent 事件监听逻辑，包括：
 * - token/text 事件：累积助手内容
 * - thinking 事件：累积思考内容
 * - tool_start/tool_result 事件：更新工具调用状态
 * - usage 事件：更新上下文指标
 * - compact 事件：更新压缩状态
 * - phase_change 事件：更新 Plan 阶段（修正 plan_phase → phase_change）
 * - mode_change 事件：更新模式
 * - done/error 事件：完成/错误处理
 */

import { useEffect, useRef } from 'react';
import { useMessageStore } from '../stores/message-store.js';
import { useRunStore } from '../stores/run-store.js';
import { useKnowledgeStore } from '../stores/knowledge-store.js';

/** Agent 事件信封 */
interface AgentEventEnvelope {
  sessionId: string;
  turnId: string;
  sequence: number;
  type: string;
  data: unknown;
  createdAt: number;
  runId?: string;
}

/**
 * Agent 事件监听 Hook
 * @returns refs 用于跨事件共享状态
 */
export function useAgentEvents(): {
  assistantContentRef: React.MutableRefObject<string>;
  assistantThinkingRef: React.MutableRefObject<string>;
  assistantMsgIdRef: React.MutableRefObject<string>;
  isThinkingRef: React.MutableRefObject<boolean>;
} {
  const assistantContentRef = useRef<string>('');
  const assistantThinkingRef = useRef<string>('');
  const assistantMsgIdRef = useRef<string>('');
  const isThinkingRef = useRef<boolean>(false);

  useEffect(() => {
    const api = window.workagent;
    if (!api) return;

    const unsub = api.onAgentEvent((rawEvent: unknown) => {
      const event = rawEvent as AgentEventEnvelope;

      switch (event.type) {
        case 'token':
        case 'text': {
          const data = event.data as { text: string };
          assistantContentRef.current += data.text;
          isThinkingRef.current = false;
          const content = assistantContentRef.current;
          const msgId = assistantMsgIdRef.current;
          useMessageStore.getState().updateMessage(msgId, { content });
          break;
        }

        case 'thinking': {
          const data = event.data as { text: string };
          if (data.text) {
            assistantThinkingRef.current += data.text;
            isThinkingRef.current = true;
            const msgId = assistantMsgIdRef.current;
            const msg = useMessageStore.getState().messages.find(m => m.id === msgId);
            useMessageStore.getState().updateMessage(msgId, {
              tokenCount: (msg?.tokenCount ?? 0) + data.text.length,
            });
          }
          break;
        }

        case 'tool_start': {
          const data = event.data as { name: string };
          const msgId = assistantMsgIdRef.current;
          const msg = useMessageStore.getState().messages.find(m => m.id === msgId);
          useMessageStore.getState().updateMessage(msgId, {
            toolCalls: [...(msg?.toolCalls || []), { name: data.name, status: 'running' as const }],
          });
          break;
        }

        case 'tool_result': {
          const data = event.data as { name: string; summary?: string };
          const msgId = assistantMsgIdRef.current;
          const msg = useMessageStore.getState().messages.find(m => m.id === msgId);
          const calls = msg?.toolCalls || [];
          useMessageStore.getState().updateMessage(msgId, {
            toolCalls: calls.map(c => c.name === data.name ? { ...c, status: 'done' as const, summary: data.summary } : c),
          });
          break;
        }

        case 'usage': {
          const data = event.data as { promptTokens: number; completionTokens: number; contextLength?: number };
          const { contextMetrics } = useRunStore.getState();
          const usedTokens = data.promptTokens + data.completionTokens;
          const contextLength = data.contextLength ?? contextMetrics.contextLength;
          useRunStore.getState().setContextMetrics({
            usedTokens,
            contextLength,
            usedPercentage: (usedTokens / contextLength) * 100,
          });
          break;
        }

        case 'compact': {
          const data = event.data as { freedTokens: number; level: number };
          const { contextMetrics } = useRunStore.getState();
          useRunStore.getState().setContextMetrics({
            lastCompactFreed: data.freedTokens,
            compactCount: contextMetrics.compactCount + 1,
          });
          break;
        }

        case 'phase_change': {
          const data = event.data as { phase: string };
          useRunStore.getState().setPlanPhase(data.phase);
          break;
        }

        case 'plan_generated': {
          const data = event.data as { plan: { id: string } & Record<string, unknown> };
          useRunStore.getState().setDiagnostics({
            activePlanId: data.plan.id,
            activePlanSnapshot: data.plan,
            recoverySnapshot: {
              ...(useRunStore.getState().diagnostics.recoverySnapshot ?? {
                runId: event.runId ?? '',
                terminalStatus: null,
                lastAssistantContent: '',
                activePlanSnapshot: null,
                totalEvents: 0,
                transcriptPath: '',
              }),
              activePlanSnapshot: data.plan,
            },
          });
          useRunStore.getState().setMode('plan');
          break;
        }

        case 'plan_approved': {
          const data = event.data as { plan: { id: string } & Record<string, unknown> };
          useRunStore.getState().setDiagnostics({
            activePlanId: data.plan.id,
            activePlanSnapshot: data.plan,
            recoverySnapshot: {
              ...(useRunStore.getState().diagnostics.recoverySnapshot ?? {
                runId: event.runId ?? '',
                terminalStatus: null,
                lastAssistantContent: '',
                activePlanSnapshot: null,
                totalEvents: 0,
                transcriptPath: '',
              }),
              activePlanSnapshot: data.plan,
            },
          });
          break;
        }

        case 'mode_change': {
          const data = event.data as { mode: 'chat' | 'plan' | 'execute' };
          useRunStore.getState().setMode(data.mode);
          break;
        }

        case 'mode_suggestion': {
          const data = event.data as { suggestedMode: 'chat' | 'plan' | 'execute'; reason: string };
          useRunStore.getState().setDiagnostics({
            modeSuggestion: {
              suggestedMode: data.suggestedMode,
              reason: data.reason,
            },
          });
          break;
        }

        case 'rag_enrich': {
          const data = event.data as { query: string; injected: boolean; chunkCount?: number; usedTokens?: number };
          if (data.injected && data.chunkCount) {
            useRunStore.getState().setDiagnostics({
              ragHitCount: data.chunkCount,
              ragInjectedTokens: data.usedTokens ?? 0,
            });
          }
          break;
        }

        case 'rag_diagnostics': {
          const data = event.data as {
            diagnostics: {
              queryRewriter: { name: string; fallback: boolean };
              reranker: { name: string; fallback: boolean };
              relevanceGrader: { name: string };
            };
          };
          useRunStore.getState().setDiagnostics({
            ragDiagnostics: data.diagnostics,
          });
          break;
        }

        case 'draft_ready': {
          const data = event.data as { content: string; format: 'markdown' };
          useRunStore.getState().setDiagnostics({
            output: {
              ...(useRunStore.getState().diagnostics.output ?? {}),
              draftContent: data.content,
              toolName: 'draft_outline',
            },
          });
          break;
        }

        case 'doc_ready': {
          const data = event.data as { filePath: string };
          useRunStore.getState().setDiagnostics({
            output: {
              ...(useRunStore.getState().diagnostics.output ?? {}),
              docPath: data.filePath,
              toolName: 'doc_write',
            },
          });
          break;
        }

        case 'run_status': {
          const data = event.data as { runId: string; status: 'running' | 'completed' | 'aborted' | 'failed'; terminalReason?: string };
          useRunStore.getState().setDiagnostics({
            runId: data.runId,
            runStatus: data.status,
            terminalReason: data.terminalReason ?? null,
          });
          break;
        }

        case 'index_progress': {
          const data = event.data as {
            job: {
              id: string;
              documentId: string;
              status: 'queued' | 'hashing' | 'extracting' | 'chunking' | 'embedding' | 'indexing' | 'indexed' | 'failed';
              progress: number;
              error: string | null;
            };
          };
          useKnowledgeStore.getState().updateIndexJob(data.job.id, {
            id: data.job.id,
            documentId: data.job.documentId,
            status: data.job.status,
            progress: data.job.progress,
            error: data.job.error,
          });
          break;
        }

        case 'compact_boundary': {
          const data = event.data as { boundaryId: string; strategy: string; freedTokens: number };
          useRunStore.getState().setDiagnostics({
            compactOccurred: true,
            compactFreedTokens: data.freedTokens,
          });
          break;
        }

        case 'done': {
          useMessageStore.getState().setLoading(false);
          assistantContentRef.current = '';
          assistantThinkingRef.current = '';
          assistantMsgIdRef.current = '';
          isThinkingRef.current = false;
          break;
        }

        case 'error': {
          const data = event.data as { message: string };
          const msgId = assistantMsgIdRef.current;
          if (msgId) {
            const msg = useMessageStore.getState().messages.find(m => m.id === msgId);
            useMessageStore.getState().updateMessage(msgId, {
              content: (msg?.content ?? '') + `\n\n⚠️ ${data.message}`,
            });
          }
          useMessageStore.getState().setLoading(false);
          assistantContentRef.current = '';
          assistantThinkingRef.current = '';
          assistantMsgIdRef.current = '';
          isThinkingRef.current = false;
          break;
        }
      }
    });

    const unsubOllama = api.onOllamaStatus((status: unknown) => {
      useRunStore.getState().setOllamaStatus(status as 'running' | 'not_installed' | 'start_failed');
    });

    return () => { unsub(); unsubOllama(); };
  }, []);

  return {
    assistantContentRef,
    assistantThinkingRef,
    assistantMsgIdRef,
    isThinkingRef,
  };
}
