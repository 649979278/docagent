/**
 * 对话头部右侧环境信息浮窗。
 * 以按钮锚定的方式展示当前目录、模型、上下文、知识库和计划摘要。
 */

import React, { useMemo, useRef, useState } from 'react';
import { useRunStore } from '../stores/run-store.js';
import { useWorkspaceStore } from '../stores/workspace-store.js';
import { useKnowledgeStore } from '../stores/knowledge-store.js';
import { useSettingsStore } from '../stores/settings-store.js';
import { useSessionStore } from '../stores/session-store.js';
import { FloatingLayer } from './floating-layer.js';

/** 环境浮窗属性。 */
interface EnvironmentPopoverProps {
  /** 导入知识回调。 */
  onAddKnowledge: () => void;
}

/**
 * 右上环境信息浮窗组件。
 */
export function EnvironmentPopover({ onAddKnowledge }: EnvironmentPopoverProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const { ollamaStatus, ollamaModel, mode, diagnostics, contextMetrics, planPhase } = useRunStore();
  const { activeWorkspaceId, workspaceTree } = useWorkspaceStore();
  const knowledgeEntries = useKnowledgeStore((state) => state.knowledgeEntries);
  const { activeModel } = useSettingsStore();
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeWorkspace = workspaceTree.find((workspace) => workspace.id === activeWorkspaceId);
  const isOnline = ollamaStatus === 'running';
  const displayModel = activeModel || ollamaModel || 'qwen3.5:9b';
  const contextPercent = Math.min(100, Math.max(0, contextMetrics.usedPercentage || 0));
  const compactRemaining = Math.max(0, 100 - contextPercent);
  const activePlanId = diagnostics.activePlanId ?? null;
  const hasActivePlan = mode !== 'chat' && Boolean(diagnostics.activePlanSnapshot);
  const planSummary = hasActivePlan && diagnostics.activePlanSnapshot
    ? String((diagnostics.activePlanSnapshot as Record<string, unknown>).title ?? (diagnostics.activePlanSnapshot as Record<string, unknown>).goal ?? '计划已生成')
    : null;
  const activeSummary = planSummary
    ?? (diagnostics.output?.draftContent
      ? `已生成草稿，长度 ${diagnostics.output.draftContent.length} 字符`
      : hasActivePlan
        ? '当前会话处于计划/执行链路中'
        : '当前会话暂无计划摘要');
  const popoverStatus = useMemo(() => {
    if (isOnline) return '模型在线';
    if (ollamaStatus === 'checking') return '检测中';
    return '模型离线';
  }, [isOnline, ollamaStatus]);

  /**
   * 审批当前计划。
   * @param approved - 是否批准。
   */
  const approvePlan = (approved: boolean): void => {
    if (!activePlanId || !currentSessionId) return;
    void window.workagent?.approvePlan(activePlanId, approved, currentSessionId);
    if (!approved) {
      useRunStore.getState().resetSessionRuntime('chat');
    }
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((value) => !value)}
        data-wa-menu="true"
        className="inline-flex h-9 items-center gap-2 rounded-full border border-[#323232] bg-[#212121] px-3.5 text-[#d7d7d7] shadow-[0_6px_24px_rgba(0,0,0,0.18)] transition-colors hover:bg-[#2b2b2b]"
        title="环境信息"
      >
        <PopoverTriggerIcon />
        <span className={`h-2 w-2 rounded-full ${isOnline ? 'bg-[#78ce86]' : 'bg-[#f0a33a]'}`} />
        <span className="wa-label text-[#d7d7d7]">{popoverStatus}</span>
        <TinyChevronIcon open={open} />
      </button>

      <FloatingLayer
        open={open}
        anchorRef={triggerRef}
        placement="bottom-end"
        className="w-[340px]"
        onClose={() => setOpen(false)}
      >
        <aside
          data-wa-menu="true"
          className="max-h-[calc(100vh-120px)] overflow-y-auto rounded-2xl border border-[#363636] bg-[#2a2a2a]/98 p-4 wa-body text-[#d4d4d4] shadow-[0_24px_80px_rgba(0,0,0,0.48)] backdrop-blur wa-scrollbar"
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="wa-body font-medium text-[#ededed]">环境信息</div>
              <div className="wa-meta text-[#8f8f8f]">{mode === 'chat' ? '对话模式' : `${mode} · ${planPhase}`}</div>
            </div>
            <button onClick={() => setOpen(false)} className="wa-control-button wa-control-button--icon text-[#8e8e8e] hover:bg-[#343434] hover:text-[#f1f1f1]">
              <CloseIcon />
            </button>
          </div>

          <div className="space-y-2.5">
            <InfoLine icon={<FolderMiniIcon />} label="当前目录" value={activeWorkspace?.rootPath ?? '未选择项目'} />
            <InfoLine icon={<ModelMiniIcon />} label="模型" value={displayModel} valueClass={isOnline ? 'text-[#7dd38b]' : 'text-[#f0a33a]'} />
            <div className="flex items-center gap-3 rounded-xl bg-[#232323] p-3">
              <ContextRing percent={contextPercent} />
              <div className="min-w-0">
                <div className="wa-body text-[#e8e8e8]">上下文 {Math.round(contextPercent)}%</div>
                <div className="wa-meta text-[#9a9a9a]">
                  {contextMetrics.usedTokens} / {contextMetrics.contextLength} tokens
                </div>
                <div className="wa-meta text-[#7f7f7f]">距自动压缩约 {Math.round(compactRemaining)}%</div>
              </div>
            </div>
            <InfoLine icon={<StackMiniIcon />} label="知识库" value={`${knowledgeEntries.length} 个文档`} />
          </div>

          <div className="my-4 h-px bg-[#3b3b3b]" />

          <div className="space-y-1.5">
            <div className="wa-label text-[#8d8d8d]">当前摘要</div>
            <div className="rounded-xl bg-[#232323] px-3 py-2 text-[#d8d8d8]">{activeSummary}</div>
            <div className="wa-label pt-1 text-[#8d8d8d]">检索来源</div>
            <div className="text-[#a6a6a6]">{diagnostics.ragHitCount > 0 ? `${diagnostics.ragHitCount} 条引用` : '暂无来源'}</div>
            {mode === 'plan' && planPhase === 'PLAN_REVIEW' && activePlanId && currentSessionId && (
              <div className="mt-3 rounded-xl border border-[#4a3621] bg-[#231b12] p-3">
                <div className="wa-body text-[#f1d2a1]">计划已生成，等待审批</div>
                <div className="mt-1 wa-label text-[#b89d78]">批准后将在下一轮正式进入执行阶段。</div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => approvePlan(true)}
                    className="rounded-full bg-[#f0a33a] px-3 py-1.5 text-[#1d1a16] hover:bg-[#f4b257]"
                  >
                    批准执行
                  </button>
                  <button
                    onClick={() => approvePlan(false)}
                    className="rounded-full border border-[#4c3b30] px-3 py-1.5 text-[#d6b497] hover:bg-[#35271d]"
                  >
                    拒绝计划
                  </button>
                </div>
              </div>
            )}
            <button
              onClick={onAddKnowledge}
              className="mt-2 wa-row w-full rounded-lg border border-[#383838] px-3 py-2 text-left text-[#cfcfcf] hover:bg-[#333333]"
            >
              <RefreshMiniIcon />
              <span>添加知识文档</span>
            </button>
          </div>
        </aside>
      </FloatingLayer>
    </div>
  );
}

