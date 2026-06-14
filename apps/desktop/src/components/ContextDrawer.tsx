/**
 * ContextDrawer 组件 - 右侧上下文抽屉
 * 5 个 Tab：环境 / 计划 / 知识 / 运行 / 输出
 * 展示当前会话的上下文信息、诊断数据、知识库状态
 */

import React from 'react';
import { useUiStore } from '../stores/ui-store.js';
import type { RightPanelTab } from '../stores/ui-store.js';
import { useRunStore } from '../stores/run-store.js';
import { useKnowledgeStore } from '../stores/knowledge-store.js';
import { useWorkspaceStore } from '../stores/workspace-store.js';

/** Tab 定义 */
const TABS: Array<{ key: RightPanelTab; label: string; icon: string }> = [
  { key: 'environment', label: '环境', icon: '🖥️' },
  { key: 'plan', label: '计划', icon: '📋' },
  { key: 'knowledge', label: '知识', icon: '📚' },
  { key: 'run', label: '运行', icon: '⚡' },
  { key: 'output', label: '输出', icon: '📄' },
];

/** ContextDrawer 组件属性 */
interface ContextDrawerProps {
  /** 导入文件回调 */
  onAddKnowledge: () => void;
  /** 搜索知识库回调 */
  onSearchKnowledge: (query: string) => void;
}

/**
 * 右侧上下文抽屉
 */
