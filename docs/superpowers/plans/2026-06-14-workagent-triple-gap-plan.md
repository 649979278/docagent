# WorkAgent 三期差距修复实施计划 + 端到端测试方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不推翻现有一期/二期成果的前提下，把 WorkAgent 补到“Claude Code 级运行时 + 顶尖开源知识库 Agent 级 RAG + 可交付桌面产品”三条主线都可稳定落地。

**Architecture:** 保持 Electron + Monorepo + AgentRuntime + RAG 分层，不追求大重写。优先修复真实运行路径上的断层：Worker 与 direct 模式一致、Plan/Execute 真闭环、RAG 走混合检索与重排、崩溃/上下文溢出可恢复、桌面 UI 暴露运行态与知识态。

**Tech Stack:** Electron、React 19、TypeScript、pnpm workspace、sql.js、LanceDB、Ollama、Vitest、Playwright、electron-builder、Node 24

---

## 0. 当前基线

### 已有能力
- 不可变 `QueryLoopState`
- 基础 compact / recovery / budget
- 基础 RAG 索引与检索
- 工具系统与权限代理
- Plan 控制器
- 三栏桌面 UI

### 主要差距
- Worker 线程与主进程运行时不一致
- Plan 模式 UI 入口与 Runtime 控制器未完全闭环
- 检索层仍偏 dense-only，缺 hybrid / rerank / rewrite
- 崩溃恢复、transcript、session memory 未做成生产级
- UI 只像聊天壳，不像可观测工作台
- Mac 测试和 Windows 打包验收还不是一条完整链路

---

## 1. 交付边界

### 必须完成
- Worker / direct 行为一致
- Plan 模式可生成、审批、执行、导出
- 知识库可导入、幂等、重建、重启保留
- RAG 可做混合检索、重排、查询重写、引用注入
- 崩溃、超长上下文、max_output_tokens 可恢复
- 桌面 UI 可观测运行态、计划态、知识态
- Mac 开发测试可跑通
- Windows 安装包可打包、可安装、可验收

### 先不做
- 多租户
- 云端协作
- MCP 全量生态接入
- 复杂工作流编排平台化

---

## 2. 文件边界总表

### 运行时 / Plan
- Modify: `packages/agent-core/src/runtime.ts`
- Modify: `packages/agent-core/src/router.ts`
- Modify: `packages/agent-core/src/query-state.ts`
- Modify: `packages/agent-core/src/plan-controller.ts`
- Modify: `packages/agent-core/src/context/pipeline.ts`
- Modify: `packages/agent-core/src/context/rag-inject.ts`
- Modify: `packages/agent-core/src/context/compact.ts`
- Modify: `packages/agent-core/src/context/compact-recovery.ts`
- Create: `packages/agent-core/src/context/transcript.ts`
- Create: `packages/agent-core/src/context/session-memory-persist.ts`

### Electron / Worker
- Modify: `apps/desktop/electron/ipc-handlers.ts`
- Modify: `apps/desktop/electron/worker-bridge.ts`
- Modify: `apps/desktop/electron/workers/agent-worker.ts`
- Create: `apps/desktop/electron/runtime-factory.ts`
- Create: `apps/desktop/electron/runtime-shared.ts`

### RAG / Ingest / Store
- Modify: `packages/rag/src/retrieval-pipeline.ts`
- Modify: `packages/rag/src/engine.ts`
- Modify: `packages/rag/src/lancedb-store.ts`
- Modify: `packages/rag/src/chunker.ts`
- Modify: `packages/ingest/src/pipeline.ts`
- Modify: `packages/ingest/src/docx.ts`
- Modify: `packages/store/src/documents.ts`
- Modify: `packages/store/src/index-jobs.ts`
- Modify: `packages/store/src/database.ts`
- Create: `packages/rag/src/bm25-search.ts`
- Create: `packages/rag/src/hybrid-fusion.ts`
- Create: `packages/rag/src/reranker.ts`
- Create: `packages/rag/src/query-rewriter.ts`
- Create: `packages/rag/src/relevance-grader.ts`
- Create: `packages/rag/src/semantic-chunker.ts`
- Create: `packages/rag/src/knowledge-graph.ts`