/**
 * 上下文使用量圆环。
 */
function ContextRing({ percent }: { percent: number }): React.ReactElement {
  const stroke = 2 * Math.PI * 17;
  const offset = stroke - (stroke * percent) / 100;
  return (
    <svg width="42" height="42" viewBox="0 0 42 42" className="shrink-0">
      <circle cx="21" cy="21" r="17" stroke="#454545" strokeWidth="4" fill="none" />
      <circle
        cx="21"
        cy="21"
        r="17"
        stroke={percent > 80 ? '#f0a33a' : '#7dd38b'}
        strokeWidth="4"
        fill="none"
        strokeDasharray={stroke}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 21 21)"
      />
      <text x="21" y="24" textAnchor="middle" className="fill-[#d8d8d8] wa-meta">{Math.round(percent)}</text>
    </svg>
  );
}

/**
 * 环境浮窗信息行。
 */
function InfoLine({
  icon,
  label,
  value,
  valueClass = 'text-[#a7a7a7]',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}): React.ReactElement {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-[#232323] px-3 py-2">
      <span className="wa-icon mt-0.5 text-[#a1a1a1]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block wa-label text-[#8d8d8d]">{label}</span>
        <span className={`block break-all ${valueClass}`}>{value}</span>
      </span>
    </div>
  );
}

/**
 * 浮窗触发按钮图标。
 */
function PopoverTriggerIcon(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5a7 7 0 0 0-7 7v1.8c0 .7-.2 1.4-.7 1.9L3 17h18l-1.3-1.3c-.5-.5-.7-1.2-.7-1.9V12a7 7 0 0 0-7-7Z" />
      <path d="M9.5 20a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

/**
 * 微型下拉箭头。
 */
function TinyChevronIcon({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={open ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  );
}

/**
 * 关闭图标。
 */
function CloseIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/**
 * 小型文件夹图标。
 */
function FolderMiniIcon(): React.ReactElement {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3.5 7.5h6l2 2h9v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z" /></svg>;
}

/**
 * 小型模型图标。
 */
function ModelMiniIcon(): React.ReactElement {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 4 7v10l8 4 8-4V7l-8-4Zm0 8 8-4M12 11 4 7M12 11v10" /></svg>;
}

/**
 * 小型知识库图标。
 */
function StackMiniIcon(): React.ReactElement {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7l8-4 8 4-8 4-8-4Zm0 5 8 4 8-4M4 17l8 4 8-4" /></svg>;
}

/**
 * 小型刷新图标。
 */
function RefreshMiniIcon(): React.ReactElement {
  return <span className="wa-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v6h-6" /></svg></span>;
}
