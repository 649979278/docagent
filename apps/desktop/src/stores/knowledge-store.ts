/**
 * 知识库状态管理 Store
 * 管理知识库条目、索引任务、活跃引用
 */

import { create } from 'zustand';

/** 知识库条目 */
export interface KnowledgeEntry {
  id: string;
  title: string;
  type: string;
  indexedAt: number;
  chunkCount: number;
  status?: string;
  sourceWorkspaceId?: string | null;
  path?: string;
}

/** 索引任务状态 */
export interface IndexJobState {
  id: string;
  documentId: string;
  status: 'queued' | 'hashing' | 'extracting' | 'chunking' | 'embedding' | 'indexing' | 'indexed' | 'failed';
  progress: number;
  error: string | null;
}

/** 知识库搜索结果 */
export interface KnowledgeSearchResult {
  content: string;
  sourceFile: string;
  sourceType: string;
  locator: string;
  score: number;
}

/** 知识库状态 */
export interface KnowledgeState {
  /** 知识库条目列表 */
  knowledgeEntries: KnowledgeEntry[];
  /** 索引任务列表 */
  indexJobs: IndexJobState[];
  /** 当前搜索结果 */
  searchResults: KnowledgeSearchResult[];
  /** 活跃引用（当前对话中引用的知识片段） */
  activeCitations: KnowledgeSearchResult[];
  /** 当前批量选中的文档ID */
  selectedEntryIds: string[];

  /** 设置知识库条目 */
  setKnowledgeEntries: (entries: KnowledgeEntry[]) => void;
  /** 添加知识库条目 */
  addKnowledgeEntry: (entry: KnowledgeEntry) => void;
  /** 设置索引任务 */
  setIndexJobs: (jobs: IndexJobState[]) => void;
  /** 更新索引任务 */
  updateIndexJob: (id: string, updates: Partial<IndexJobState>) => void;
  /** 设置搜索结果 */
  setSearchResults: (results: KnowledgeSearchResult[]) => void;
  /** 设置活跃引用 */
  setActiveCitations: (citations: KnowledgeSearchResult[]) => void;
  /** 清空搜索结果 */
  clearSearchResults: () => void;
  /** 设置当前选中文档 */
  setSelectedEntryIds: (ids: string[]) => void;
}

/**
 * 知识库状态 Store
 */
export const useKnowledgeStore = create<KnowledgeState>((set) => ({
  knowledgeEntries: [],
  indexJobs: [],
  searchResults: [],
  activeCitations: [],
  selectedEntryIds: [],

  setKnowledgeEntries: (entries) => set({ knowledgeEntries: entries }),
  addKnowledgeEntry: (entry) => set((s) => ({
    knowledgeEntries: [...s.knowledgeEntries, entry],
  })),
  setIndexJobs: (jobs) => set({ indexJobs: jobs }),
  updateIndexJob: (id, updates) => set((s) => ({
    indexJobs: s.indexJobs.some((j) => j.id === id)
      ? s.indexJobs.map((j) => (j.id === id ? { ...j, ...updates } : j))
      : [...s.indexJobs, {
        id,
        documentId: updates.documentId ?? '',
        status: updates.status ?? 'queued',
        progress: updates.progress ?? 0,
        error: updates.error ?? null,
      }],
  })),
  setSearchResults: (results) => set({ searchResults: results }),
  setActiveCitations: (citations) => set({ activeCitations: citations }),
  clearSearchResults: () => set({ searchResults: [] }),
  setSelectedEntryIds: (ids) => set({ selectedEntryIds: ids }),
}));
