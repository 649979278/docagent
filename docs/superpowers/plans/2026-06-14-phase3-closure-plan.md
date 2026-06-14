# Phase 3 Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐三期剩余的非闭环链路，使计划、执行、恢复、工作区、知识库、RAG 诊断和最终输出在桌面主链路中形成完整持久化、可恢复、可观测、可操作闭环。

**Architecture:** 保持现有 `store -> runtime-factory -> ipc/preload -> hooks/store -> UI` 主架构不变，不引入平行状态源。所有闭环补强都以“单一真实状态源 + 明确事件桥接 + 桌面端可操作入口 + E2E 验证”为原则，优先补运行时和持久化桥，再补 IPC 和最小 UI，最后补端到端测试与回归。

**Tech Stack:** TypeScript, Electron, React, Zustand, sql.js, Vitest

---

## Current Gap Summary

当前代码已经完成：

- `plan -> approve -> next turn -> execute` 主链路
- `abort` 真实 `runId` 与 worker/direct 对齐
- `plan` 持久化桥基础版
- `session-resume` IPC
- `workspace` 最小 CRUD/bind IPC
- `knowledge-list` IPC 与 workspace 过滤
- `RAG` 默认组件诊断快照

当前仍未完全闭环的点：

1. 计划模块仍缺“提纲编辑 UI -> updatedOutlineJson -> 审批 -> 落库 -> 恢复显示”真闭环。
2. 最终文档产物路径还未从 `doc_write/doc_overwrite` 自动写回 `plans.final_doc_path`，输出面板也未显示真实产物。
3. 恢复入口已存在，但应用启动与会话切换后的自动恢复/恢复态展示仍不完整。
4. Workspace 虽有最小入口，但缺完整桌面业务操作闭环：改名、删除、解绑、会话归属管理、知识文档迁移。
5. 知识库文档虽能列出，但删除、按 workspace 迁移、批量管理、索引状态刷新仍未形成完整桌面交互闭环。
6. RAG 诊断当前只在计划生成时发出一次快照，缺运行态实时更新和降级可观测性。
7. 输出模块仍是占位，未与 `draft_ready/doc_ready/plan.final_doc_path` 串起来。

## File Structure

### Runtime / Persistence

- Modify: `apps/desktop/electron/runtime-factory.ts`
  负责统一装配 runtime、检索组件、计划桥、工具桥。
- Modify: `apps/desktop/electron/plan-persistence.ts`
  扩展为完整的计划资产桥，负责计划状态、outline、最终产物路径、RAG 诊断事件。
- Modify: `packages/tools/src/executor.ts`
  为写出型工具结果提供结构化 post-hook 入口。
- Modify: `packages/agent-core/src/runtime.ts`
  把 `draft_ready/doc_ready` 事件纳入运行时主循环。

### IPC / Preload

- Modify: `apps/desktop/electron/ipc/chat-ipc.ts`
  继续承接 outline 审批、恢复态切换、session mode 对齐。
- Modify: `apps/desktop/electron/ipc/knowledge-ipc.ts`
  补文档迁移、批量删除、刷新列表接口。
- Modify: `apps/desktop/electron/ipc/workspace-ipc.ts`
  补完整 workspace CRUD/解绑/迁移接口。
- Modify: `apps/desktop/electron/ipc-handlers.ts`
  注册新增 IPC，清理 dispose handler。
- Modify: `apps/desktop/electron/preload.ts`
  暴露新增 IPC 并保持 typed contract 一致。

### Frontend State / Hooks / UI

- Modify: `apps/desktop/src/stores/run-store.ts`
  增加 draft/doc 输出、恢复快照、RAG 实时诊断、active plan snapshot。
- Modify: `apps/desktop/src/stores/knowledge-store.ts`
  增加 workspace 归属、删除/迁移状态。
- Modify: `apps/desktop/src/stores/workspace-store.ts`
  增加 rename/delete/bind session 结果回写。
- Modify: `apps/desktop/src/hooks/useAgentEvents.ts`
  消费 `draft_ready/doc_ready/rag_diagnostics/recovery` 等事件。
- Modify: `apps/desktop/src/hooks/useKnowledgeManager.ts`
  补 workspace 过滤、批量删除、迁移、刷新。
- Modify: `apps/desktop/src/hooks/useSessionManager.ts`
  补启动自动恢复、切换会话恢复、workspace 绑定恢复。
- Modify: `apps/desktop/src/components/ConversationPane.tsx`
  增加计划提纲编辑入口与审批回传。