### Tools / UI
- Modify: `packages/tools/src/executor.ts`
- Modify: `packages/tools/src/permission.ts`
- Modify: `packages/tools/src/base.ts`
- Modify: `packages/tools/src/rag-search/index.ts`
- Modify: `packages/tools/src/knowledge-add/index.ts`
- Create: `packages/tools/src/hooks.ts`
- Create: `packages/tools/src/transcript-classifier.ts`
- Create: `packages/tools/src/doc-edit/index.ts`
- Create: `packages/tools/src/style-check/index.ts`
- Create: `packages/tools/src/format-validate/index.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/hooks/useAgentEvents.ts`
- Modify: `apps/desktop/src/components/WorkbenchShell.tsx`
- Modify: `apps/desktop/src/components/ConversationPane.tsx`
- Modify: `apps/desktop/src/components/ContextDrawer.tsx`
- Create: `apps/desktop/src/components/tool-result-viewer.tsx`
- Create: `apps/desktop/src/components/plan-visualizer.tsx`

### Tests
- Create: `tests/e2e/runtime.worker-parity.test.ts`
- Create: `tests/e2e/plan-approval-flow.test.ts`
- Create: `tests/e2e/retrieval-pipeline.test.ts`
- Create: `tests/e2e/recovery-transcript.test.ts`
- Create: `tests/e2e/knowledge-lifecycle.test.ts`
- Create: `tests/e2e/desktop-smoke.test.ts`
- Create: `tests/e2e/windows-packaging.test.ts`
- Create: `tests/fixtures/knowledge/*.txt`
- Create: `tests/fixtures/knowledge/*.md`
- Create: `tests/fixtures/docs/*.docx`

---

## 3. 核心功能计划

### Task 1: 统一 Runtime 装配，确保 Worker / direct 完全同构

**Files:**
- Create: `apps/desktop/electron/runtime-factory.ts`
- Create: `apps/desktop/electron/runtime-shared.ts`
- Modify: `apps/desktop/electron/ipc-handlers.ts`
- Modify: `apps/desktop/electron/workers/agent-worker.ts`
- Test: `tests/e2e/runtime.worker-parity.test.ts`

- [ ] **Step 1: 写 failing test**

```ts
it('worker and direct modes expose the same runtime capabilities', async () => {
  const direct = await createRuntimeBundleForTest('direct');
  const worker = await createRuntimeBundleForTest('worker');

  expect(worker.tools).toEqual(direct.tools);
  expect(worker.hasRagProvider).toBe(true);
  expect(worker.hasPlanController).toBe(true);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm exec vitest run tests/e2e/runtime.worker-parity.test.ts`
Expected: FAIL，worker 当前是简化装配，缺 RAG / tools / store 统一初始化

- [ ] **Step 3: 实现统一工厂**

`runtime-factory.ts` 输出统一 bundle：
- `modelProvider`
- `ingestPipeline`
- `ragEngine`
- `registry`
- `permissionBroker`
- `executor`
- `runtime`

- [ ] **Step 4: 主进程和 Worker 改为同一路径**

`ipc-handlers.ts` 和 `agent-worker.ts` 都只调用工厂，不再各写一套装配逻辑。

- [ ] **Step 5: 重新运行测试**

Run: `pnpm exec vitest run tests/e2e/runtime.worker-parity.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/runtime-factory.ts apps/desktop/electron/runtime-shared.ts apps/desktop/electron/ipc-handlers.ts apps/desktop/electron/workers/agent-worker.ts tests/e2e/runtime.worker-parity.test.ts
git commit -m "refactor: unify runtime assembly across worker and direct modes"
```

### Task 2: 修复 Plan / Execute 闭环

**Files:**
- Modify: `apps/desktop/electron/ipc-handlers.ts`
- Modify: `packages/agent-core/src/runtime.ts`
- Modify: `packages/agent-core/src/plan-controller.ts`
- Modify: `packages/agent-core/src/router.ts`
- Modify: `packages/shared/src/events.ts`
- Test: `tests/e2e/plan-approval-flow.test.ts`

- [ ] **Step 1: 写 failing test**

```ts
it('plan flow enters draft, waits approval, and executes after approval', async () => {
  const flow = await runPlanApprovalScenario();

  expect(flow.generatedDraft).toBe(true);
  expect(flow.waitedApproval).toBe(true);
  expect(flow.enteredExecute).toBe(true);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm exec vitest run tests/e2e/plan-approval-flow.test.ts`
Expected: FAIL，session mode 改了，但 controller / activePlan / phase 没闭环

- [ ] **Step 3: 统一计划入口**

`plan-mode` IPC 需要同步：
- DB session mode
- `PlanModeController.enterPlanMode()`
- 当前 `activePlan`
- 事件 `plan_generated / phase_change`

