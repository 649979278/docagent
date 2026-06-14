/**
 * 知识库面板组件
 * 显示知识库内容，支持文件导入、搜索
 */

import React, { useState } from 'react';

/** 知识库条目 */
interface KnowledgeEntry {
  id: string;
  title: string;
  type: string;
  indexedAt: number;
  chunkCount: number;
}

/** 知识库面板组件属性 */
interface KnowledgePanelProps {
  /** 当前会话ID */
  sessionId: string | null;
  /** 是否处于Plan模式 */
  isPlanMode: boolean;
  /** Plan阶段 */
  planPhase: string;
  /** 导入文件回调 */
  onAddKnowledge: () => void;
  /** 搜索知识库回调 */
  onSearchKnowledge: (query: string) => void;
  /** 工作代理API */
  api: typeof window.workagent;
}

/**
 * 知识库面板
 * Codex风格右侧面板：知识库管理 + Plan模式状态
 */
export function KnowledgePanel({
  sessionId,
  isPlanMode,
  planPhase,
  onAddKnowledge,
  onSearchKnowledge,
  api,
}: KnowledgePanelProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);
  const [searchResults, setSearchResults] = useState<Array<{ text: string; score: number }>>([]);

  /** 执行知识库搜索 */
  const handleSearch = async () => {
    if (!searchQuery.trim() || !api) return;
    try {
      const results = await api.searchKnowledge(searchQuery, 5);
      setSearchResults(Array.isArray(results) ? results : []);
    } catch {
      setSearchResults([]);
    }
  };

  /** Plan模式步骤定义 */
  const planSteps = [
    { key: 'PLAN_COLLECT', label: '收集需求', icon: '📋' },
    { key: 'PLAN_RESEARCH', label: '材料研读', icon: '📖' },
    { key: 'PLAN_OUTLINE', label: '生成提纲', icon: '📝' },
    { key: 'PLAN_APPROVE', label: '审查批准', icon: '✅' },
    { key: 'EXECUTE_DRAFT', label: '撰写草稿', icon: '✍️' },
    { key: 'EXECUTE_EXPORT', label: '导出文档', icon: '📄' },
  ];

  /** 获取当前步骤的索引 */
  const currentStepIndex = planSteps.findIndex(s => s.key === planPhase);

  return (
    <aside className="w-72 border-l border-zinc-800 bg-zinc-950 flex flex-col">
      {/* 知识库标题 */}
      <div className="p-3 border-b border-zinc-800">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">知识库</h3>
      </div>

      {/* 导入文件 */}
      <div className="p-3">
        <button
          onClick={onAddKnowledge}
          disabled={!sessionId}
          className="w-full px-3 py-2 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-400 text-xs font-medium transition-colors text-center border border-emerald-600/25 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + 导入文件
        </button>
        <p className="text-[10px] text-zinc-600 mt-2">
          支持 docx / pptx / pdf / txt / md
        </p>
      </div>

      {/* 搜索知识库 */}
      <div className="px-3 pb-3">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            placeholder="搜索知识库..."
            className="flex-1 bg-zinc-800 border border-zinc-700/50 rounded px-2.5 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
          />
          <button
            onClick={handleSearch}
            className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs text-zinc-400 transition-colors border border-zinc-700/50"
          >
            🔍
          </button>
        </div>
        {/* 搜索结果 */}
        {searchResults.length > 0 && (
          <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
            {searchResults.map((r, i) => (
              <div key={i} className="px-2.5 py-1.5 bg-zinc-800/50 rounded text-xs text-zinc-400 border border-zinc-700/30">
                <div className="truncate">{r.text || JSON.stringify(r)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 已导入文件列表 */}
      {knowledgeEntries.length > 0 && (
        <div className="px-3 pb-3">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">已导入</div>
          <div className="space-y-1">
            {knowledgeEntries.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-zinc-800/40 text-xs">
                <span className="text-zinc-500">{entry.type === 'docx' ? '📄' : entry.type === 'pptx' ? '📊' : entry.type === 'pdf' ? '📕' : '📝'}</span>
                <span className="text-zinc-300 truncate flex-1">{entry.title}</span>
                <span className="text-zinc-600">{entry.chunkCount}段</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plan模式状态 */}
      {isPlanMode && (
        <div className="p-3 border-t border-zinc-800">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2.5">计划流程</h3>
          <div className="space-y-2">
            {planSteps.map((step, i) => {
              const isCompleted = i < currentStepIndex;
              const isCurrent = i === currentStepIndex;
              return (
                <div key={step.key} className="flex items-center gap-2.5 text-xs">
                  {/* 步骤指示器 */}
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${
                    isCompleted ? 'bg-emerald-500/20 text-emerald-400' :
                    isCurrent ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40' :
                    'bg-zinc-800 text-zinc-600'
                  }`}>
                    {isCompleted ? '✓' : step.icon}
                  </div>
                  {/* 步骤名称 */}
                  <span className={isCompleted ? 'text-zinc-300' : isCurrent ? 'text-amber-300' : 'text-zinc-600'}>
                    {step.label}
                  </span>
                  {/* 当前步骤脉冲 */}
                  {isCurrent && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 底部填充 */}
      <div className="flex-1" />

      {/* 帮助提示 */}
      <div className="p-3 border-t border-zinc-800">
        <p className="text-[10px] text-zinc-600">
          💡 提示：导入参考文档后，Agent可在写作时引用相关知识
        </p>
      </div>
    </aside>
  );
}