- Modify: `apps/desktop/src/components/plan-visualizer.tsx`
  显示 active plan outline、审批后状态、步骤状态。
- Modify: `apps/desktop/src/components/ContextDrawer.tsx`
  增加恢复信息、RAG 组件状态、knowledge/workspace 管理入口。
- Modify: `apps/desktop/src/components/Topbar.tsx`
  增加 workspace 改名/解绑/删除入口。
- Modify: `apps/desktop/src/components/tool-result-viewer.tsx`
  显示结构化输出和文档产物。

### Store Layer

- Modify: `packages/store/src/documents.ts`
  增加 workspace 迁移、批量查询、删除辅助函数。
- Modify: `packages/store/src/workspaces.ts`
  增加按 workspace 统计文档、按 session 列 workspace 详情。
- Modify: `packages/store/src/plans.ts`
  增加 `finalDocPath` 回写辅助函数，必要时增加 `listPlanAssetsBySession`。

### Tests

- Modify: `tests/e2e/plan-approval-flow.test.ts`
- Modify: `tests/e2e/knowledge-lifecycle.test.ts`
- Modify: `tests/e2e/recovery-transcript.test.ts`
- Modify: `tests/e2e/rag-quality-regression.test.ts`
- Create: `tests/e2e/workspace-desktop-closure.test.ts`
- Create: `tests/e2e/output-closure.test.ts`
- Modify: `packages/agent-core/src/__tests__/preload-typed-api.test.ts`

---

### Task 1: 计划审批编辑链闭环