- [ ] **Step 4: 修复 execute 分支**

`runtime.ts` 中 `approved` 不再走成普通 mode switch，要推进到 `EXECUTE_DRAFT` / `EXECUTE_EXPORT`。

- [ ] **Step 5: 重新运行测试**

Run: `pnpm exec vitest run tests/e2e/plan-approval-flow.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/ipc-handlers.ts packages/agent-core/src/runtime.ts packages/agent-core/src/plan-controller.ts packages/agent-core/src/router.ts packages/shared/src/events.ts tests/e2e/plan-approval-flow.test.ts
git commit -m "fix: close plan approval execution loop"
```

### Task 3: 把 RAG 升级为 hybrid retrieval + rerank + rewrite

**Files:**
- Create: `packages/rag/src/bm25-search.ts`
- Create: `packages/rag/src/hybrid-fusion.ts`
- Create: `packages/rag/src/reranker.ts`
- Create: `packages/rag/src/query-rewriter.ts`
- Modify: `packages/rag/src/retrieval-pipeline.ts`
- Modify: `packages/rag/src/lancedb-store.ts`
- Modify: `packages/rag/src/engine.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/constants.ts`
- Test: `tests/e2e/retrieval-pipeline.test.ts`

- [ ] **Step 1: 写 failing test**

```ts
it('hybrid retrieval beats dense-only on document number queries', async () => {
  const result = await runRetrievalScenario('国发〔2024〕3号');
  expect(result.hybrid.hit).toBe(true);
  expect(result.denseOnly.hit).toBe(false);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm exec vitest run tests/e2e/retrieval-pipeline.test.ts`
Expected: FAIL，当前只有 dense 向量路径

- [ ] **Step 3: 新增 BM25 + RRF**

`bm25-search.ts` 提供全文检索，`hybrid-fusion.ts` 负责密集/稀疏结果融合。

- [ ] **Step 4: 新增 rerank 和 query rewrite**

Plan 模式默认启用 rewrite + rerank；Chat 模式按触发条件降级启用。

- [ ] **Step 5: 在 pipeline 中加入 relevance grading**

保留与文档主题无关的 chunk 前要先 grading，再做 token 截断与引用打包。

- [ ] **Step 6: 重新运行测试**

Run: `pnpm exec vitest run tests/e2e/retrieval-pipeline.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/rag/src/bm25-search.ts packages/rag/src/hybrid-fusion.ts packages/rag/src/reranker.ts packages/rag/src/query-rewriter.ts packages/rag/src/retrieval-pipeline.ts packages/rag/src/lancedb-store.ts packages/rag/src/engine.ts tests/e2e/retrieval-pipeline.test.ts
git commit -m "feat: add hybrid retrieval rerank and rewrite"
```

### Task 4: 提升 Agent 稳定性，补 transcript / memory / recovery

**Files:**
- Create: `packages/agent-core/src/context/transcript.ts`
- Create: `packages/agent-core/src/context/session-memory-persist.ts`
- Modify: `packages/agent-core/src/runtime.ts`
- Modify: `packages/agent-core/src/context/compact-recovery.ts`
- Modify: `packages/agent-core/src/context/pipeline.ts`
- Modify: `packages/agent-core/src/context/session-memory.ts`
- Test: `tests/e2e/recovery-transcript.test.ts`

- [ ] **Step 1: 写 failing test**

```ts
it('can restore a run from transcript after simulated crash', async () => {
  const recovered = await runCrashRecoveryScenario();
  expect(recovered.restored).toBe(true);
  expect(recovered.lastTurnId).toBeDefined();
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm exec vitest run tests/e2e/recovery-transcript.test.ts`
Expected: FAIL，没有 JSONL transcript / 状态重建

- [ ] **Step 3: 增加 transcript 写前日志**

每个事件 yield 后写 JSONL，支持恢复与审计。

- [ ] **Step 4: 增加 session memory 持久化**

把会话摘要写成 Markdown，跨会话注入可控、可读、可回溯。

- [ ] **Step 5: 完善上下文恢复策略**

上下文超限与 max_output_tokens 使用递进恢复，必要时进入更激进的 drain collapse。

- [ ] **Step 6: 重新运行测试**

Run: `pnpm exec vitest run tests/e2e/recovery-transcript.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/agent-core/src/context/transcript.ts packages/agent-core/src/context/session-memory-persist.ts packages/agent-core/src/runtime.ts packages/agent-core/src/context/compact-recovery.ts packages/agent-core/src/context/pipeline.ts packages/agent-core/src/context/session-memory.ts tests/e2e/recovery-transcript.test.ts
git commit -m "feat: add transcript recovery and persistent session memory"
```

