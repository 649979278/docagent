/**
 * @workagent/agent-core - Agent运行时入口
 * 导出运行时、状态管理、路由、上下文管理、计划控制和会话编排
 */

// 运行时核心
export { AgentRuntime } from './runtime.js';
export type { RuntimeConfig } from './runtime.js';

// 状态管理
export {
  createLoopState,
  createTurnState,
  createRuntimeContext,
  stateToRuntimeContext,
} from './state.js';
export type {
  LoopDecision,
  ToolExecutionTrace,
  TurnState,
  LoopState,
  RuntimeContext,
  CompactResult,
} from './state.js';

// 条件路由
export { routeAfterResponse } from './router.js';
export type { RouteResult } from './router.js';

// 上下文管理
export { allocateBudget, estimateTokens, isOverThreshold, truncateRagChunks } from './context/budget.js';
export { assessCompactNeed, compactContext, reactiveCompact } from './context/compact.js';
export { drainCollapse } from './context/drain-collapse.js';
export type { DrainCollapseResult } from './context/drain-collapse.js';
export { resumeSession } from './context/resume-session.js';
export type { RunLookupStore, SessionResumeSnapshot } from './context/resume-session.js';
export { microCompact } from './context/microCompact.js';
export { summaryCompact } from './context/summaryCompact.js';
export type { SummaryCompactResult } from './context/summaryCompact.js';
export { citationRehydrate, extractCitationIds, formatChunksForContext } from './context/citationRehydrate.js';
export type { CitationRehydrateResult } from './context/citationRehydrate.js';
export { MemoryManager } from './context/memory.js';
export { TranscriptStore } from './context/transcript.js';
export { SessionMemoryPersist } from './context/session-memory-persist.js';

// 计划控制器
export { PlanModeController } from './plan-controller.js';
export type { PlanControllerEvent, PlanControllerCallback } from './plan-controller.js';

// 会话编排
export { SessionOrchestrator } from './session.js';
export type { SessionState } from './session.js';