export function ContextDrawer({ onAddKnowledge, onSearchKnowledge }: ContextDrawerProps): React.ReactElement {
  const { rightPanelTab, setRightPanelTab, drawerCollapsed, toggleDrawer } = useUiStore();

  if (drawerCollapsed) {
    return (
      <aside className="w-8 border-l bg-[var(--wa-bg-primary)] flex flex-col items-center py-2 gap-2" style={{ borderColor: 'var(--wa-border)' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setRightPanelTab(tab.key); toggleDrawer(); }}
            className="w-6 h-6 flex items-center justify-center rounded text-xs hover:bg-[var(--wa-bg-tertiary)] transition-colors"
            title={tab.label}
          >
            {tab.icon}
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="w-72 border-l bg-[var(--wa-bg-primary)] flex flex-col" style={{ borderColor: 'var(--wa-border)' }}>
      {/* Tab 栏 */}
      <div className="flex border-b" style={{ borderColor: 'var(--wa-border)' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setRightPanelTab(tab.key)}
            className={`flex-1 px-1 py-2 text-[10px] font-medium transition-colors ${
              rightPanelTab === tab.key
                ? 'text-[var(--wa-accent)] border-b-2 border-[var(--wa-accent)]'
                : 'text-[var(--wa-text-secondary)] hover:text-[var(--wa-text-primary)]'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
        {/* 折叠按钮 */}
        <button
          onClick={toggleDrawer}
          className="px-1 text-[var(--wa-text-secondary)] hover:text-[var(--wa-text-primary)] text-xs"
          title="折叠"
        >
          ▸
        </button>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {rightPanelTab === 'environment' && <EnvironmentTab />}
        {rightPanelTab === 'plan' && <PlanTab />}
        {rightPanelTab === 'knowledge' && <KnowledgeTab onAddKnowledge={onAddKnowledge} onSearchKnowledge={onSearchKnowledge} />}
        {rightPanelTab === 'run' && <RunTab />}
        {rightPanelTab === 'output' && <OutputTab />}
      </div>
    </aside>
  );
}

/**
 * 环境Tab - 当前环境信息
 */
function EnvironmentTab(): React.ReactElement {
  const { ollamaStatus, ollamaModel, mode, contextMetrics } = useRunStore();
  const { activeWorkspaceId, workspaceTree } = useWorkspaceStore();
  const activeWorkspace = workspaceTree.find((item) => item.id === activeWorkspaceId);

  return (
    <div className="p-3 space-y-3">
      <SectionTitle>模型配置</SectionTitle>
      <InfoRow label="模型" value={ollamaModel || '未配置'} />
      <InfoRow label="状态" value={ollamaStatus === 'running' ? '在线' : '离线'} />
      <InfoRow label="上下文长度" value={contextMetrics.contextLength.toLocaleString()} />
      <InfoRow label="当前模式" value={mode} />
      <InfoRow label="工作区" value={activeWorkspace?.name ?? '未绑定'} />

      <SectionTitle>权限模式</SectionTitle>
      <InfoRow label="权限策略" value="自动授权（一期）" />
    </div>
  );
}

/**
 * 计划Tab - 当前计划状态
 */
function PlanTab(): React.ReactElement {
  const { mode, planPhase } = useRunStore();

  const planSteps = [
    { key: 'PLAN_COLLECT', label: '收集需求', icon: '📋' },
    { key: 'PLAN_RESEARCH', label: '材料研读', icon: '📖' },
    { key: 'PLAN_DRAFT', label: '生成提纲', icon: '📝' },
    { key: 'PLAN_REVIEW', label: '审查批准', icon: '✅' },
    { key: 'EXECUTE_DRAFT', label: '撰写草稿', icon: '✍️' },
    { key: 'EXECUTE_EXPORT', label: '导出文档', icon: '📄' },
  ];

  const currentStepIndex = planSteps.findIndex(s => s.key === planPhase);

  return (
    <div className="p-3 space-y-3">
      <SectionTitle>计划流程</SectionTitle>
      {mode !== 'plan' && mode !== 'execute' ? (
        <p className="text-xs text-[var(--wa-text-secondary)]">当前为对话模式，无活跃计划</p>
      ) : (
        <div className="space-y-2">
          {planSteps.map((step, i) => {
            const isCompleted = i < currentStepIndex;
            const isCurrent = i === currentStepIndex;
            return (
              <div key={step.key} className="flex items-center gap-2.5 text-xs">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${
                  isCompleted ? 'bg-emerald-500/20 text-emerald-400' :
                  isCurrent ? 'bg-[var(--wa-accent)]/20 text-[var(--wa-accent)] ring-1 ring-[var(--wa-accent)]/40' :
                  'bg-[var(--wa-bg-tertiary)] text-[var(--wa-text-secondary)]'
                }`}>
                  {isCompleted ? '✓' : step.icon}
                </div>
                <span className={isCompleted ? 'text-[var(--wa-text-primary)]' : isCurrent ? 'text-[var(--wa-accent)]' : 'text-[var(--wa-text-secondary)]'}>
                  {step.label}
                </span>
                {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-[var(--wa-accent)] animate-pulse" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 知识Tab - 知识库状态
 */
function KnowledgeTab({ onAddKnowledge, onSearchKnowledge }: { onAddKnowledge: () => void; onSearchKnowledge: (query: string) => void }): React.ReactElement {
  const { knowledgeEntries, searchResults, activeCitations, selectedEntryIds, setSelectedEntryIds } = useKnowledgeStore();
  const { activeWorkspaceId, workspaceTree } = useWorkspaceStore();
  const [searchQuery, setSearchQuery] = React.useState('');

  const handleSearch = () => {
    if (searchQuery.trim()) {
      onSearchKnowledge(searchQuery);
    }
  };

  return (
    <div className="p-3 space-y-3">
      <SectionTitle>知识库</SectionTitle>
      <InfoRow label="当前工作区" value={activeWorkspaceId ?? '全部'} />
      <div className="flex gap-1">
        <button
          onClick={() => setSelectedEntryIds(knowledgeEntries.map((entry) => entry.id))}
          className="px-2 py-1 rounded text-[10px] bg-[var(--wa-bg-tertiary)] border border-[var(--wa-border)]/50"
        >
          全选
        </button>
        <button
          onClick={() => setSelectedEntryIds([])}
          className="px-2 py-1 rounded text-[10px] bg-[var(--wa-bg-tertiary)] border border-[var(--wa-border)]/50"
        >
          清空
        </button>
        <button
          onClick={async () => {
            const target = workspaceTree.find((workspace) => workspace.id !== activeWorkspaceId);
            if (!target || selectedEntryIds.length === 0) return;
            await window.workagent?.knowledgeMove(selectedEntryIds, target.id);
          }}
          className="px-2 py-1 rounded text-[10px] bg-[var(--wa-accent)]/10 border border-[var(--wa-accent)]/30"
        >
          迁移
        </button>
        <button
          onClick={async () => {
            if (selectedEntryIds.length === 0) return;
            await window.workagent?.knowledgeRemoveBatch(selectedEntryIds);
            setSelectedEntryIds([]);
          }}
          className="px-2 py-1 rounded text-[10px] bg-[var(--wa-error)]/10 border border-[var(--wa-error)]/30"
        >
          批删
        </button>
      </div>

      {/* 导入文件 */}
      <button
        onClick={onAddKnowledge}
        className="w-full px-3 py-2 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-400 text-xs font-medium transition-colors text-center border border-emerald-600/25"
      >
        + 导入文件
      </button>
      <p className="text-[10px] text-[var(--wa-text-secondary)]">支持 docx / pptx / pdf / txt / md</p>

      {/* 搜索 */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          placeholder="搜索知识库..."
          className="flex-1 bg-[var(--wa-bg-tertiary)] border border-[var(--wa-border)]/50 rounded px-2.5 py-1.5 text-xs text-[var(--wa-text-primary)] placeholder-[var(--wa-text-secondary)] focus:outline-none focus:border-[var(--wa-border)]"
        />
        <button
          onClick={handleSearch}
          className="px-2.5 py-1.5 bg-[var(--wa-bg-tertiary)] hover:bg-[var(--wa-border)] rounded text-xs text-[var(--wa-text-secondary)] transition-colors border border-[var(--wa-border)]/50"
        >
          🔍
        </button>
      </div>

      {/* 搜索结果 */}
      {searchResults.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          <div className="text-[10px] text-[var(--wa-text-secondary)]">搜索结果</div>
          {searchResults.map((r, i) => (
            <div key={i} className="px-2.5 py-1.5 bg-[var(--wa-bg-tertiary)]/50 rounded text-xs text-[var(--wa-text-secondary)] border border-[var(--wa-border)]/30">
              <div className="truncate">{r.content.slice(0, 80)}...</div>
              <div className="text-[10px] text-[var(--wa-text-secondary)] mt-0.5">{r.sourceFile} ({r.locator}) · {r.score.toFixed(2)}</div>
            </div>
          ))}
        </div>
      )}

      {/* 已导入文件 */}
      {knowledgeEntries.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-[var(--wa-text-secondary)]">已导入</div>
          {knowledgeEntries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-[var(--wa-bg-tertiary)]/40 text-xs">
              <input
                type="checkbox"
                checked={selectedEntryIds.includes(entry.id)}
                onChange={(event) => {
                  setSelectedEntryIds(event.target.checked
                    ? [...selectedEntryIds, entry.id]
                    : selectedEntryIds.filter((id) => id !== entry.id));
                }}
              />
              <span className="text-[var(--wa-text-secondary)]">{entry.type === 'docx' ? '📄' : entry.type === 'pptx' ? '📊' : entry.type === 'pdf' ? '📕' : '📝'}</span>
              <span className="text-[var(--wa-text-primary)] truncate flex-1">{entry.title}</span>
              <span className="text-[var(--wa-text-secondary)]">{entry.chunkCount}段</span>
            </div>
          ))}
        </div>
      )}

      {/* 活跃引用 */}
      {activeCitations.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-[var(--wa-text-secondary)]">当前引用 ({activeCitations.length})</div>
          {activeCitations.slice(0, 3).map((c, i) => (
            <div key={i} className="px-2 py-1 rounded bg-[var(--wa-accent)]/10 text-[10px] text-[var(--wa-accent)] border border-[var(--wa-accent)]/20">
              {c.sourceFile} ({c.locator})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 运行Tab - 当前运行诊断数据
 */
function RunTab(): React.ReactElement {
  const { contextMetrics, diagnostics } = useRunStore();

  /** 计算预算分布百分比 */
  const total = contextMetrics.contextLength;
  const historyPct = total > 0 ? ((diagnostics.historyTokens / total) * 100).toFixed(1) : '0';
  const ragPct = total > 0 ? ((diagnostics.ragTokens / total) * 100).toFixed(1) : '0';
  const toolPct = total > 0 ? ((diagnostics.toolTokens / total) * 100).toFixed(1) : '0';
  const completionPct = total > 0 ? ((diagnostics.completionTokens / total) * 100).toFixed(1) : '0';

  return (
    <div className="p-3 space-y-3">
      <SectionTitle>运行诊断</SectionTitle>

      {/* 运行ID */}
      <InfoRow label="Run ID" value={diagnostics.runId ?? '无'} />
      <InfoRow
        label="重写器"
        value={diagnostics.ragDiagnostics?.queryRewriter
          ? `${diagnostics.ragDiagnostics.queryRewriter.name}${diagnostics.ragDiagnostics.queryRewriter.fallback ? ' (fallback)' : ''}`
          : '未知'}
      />
      <InfoRow
        label="重排器"
        value={diagnostics.ragDiagnostics?.reranker
          ? `${diagnostics.ragDiagnostics.reranker.name}${diagnostics.ragDiagnostics.reranker.fallback ? ' (fallback)' : ''}`
          : '未知'}
      />

      {/* Prompt 预算分布 */}
      <SectionTitle>Prompt 预算分布</SectionTitle>
      <BudgetBar label="历史" tokens={diagnostics.historyTokens} pct={historyPct} color="bg-blue-500" />
      <BudgetBar label="RAG" tokens={diagnostics.ragTokens} pct={ragPct} color="bg-[var(--wa-accent)]" />
      <BudgetBar label="工具" tokens={diagnostics.toolTokens} pct={toolPct} color="bg-emerald-500" />
      <BudgetBar label="补全" tokens={diagnostics.completionTokens} pct={completionPct} color="bg-purple-500" />

      {/* Compact boundary */}
      <SectionTitle>压缩状态</SectionTitle>
      <InfoRow label="压缩次数" value={String(contextMetrics.compactCount)} />
      <InfoRow label="上次释放" value={contextMetrics.lastCompactFreed > 0 ? `${contextMetrics.lastCompactFreed.toLocaleString()} tokens` : '无'} />
      {diagnostics.compactOccurred && (
        <div className="px-2 py-1 rounded bg-[var(--wa-accent)]/10 text-[10px] text-[var(--wa-accent)] border border-[var(--wa-accent)]/20">
          压缩已发生，释放 {diagnostics.compactFreedTokens.toLocaleString()} tokens
        </div>
      )}

      {/* Tool failure */}
      {(diagnostics.hadToolCall || diagnostics.toolParseFailed) && (
        <>
          <SectionTitle>工具调用</SectionTitle>
          <InfoRow label="有工具调用" value={diagnostics.hadToolCall ? '是' : '否'} />
          {diagnostics.toolParseFailed && (
            <div className="px-2 py-1 rounded bg-[var(--wa-error)]/10 text-[10px] text-[var(--wa-error)] border border-[var(--wa-error)]/20">
              ⚠️ 工具调用解析失败
            </div>
          )}
        </>
      )}

      {/* Plan transition */}
      {diagnostics.planTransition && (
        <>
          <SectionTitle>计划转换</SectionTitle>
          <InfoRow label="转换" value={diagnostics.planTransition} />
        </>
      )}

      {/* RAG */}
      {(diagnostics.ragHitCount > 0 || diagnostics.ragInjectedTokens > 0) && (
        <>
          <SectionTitle>RAG 注入</SectionTitle>
          <InfoRow label="命中片段" value={String(diagnostics.ragHitCount)} />
          <InfoRow label="注入 Tokens" value={diagnostics.ragInjectedTokens.toLocaleString()} />
        </>
      )}

      {/* 终止原因 */}
      {diagnostics.terminalReason && (
        <>
          <SectionTitle>终止原因</SectionTitle>
          <div className="px-2 py-1 rounded bg-[var(--wa-error)]/10 text-[10px] text-[var(--wa-error)] border border-[var(--wa-error)]/20">
            {diagnostics.terminalReason}
          </div>
        </>
      )}

      {diagnostics.recoverySnapshot && (
        <>
          <SectionTitle>恢复快照</SectionTitle>
          <InfoRow label="恢复Run" value={diagnostics.recoverySnapshot.runId} />
          <InfoRow label="终态" value={diagnostics.recoverySnapshot.terminalStatus ?? '未知'} />
          <InfoRow label="事件数" value={String(diagnostics.recoverySnapshot.totalEvents)} />
          <div className="px-2 py-1 rounded bg-[var(--wa-bg-tertiary)]/40 text-[10px] text-[var(--wa-text-secondary)] border border-[var(--wa-border)]/30">
            {diagnostics.recoverySnapshot.lastAssistantContent || '无最近助手输出'}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 输出Tab - 草稿摘要/导出目标
 */
function OutputTab(): React.ReactElement {
  const { diagnostics } = useRunStore();
  const output = diagnostics.output;

  return (
    <div className="p-3 space-y-3">
      <SectionTitle>输出</SectionTitle>
      {!output?.docPath && !output?.draftContent ? (
        <>
          <p className="text-xs text-[var(--wa-text-secondary)]">暂无活跃输出</p>
          <p className="text-[10px] text-[var(--wa-text-secondary)]">
            在 Plan 模式下完成草稿后，输出将显示在此处
          </p>
        </>
      ) : (
        <>
          {output.docPath && (
            <>
              <InfoRow label="文档路径" value={output.docPath} />
              <div className="px-2 py-1 rounded bg-[var(--wa-bg-tertiary)]/40 text-[10px] text-[var(--wa-text-secondary)] border border-[var(--wa-border)]/30 break-all">
                {output.docPath}
              </div>
            </>
          )}
          {output.draftContent && (
            <>
              <InfoRow label="草稿格式" value="markdown" />
              <div className="px-2 py-1 rounded bg-[var(--wa-bg-tertiary)]/40 text-[10px] text-[var(--wa-text-secondary)] border border-[var(--wa-border)]/30 whitespace-pre-wrap">
                {output.draftContent.slice(0, 300)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// 通用子组件
// ============================================================

/** 区块标题 */
function SectionTitle({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <h4 className="text-[10px] font-semibold text-[var(--wa-text-secondary)] uppercase tracking-wider">
      {children}
    </h4>
  );
}

/** 信息行 */
function InfoRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-[var(--wa-text-secondary)]">{label}</span>
      <span className="text-[var(--wa-text-primary)] font-mono tabular-nums">{value}</span>
    </div>
  );
}

/** 预算条 */
function BudgetBar({ label, tokens, pct, color }: { label: string; tokens: number; pct: string; color: string }): React.ReactElement {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-[var(--wa-text-secondary)]">{label}</span>
        <span className="text-[var(--wa-text-primary)] tabular-nums">{tokens.toLocaleString()} ({pct}%)</span>
      </div>
      <div className="w-full h-1 bg-[var(--wa-bg-tertiary)] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-300`} style={{ width: `${Math.min(parseFloat(pct), 100)}%` }} />
      </div>
    </div>
  );
}