### Task 5: 补工具 hooks、权限和工具自描述 UI

**Files:**
- Create: `packages/tools/src/hooks.ts`
- Create: `packages/tools/src/transcript-classifier.ts`
- Modify: `packages/tools/src/executor.ts`
- Modify: `packages/tools/src/permission.ts`
- Modify: `packages/tools/src/base.ts`
- Modify: `apps/desktop/src/components/tool-result-viewer.tsx`
- Modify: `apps/desktop/src/components/plan-visualizer.tsx`

- [ ] **Step 1: 写 failing test**

```ts
it('hooks can block or auto-allow tool calls based on prior transcript', async () => {
  const decision = await runHookScenario();
  expect(decision).toBe('allow');
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm exec vitest run packages/tools/src/__tests__/hooks.test.ts`
Expected: FAIL，hooks 还不存在

- [ ] **Step 3: 接入 before/after hook**

执行器在权限判断前后都支持 hook，保留审计与分类器逻辑。

- [ ] **Step 4: UI 补工具自描述**

工具调用消息要能展示“正在做什么”和“结果是什么”，而不是只显示原始 JSON。

- [ ] **Step 5: 重新运行测试**

Run: `pnpm exec vitest run packages/tools/src/__tests__/hooks.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/hooks.ts packages/tools/src/transcript-classifier.ts packages/tools/src/executor.ts packages/tools/src/permission.ts packages/tools/src/base.ts apps/desktop/src/components/tool-result-viewer.tsx apps/desktop/src/components/plan-visualizer.tsx
git commit -m "feat: add tool hooks and rich tool descriptions"
```