**Files:**
- Modify: `apps/desktop/src/components/ConversationPane.tsx`
- Modify: `apps/desktop/src/components/plan-visualizer.tsx`
- Modify: `apps/desktop/src/hooks/useAgentEvents.ts`
- Modify: `apps/desktop/electron/ipc/chat-ipc.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Test: `tests/e2e/plan-approval-flow.test.ts`

- [ ] **Step 1: 写失败测试，覆盖审批时带编辑后的 outline**

```ts
it('approval persists edited outline json into plan record and recovery snapshot', async () => {
  // 生成计划 -> 传 edited outline -> 审批 -> 检查 plans.outline_json
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm exec vitest run tests/e2e/plan-approval-flow.test.ts`
Expected: FAIL，原因是前端未生成/回传编辑后的 outline。

- [ ] **Step 3: 在 UI 增加最小提纲编辑能力**

实现要求：
- `PlanApprovalBanner` 增加“编辑提纲”入口。
- 编辑视图先采用 textarea/raw JSON 或结构化简表，不新增第二状态源。
- 读取源只来自 `diagnostics.recoverySnapshot.activePlanSnapshot` 或当前 `run-store` 中的 active plan。
- 审批时调用：

```ts
api.approvePlan(planId, true, sessionId, JSON.stringify(editedOutline))
```

- [ ] **Step 4: 用事件把 active plan snapshot 放入前端状态**

`useAgentEvents.ts` 对 `plan_generated/plan_approved` 同步写入：

```ts
setDiagnostics({
  activePlanId: data.plan.id,
  recoverySnapshot: {
    ...existing,
    activePlanSnapshot: data.plan,
  },
})
```

- [ ] **Step 5: 再跑测试确认通过**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm exec vitest run tests/e2e/plan-approval-flow.test.ts`
Expected: PASS

### Task 2: 最终输出路径闭环

**Files:**
- Modify: `packages/tools/src/executor.ts`
- Modify: `packages/agent-core/src/runtime.ts`
- Modify: `apps/desktop/electron/plan-persistence.ts`
- Modify: `apps/desktop/src/stores/run-store.ts`
- Modify: `apps/desktop/src/components/tool-result-viewer.tsx`
- Modify: `apps/desktop/src/components/ContextDrawer.tsx`
- Test: `tests/e2e/output-closure.test.ts`

- [ ] **Step 1: 写失败测试，覆盖 `doc_write/doc_overwrite` 后 `plans.final_doc_path` 自动回写**

```ts
it('writes final_doc_path when doc_write completes and exposes it to output panel state', async () => {
  // 模拟工具输出 filePath -> 检查 plan.final_doc_path 与 run-store 输出态
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm exec vitest run tests/e2e/output-closure.test.ts`
Expected: FAIL，`final_doc_path` 未回写。

- [ ] **Step 3: 给 ToolExecutor 增加写出型工具 post-hook**

设计：

```ts
interface ToolExecutionObserver {
  onResult?(result: ToolExecutionResult, context: ToolContext): void | Promise<void>;
}
```

由 `runtime-factory` 注入 observer，在 `doc_write/doc_overwrite` 成功时：
- 调 `markActivePlanCompleted(runtime, output.filePath)` 更新运行时 active plan。
- 发出 `doc_ready` 事件。

- [ ] **Step 4: 在计划桥里接住 `doc_ready` / active plan finalDocPath**

要求：
- `plan-persistence.ts` 在计划完成时写回 `plans.final_doc_path`
- 必要时在 `execution_completed` 前做一次 `updatePlan(...finalDocPath...)`

- [ ] **Step 5: 前端输出面板展示真实产物**

`run-store` 增加：

```ts
output?: {
  draftContent?: string | null
  docPath?: string | null
}
```

`tool-result-viewer.tsx` 和 `ContextDrawer.tsx` 读取该状态展示。

- [ ] **Step 6: 重新跑测试**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm exec vitest run tests/e2e/output-closure.test.ts`
Expected: PASS

### Task 3: 会话恢复启动闭环

**Files:**
- Modify: `apps/desktop/src/hooks/useSessionManager.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/ContextDrawer.tsx`
- Test: `tests/e2e/recovery-transcript.test.ts`

- [ ] **Step 1: 写失败测试，覆盖应用启动后自动恢复最近会话**

```ts
it('hydrates latest session messages, recovery snapshot and workspace bindings on init', async () => {
  // 准备 session + transcript + workspace 绑定，调用 initSessions/selectSession
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm exec vitest run tests/e2e/recovery-transcript.test.ts`
Expected: FAIL，启动未自动恢复。

- [ ] **Step 3: 在 `initSessions()` 中自动选择最近会话**

逻辑：
- 如果 sessions 非空且当前无选中会话，则选 `sessions[0]`
- 调 `selectSession(sessions[0].id)`，而不是只塞列表

- [ ] **Step 4: `selectSession()` 统一恢复以下状态**

恢复内容：
- 消息列表
- `sessionResume()` 快照
- workspace 绑定
- knowledge 文档列表
- active plan snapshot
- run diagnostics 基础信息

- [ ] **Step 5: UI 展示恢复状态**

`ContextDrawer` 的 Run/Plan 面板展示：
- 恢复 runId
- terminalStatus
- transcriptPath
- active plan snapshot title/status

- [ ] **Step 6: 跑测试确认通过**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm exec vitest run tests/e2e/recovery-transcript.test.ts`
Expected: PASS

### Task 4: Workspace 桌面操作闭环

**Files:**
- Modify: `apps/desktop/electron/ipc/workspace-ipc.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/stores/workspace-store.ts`
- Modify: `apps/desktop/src/components/Topbar.tsx`
- Modify: `apps/desktop/src/components/ContextDrawer.tsx`
- Test: `tests/e2e/workspace-desktop-closure.test.ts`

- [ ] **Step 1: 写失败测试，覆盖 rename/delete/unbind/session-bind/document-count**

```ts
it('supports workspace create, rename, bind, unbind, delete and document counts', async () => {
  // 调 IPC -> 校验 store 与 DB
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm exec vitest run tests/e2e/workspace-desktop-closure.test.ts`
Expected: FAIL

- [ ] **Step 3: 扩展 workspace IPC**

新增接口：
- `workspace-get`
- `workspace-session-details`
- `workspace-documents`
- `workspace-rebind-document`

- [ ] **Step 4: 前端 workspace store 增加完整操作**

需要新增：

```ts
updateWorkspaceLocal(id, updates)
setWorkspaceDocumentCount(id, count)
```

- [ ] **Step 5: Topbar/ContextDrawer 增加最小管理入口**

要求：
- 改名
- 删除
- 当前会话解绑
- 当前 workspace 文档数展示

- [ ] **Step 6: 跑测试确认通过**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm exec vitest run tests/e2e/workspace-desktop-closure.test.ts`
Expected: PASS

### Task 5: 知识库管理闭环

**Files:**
- Modify: `apps/desktop/electron/ipc/knowledge-ipc.ts`
- Modify: `packages/store/src/documents.ts`
- Modify: `apps/desktop/src/hooks/useKnowledgeManager.ts`
- Modify: `apps/desktop/src/components/ContextDrawer.tsx`
- Test: `tests/e2e/knowledge-lifecycle.test.ts`

- [ ] **Step 1: 写失败测试，覆盖知识文档删除、迁移工作区、批量刷新**

```ts
it('supports delete, workspace migration and reload of knowledge entries', async () => {
  // add -> list -> migrate -> list by workspace -> remove
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm exec vitest run tests/e2e/knowledge-lifecycle.test.ts`
Expected: FAIL

- [ ] **Step 3: store 补文档迁移接口**

新增：

```ts
updateDocumentWorkspace(db, docId, workspaceId)
listDocumentsByIds(db, ids)
```

- [ ] **Step 4: knowledge IPC 补完整接口**

新增：
- `knowledge-move`
- `knowledge-remove-batch`
- `knowledge-refresh`

- [ ] **Step 5: hook 和 UI 接线**

`useKnowledgeManager` 增加：
- 删除
- 迁移工作区
- 重新加载

`ContextDrawer` 知识面板增加：
- 当前工作区过滤提示
- 删除按钮
- 迁移按钮

- [ ] **Step 6: 跑测试确认通过**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm exec vitest run tests/e2e/knowledge-lifecycle.test.ts`
Expected: PASS

### Task 6: RAG 实时诊断闭环

**Files:**
- Modify: `apps/desktop/electron/runtime-factory.ts`
- Modify: `packages/rag/src/query-rewriter.ts`
- Modify: `packages/rag/src/reranker.ts`
- Modify: `apps/desktop/src/hooks/useAgentEvents.ts`
- Modify: `apps/desktop/src/components/ContextDrawer.tsx`
- Test: `tests/e2e/rag-quality-regression.test.ts`

- [ ] **Step 1: 写失败测试，覆盖运行中降级后的诊断刷新**

```ts
it('emits updated rag diagnostics after query rewriter or reranker disables itself', async () => {
  // 连续失败触发 disable -> 检查新 diagnostics 事件
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm exec vitest run tests/e2e/rag-quality-regression.test.ts`
Expected: FAIL

- [ ] **Step 3: 给 QueryRewriter/Reranker 增加诊断接口**

新增约定：

```ts
getDiagnostics(): { name: string; fallback: boolean; disabled: boolean }
```

- [ ] **Step 4: runtime-factory 在每次检索前后或每次状态变化时发 `rag_diagnostics`**

要求：
- 初始快照
- disabled 后新快照
- UI 可看到当前是否 fallback/disabled

- [ ] **Step 5: 前端 run-store 更新并展示**

在 `ContextDrawer` 中展示：
- 当前重写器
- 当前重排器
- 是否 fallback
- 是否 disabled

- [ ] **Step 6: 跑测试确认通过**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm exec vitest run tests/e2e/rag-quality-regression.test.ts`
Expected: PASS

### Task 7: typed contract 和全量回归闭环

**Files:**
- Modify: `packages/agent-core/src/__tests__/preload-typed-api.test.ts`
- Modify: `tests/e2e/ipc-domain-registration.test.ts`
- Test: `tests/e2e/*`

- [ ] **Step 1: 补 preload typed contract 测试**

覆盖新增接口：
- `sessionResume`
- `listKnowledge`
- `listWorkspaces`
- `createWorkspace`
- `bindSessionWorkspace`

- [ ] **Step 2: 补 IPC 注册测试**

校验：
- `registerWorkspaceIpc`
- 新增 knowledge/workspace/resume IPC 已注册

- [ ] **Step 3: 运行全量 E2E**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm exec vitest run tests/e2e`
Expected: 全绿

- [ ] **Step 4: 运行关键单测回归**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm exec vitest run packages/agent-core/src/__tests__ packages/store/src/__tests__ packages/rag/src/__tests__`
Expected: 全绿

- [ ] **Step 5: 运行 verify 级别校验**

Run: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && pnpm run verify`
Expected: 通过；若失败，逐项修复直到通过。

---

## Completion Criteria

三期可以判定“完全闭环”的标准：

1. 计划从生成、编辑、审批、执行、完成、输出路径回写、恢复展示，全程只有一条状态链。
2. 会话恢复不仅能恢复消息，还能恢复 run、plan、workspace、knowledge、输出摘要。
3. Workspace 可以在桌面端完整操作，并真实影响 knowledge 文档归属和会话归属。
4. Knowledge 可以列出、删除、迁移、按 workspace 过滤，并且 UI 与 DB 一致。
5. RAG 默认质量链路有明确的运行态诊断，fallback/disabled 状态可观测。
6. Output 面板不再是占位，而是展示真实草稿/文档产物。
7. 全量 E2E 和关键单测在 Node 24 下全部通过。
