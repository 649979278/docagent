import React from 'react';
import { useRunStore } from '../stores/run-store.js';

const PLAN_PHASES = [
  { key: 'PLAN_COLLECT', label: '收集需求' },
  { key: 'PLAN_RESEARCH', label: '材料研读' },
  { key: 'PLAN_DRAFT', label: '生成提纲' },
  { key: 'PLAN_REVIEW', label: '待审批' },
  { key: 'EXECUTE_DRAFT', label: '撰写草稿' },
  { key: 'EXECUTE_EXPORT', label: '导出文档' },
];

/**
 * 计划可视化组件。
 * 以紧凑时间线形式展示当前阶段和模式建议。
 */
export function PlanVisualizer(): React.ReactElement {
  const { planPhase, diagnostics } = useRunStore();
  const currentIndex = PLAN_PHASES.findIndex((item) => item.key === planPhase);

  return (
    <section className="rounded-lg border border-[var(--wa-border)]/50 bg-[var(--wa-bg-tertiary)]/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-[var(--wa-text-secondary)]">计划阶段</div>
        {diagnostics.activePlanId && (
          <div className="text-[10px] text-[var(--wa-text-secondary)]">{diagnostics.activePlanId}</div>
        )}
      </div>
      <div className="space-y-2">
        {PLAN_PHASES.map((phase, index) => {
          const isDone = index < currentIndex;
          const isCurrent = index === currentIndex;
          return (
            <div key={phase.key} className="flex items-center gap-2 text-xs">
              <div className={`h-2.5 w-2.5 rounded-full ${isDone ? 'bg-emerald-500' : isCurrent ? 'bg-[var(--wa-accent)]' : 'bg-[var(--wa-border)]'}`} />
              <span className={isCurrent ? 'text-[var(--wa-text-primary)]' : 'text-[var(--wa-text-secondary)]'}>{phase.label}</span>
            </div>
          );
        })}
      </div>
      {diagnostics.modeSuggestion && (
        <div className="mt-3 rounded border border-[var(--wa-accent)]/30 bg-[var(--wa-accent)]/10 px-2.5 py-2 text-xs text-[var(--wa-accent)]">
          建议切换到 {diagnostics.modeSuggestion.suggestedMode} 模式：{diagnostics.modeSuggestion.reason}
        </div>
      )}
    </section>
  );
}