### Task 6: 把桌面 UI 从聊天壳补成工作台

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/hooks/useAgentEvents.ts`
- Modify: `apps/desktop/src/components/WorkbenchShell.tsx`
- Modify: `apps/desktop/src/components/ConversationPane.tsx`
- Modify: `apps/desktop/src/components/ContextDrawer.tsx`
- Create: `apps/desktop/src/components/tool-result-viewer.tsx`
- Create: `apps/desktop/src/components/plan-visualizer.tsx`
- Test: `tests/e2e/desktop-smoke.test.ts`

- [ ] **Step 1: 写 failing test**

```ts
it('renders runtime, plan, and knowledge status in the desktop shell', async () => {
  const ui = await openDesktopSmoke();
  expect(ui.hasPlanVisual).toBe(true);
  expect(ui.hasKnowledgePanel).toBe(true);
  expect(ui.hasRunStatusBar).toBe(true);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm exec vitest run tests/e2e/desktop-smoke.test.ts`
Expected: FAIL，状态展示还不完整

- [ ] **Step 3: 补齐最小可观测面板**

至少展示：
- run_status
- phase_change
- index_progress
- mode_suggestion
- RAG 命中与引用

- [ ] **Step 4: Plan 可视化**

把 `PLAN_COLLECT / PLAN_RESEARCH / PLAN_DRAFT / PLAN_REVIEW / EXECUTE_DRAFT / EXECUTE_EXPORT` 做成可读步进器。

- [ ] **Step 5: 重新运行测试**

Run: `pnpm exec vitest run tests/e2e/desktop-smoke.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/hooks/useAgentEvents.ts apps/desktop/src/components/WorkbenchShell.tsx apps/desktop/src/components/ConversationPane.tsx apps/desktop/src/components/ContextDrawer.tsx apps/desktop/src/components/tool-result-viewer.tsx apps/desktop/src/components/plan-visualizer.tsx tests/e2e/desktop-smoke.test.ts
git commit -m "feat: expose runtime and knowledge state in desktop ui"
```

### Task 7: 把知识库生命周期做成“导入-变更-重启-可检索”

**Files:**
- Modify: `packages/ingest/src/pipeline.ts`
- Modify: `packages/rag/src/engine.ts`
- Modify: `packages/store/src/documents.ts`
- Modify: `packages/store/src/index-jobs.ts`
- Modify: `apps/desktop/electron/ipc-handlers.ts`
- Test: `tests/e2e/knowledge-lifecycle.test.ts`

- [ ] **Step 1: 写 failing test**

```ts
it('skips unchanged files, reindexes changed files, and survives restart', async () => {
  const result = await runKnowledgeLifecycleScenario();
  expect(result.skipped).toBe(true);
  expect(result.reindexed).toBe(true);
  expect(result.searchAfterRestart.hitCount).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm exec vitest run tests/e2e/knowledge-lifecycle.test.ts`
Expected: FAIL，幂等与重建还没有完全接线

- [ ] **Step 3: 接入 hash 幂等和重建**

文件未变更直接跳过；文件变更先删除旧向量再重建。

- [ ] **Step 4: 持久化索引任务状态**

导入、解析、embedding、完成、失败、跳过都要进状态机。

- [ ] **Step 5: 重新运行测试**

Run: `pnpm exec vitest run tests/e2e/knowledge-lifecycle.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/ingest/src/pipeline.ts packages/rag/src/engine.ts packages/store/src/documents.ts packages/store/src/index-jobs.ts apps/desktop/electron/ipc-handlers.ts tests/e2e/knowledge-lifecycle.test.ts
git commit -m "feat: make knowledge lifecycle idempotent and persistent"
```

---

## 4. 端到端测试方案

### 4.1 测试分层

- L0 环境检查
- L1 包内单测
- L2 仓库级集成测试
- L3 Desktop 冒烟
- L4 Mac 打包验证
- L5 Windows 安装包验证

### 4.2 Mac 开发环境

前置要求：
- macOS
- Node 24
- pnpm
- Ollama 已安装
- 聊天模型与 embedding 模型已下载

环境命令：

```bash
node -v
pnpm -v
ollama list
```

期望：
- Node `>=24`
- Ollama 可用
- 模型存在

### 4.3 L0 环境检查

Run:

```bash
pnpm doctor:env
```

检查内容：
- Node 版本
- pnpm 版本
- Vitest ESM/CJS 兼容
- Ollama 连接
- 工作区依赖加载

### 4.4 L1 单测

Run:

```bash
pnpm test:unit
```

覆盖：
- `packages/agent-core`
- `packages/rag`
- `packages/tools`
- `packages/ingest`
- `packages/store`

必测断言：
- Router transition
- compact / recovery
- hybrid retrieval
- rerank / rewrite
- tool executor 并发 / 串行
- DOCX / PDF / PPTX 提取
- SQLite migration

### 4.5 L2 集成测试

Run:

```bash
pnpm exec vitest run tests/e2e/runtime.worker-parity.test.ts
pnpm exec vitest run tests/e2e/plan-approval-flow.test.ts
pnpm exec vitest run tests/e2e/retrieval-pipeline.test.ts
pnpm exec vitest run tests/e2e/recovery-transcript.test.ts
pnpm exec vitest run tests/e2e/knowledge-lifecycle.test.ts
```

通过标准：
- 所有测试 PASS
- 无 flaky

### 4.6 Desktop 冒烟

Run:

```bash
pnpm --filter @workagent/desktop build
pnpm --filter @workagent/desktop dev
```

验证点：
1. 启动无白屏
2. 创建会话
3. 发送消息
4. Plan 模式切换
5. 计划审批
6. 知识导入
7. 检索与引用
8. 导出文档
9. 中断生成
10. 重启后会话与知识库保留

### 4.7 Mac 打包验证

Run:

```bash
pnpm --filter @workagent/desktop dist
```

验证点：
- `release/` 产物生成
- `dmg` 产物可安装
- `main.js` 和 renderer 文件齐全
- workspace 依赖被正确打包

### 4.8 Windows 安装包验证

在 Mac 上先构建：

```bash
pnpm --filter @workagent/desktop dist
```

产物：
- `WorkAgent-<version>-win-setup.exe`

Windows 真机/虚机验收：
1. 安装成功
2. 桌面快捷方式存在
3. 首次启动成功
4. Ollama 检测正常
5. 本地对话正常
6. 知识库导入 / 检索正常
7. 计划审批 / 导出正常
8. 卸载正常

### 4.9 业务语料回归

准备固定语料：
- 通知
- 请示
- 报告
- 函
- 规范性模板

核心断言：
- 引用 `[ref_N]` 正确
- 结构符合公文格式
- 不夹带错误事项
- 重复导入不重复索引
- 修改后重新索引生效

---

## 5. 验收门槛

- `pnpm test:unit` 全绿
- 所有 E2E 全绿
- Mac desktop 冒烟通过
- Mac 打包成功
- Windows 安装包成功产出并完成一次真机/虚机验收

未达成以上任一项，不视为完成。

