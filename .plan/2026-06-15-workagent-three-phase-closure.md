# WorkAgent 三期计划完整闭环落地方案

> **目标**：把 D:/wsx_workspace/docagent 从"代码基本写完但跑不通、部分模块仍是骨架"推进到"三期计划全部逻辑闭环、端到端测试畅通可用"。
> **范围**：以当前 main 分支为基线，按差距优先级分阶段落地，不引入新需求。
> **验收标准**：`pnpm verify` 全绿（doctor-env → test:unit → test:e2e → build → desktop build）。

---

## 1. Context

前一阶段已完成全量代码探索：

- 项目是一个 Electron + TypeScript + pnpm workspaces 的离线公文写作 Agent。
- 核心架构（Renderer → Main → Workers → Ollama）已落地。
- 9 个 workspace 包、8 个 Agent 工具、30+ 单元测试、17 个 e2e 测试均已存在。
- **Plan→Execute 闭环、IPC 拆分、Worker abort、drain-collapse、resume-session、Hybrid RAG、004 migration 等核心能力已实现。**

但存在以下导致"无法完整闭环"的阻塞项与骨架项，需要在本计划中补齐。

---

## 2. Gap Analysis

### 2.1 阻塞项（必须最先解决）

| # | 差距 | 现状 | 影响 |
|---|------|------|------|
| 1 | `node_modules` 缺失 | 项目目录有 `node_modules/` 但无实际依赖 | `pnpm test:unit` 直接报 `vitest` 不是内部命令 |
| 2 | `tests/e2e/rag-quality-regression.test.ts:127` 缩进错误 | `describe` 前多两个空格 | 解析失败，e2e 无法启动 |

### 2.2 架构/实现缺口

| # | 差距 | 现状 | 三期计划要求 |
|---|------|------|-------------|
| 3 | SQLite 实现 | 使用 `sql.js` | `better-sqlite3` |
| 4 | Token 估算 | `content.length / 2` 字符估算 | `js-tiktoken` 精确计数 |
| 5 | 日志框架 | 多处 `console.log` | `pino` 结构化日志 |
| 6 | Reranker | `BGEReranker` 为骨架，fallback 到 `PassThroughReranker` | 真实调用 Ollama `/api/rerank` |
| 7 | Query Rewriter | `OllamaQueryRewriter` 为骨架，fallback 到 `RuleBasedQueryRewriter` | 真实 LLM 查询重写 |
| 8 | Worker 隔离 | `chat-ipc.ts` 有 `useWorkerMode` 标志，默认走 direct 模式 | 默认启用 Worker 模式 |
| 9 | LanceDB 验证 | e2e 使用 `MemoryVectorStore` | e2e 真实跑 LanceDB |
| 10 | 测试 fixtures | `tests/fixtures/knowledge/` 内容不足 | 补充政策/公文样例 |

### 2.3 工程化缺口

| # | 差距 | 现状 |
|---|------|------|
| 11 | CI/CD | 无 `.github/workflows/` 等 |
| 12 | 代码规范 | 无 ESLint / Prettier |
| 13 | 依赖覆盖 | 无 `pnpm.overrides`（三期提到需锁定 `@noble/hashes`） |

---

## 3. Implementation Plan

### Phase 1：环境修复（0.5 天）

**目标**：让 `pnpm test:unit` 和 `pnpm test:e2e` 能够跑起来。

#### Task 1.1 执行 `pnpm install`
- **文件**：无代码修改
- **命令**：`pnpm install`
- **预期**：`node_modules` 完整，`vitest` 可用
- **验证**：`pnpm --filter @workagent/agent-core test`

#### Task 1.2 修复 e2e 测试语法错误
- **文件**：`tests/e2e/rag-quality-regression.test.ts:127`
- **修改**：将
  ```ts
    describe('RAG 质量回归', () => {
  ```
  改为
  ```ts
  describe('RAG 质量回归', () => {
  ```
- **验证**：`pnpm test:e2e -- --run tests/e2e/rag-quality-regression.test.ts`

#### Task 1.3 添加 `pnpm.overrides`
- **文件**：`package.json`
- **修改**：根级增加
  ```json
  "pnpm": {
    "overrides": {
      "@noble/hashes": "^1.8.0"
    }
  }
  ```
- **原因**：三期计划提到需锁定 `@noble/hashes` 以避免 ESM 兼容问题
- **验证**：`pnpm install` 后 `pnpm -r build` 无 noble/hashes 报错

#### Task 1.4 运行 `pnpm doctor:env`
- **文件**：`scripts/doctor-env.js`
- **命令**：`pnpm doctor:env`
- **预期**：Node、pnpm、Ollama、qwen3.5:9b、bge-m3、bge-reranker-v2-m3 全绿
- **失败处理**：按脚本提示本地 `ollama pull` 缺失模型

---

### Phase 2：数据库迁移到 better-sqlite3（1 天）

**目标**：替换 `sql.js` 为 `better-sqlite3`，消除 WASM 持久化限制。

#### Task 2.1 安装依赖
- **命令**：
  ```bash
  pnpm add better-sqlite3@^11.0.0 --filter @workagent/store
  pnpm add -D @types/better-sqlite3 --filter @workagent/store
  ```

#### Task 2.2 重构 `packages/store/src/database.ts`
- **关键类**：`Database`、`Statement`
- **修改点**：
  1. `import initSqlJs from 'sql.js'` → `import BetterSqlite3 from 'better-sqlite3'`
  2. `Database` 类内部持有 `BetterSqlite3.Database` 实例
  3. `Statement` 类包装 `BetterSqlite3.Statement`
  4. `initDatabase()` 由异步改为同步（`new BetterSqlite3(dbPath)`）
  5. 移除 `db.save()`、`getSqlJsDb()` 等与 sql.js 相关方法
  6. `pragma()` 改为 `db.pragma({ ... })` 形式
- **参考文件**：`packages/store/src/database.ts`

#### Task 2.3 更新调用方
- **文件**：
  - `packages/store/src/index.ts`
  - `apps/desktop/electron/runtime-factory.ts`
  - `apps/desktop/electron/ipc-handlers.ts`
  - `apps/desktop/electron/workers/agent-worker.ts`
  - `apps/desktop/electron/workers/data-worker.ts`
- **修改点**：
  - `await initDatabase(...)` → `initDatabase(...)`
  - 移除 `db.save()` 调用
  - Worker 线程中注意 native 模块加载路径

#### Task 2.4 更新迁移脚本
- **文件**：`packages/store/src/migrations/*.ts`
- **修改点**：
  - `db.pragma('table_info(...)')` → `db.pragma({ table_info: 'chunks' })`
  - 确保 `prepare().all()` 返回格式兼容

#### Task 2.5 更新单元测试
- **文件**：`packages/store/src/**/*.test.ts`
- **验证**：`pnpm --filter @workagent/store test`

---

### Phase 3：Token 计数精确化（0.5 天）

**目标**：用 `js-tiktoken` 替换字符估算。

#### Task 3.1 安装依赖
- **命令**：`pnpm add js-tiktoken --filter @workagent/shared`

#### Task 3.2 创建共享 token 工具
- **新建文件**：`packages/shared/src/tokens.ts`
- **内容**：
  ```ts
  import { encodingForModel } from 'js-tiktoken';

  const encoder = encodingForModel('gpt-4o');

  export function countTokens(text: string): number {
    return encoder.encode(text).length;
  }
  ```

#### Task 3.3 替换预算模块
- **文件**：`packages/agent-core/src/context/budget.ts:283-286`
- **修改**：`estimateTokens` 改为从 `@workagent/shared` 导入 `countTokens`

#### Task 3.4 替换 RAG 估算
- **文件**：`packages/rag/src/retrieval-pipeline.ts`
- **修改**：`estimateChunkTokens` 改为使用 `countTokens`

#### Task 3.5 验证
- **命令**：`pnpm --filter @workagent/agent-core --filter @workagent/rag test`

---

### Phase 4：日志框架 pino（0.5 天）

**目标**：统一使用 `pino` 结构化日志，替换 `console.log`。

#### Task 4.1 安装依赖
- **命令**：
  ```bash
  pnpm add pino --filter @workagent/shared
  pnpm add -D pino-pretty --filter @workagent/shared
  ```

#### Task 4.2 创建日志工厂
- **新建文件**：`packages/shared/src/logger.ts`
- **内容**：
  ```ts
  import pino from 'pino';

  export function createLogger(name: string) {
    return pino({
      name,
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    });
  }
  ```

#### Task 4.3 替换 console.log
- **文件**：
  - `packages/docgen/src/writer.ts`
  - `packages/agent-core/src/runtime.ts`
  - `packages/agent-core/src/context/*.ts`
  - `apps/desktop/electron/ipc-handlers.ts`
  - `apps/desktop/electron/runtime-factory.ts`
- **修改点**：
  - `console.log('[DB]', msg)` → `logger.debug({ component: 'DB' }, msg)`
  - `console.error` → `logger.error(err)`

#### Task 4.4 验证
- **命令**：`pnpm test:unit`

---

### Phase 5：RAG 高级组件去骨架化（1 天）

**目标**：让 `BGEReranker` 和 `OllamaQueryRewriter` 真实工作，不再 fallback。

#### Task 5.1 完成 BGEReranker
- **文件**：`packages/rag/src/reranker.ts`
- **现状**：`callOllamaRerank` 已存在但可能未完整调用 `/api/rerank`
- **修改点**：
  1. 构造符合 Ollama `/api/rerank` 的请求体：
     ```ts
     { model: 'bge-reranker-v2-m3', query, documents }
     ```
  2. 解析返回的 `results` 数组，按 `relevance_score` 排序
  3. 在 `RetrievalPipeline` 中默认启用 `BGEReranker`
  4. 保留 `callChatBasedRerank` 作为 `/api/rerank` 不可用时的降级

#### Task 5.2 完成 OllamaQueryRewriter
- **文件**：`packages/rag/src/query-rewriter.ts`
- **现状**：骨架实现
- **修改点**：
  1. 注入 `ModelProvider`，调用 `/api/chat` 生成多个查询变体
  2. Prompt 要求模型输出 JSON 数组：`["改写查询1", "改写查询2"]`
  3. 解析失败时 fallback 到 `RuleBasedQueryRewriter`

#### Task 5.3 更新 RetrievalPipeline 默认链
- **文件**：`packages/rag/src/retrieval-pipeline.ts`
- **修改点**：默认使用 `OllamaQueryRewriter` + `BGEReranker`

#### Task 5.4 更新 RAG e2e
- **文件**：`tests/e2e/rag-quality-regression.test.ts`
- **修改点**：断言 `retrievalDiagnostics.reranker.name` 为 `'BGEReranker'` 而非 `'PassThroughReranker'`
- **验证**：`pnpm test:rag`

---

### Phase 6：Worker 模式默认启用（0.5 天）

**目标**：让 AgentRuntime 真正跑在 Worker 线程中，而非主进程 direct 模式。

#### Task 6.1 修改 chat-ipc.ts 默认值
- **文件**：`apps/desktop/electron/ipc/chat-ipc.ts`
- **修改点**：将 `useWorkerMode` 默认改为 `true`

#### Task 6.2 验证 Worker 加载
- **文件**：`apps/desktop/electron/workers/agent-worker.ts`
- **修改点**：确保 better-sqlite3 等 native 模块在 Worker 中可加载

#### Task 6.3 更新 worker-parity e2e
- **文件**：`tests/e2e/runtime.worker-parity.test.ts`
- **验证**：`pnpm test:e2e -- --run tests/e2e/runtime.worker-parity.test.ts`

---

### Phase 7：LanceDB 真实运行与 Fixtures（0.5 天）

**目标**：e2e 不再使用 MemoryVectorStore，而是真实跑 LanceDB。

#### Task 7.1 创建 LanceDB e2e bundle
- **文件**：`apps/desktop/electron/runtime-factory.ts`
- **修改点**：确保 e2e 环境下注入 `LanceDBVectorStore`

#### Task 7.2 补充 fixtures
- **目录**：`tests/fixtures/knowledge/`
- **新增**：
  - `sample-policy.txt`：包含"国办发〔2024〕1号"等政策文号
  - `sample-report.docx`：简单的公文报告样例
  - `sample-regulation.txt`：规章制度文本

#### Task 7.3 调整 RAG e2e
- **文件**：`tests/e2e/hybrid-rag-pipeline.test.ts`、`tests/e2e/rag-quality-regression.test.ts`
- **修改点**：
  - 使用 LanceDB 持久化目录
  - 测试结束后清理目录

#### Task 7.4 验证
- **命令**：`pnpm test:rag`

---

### Phase 8：测试修复与补全（1 天）

**目标**：所有单元测试和 e2e 测试通过。

#### Task 8.1 运行并修复 unit tests
- **命令**：`pnpm test:unit`
- **处理**：逐个修复失败测试，优先修复因 API 变更导致的失败

#### Task 8.2 运行并修复 e2e tests
- **命令**：`pnpm test:e2e`
- **重点测试**：
  - `plan-approval-flow.test.ts`
  - `runtime-abort.test.ts`
  - `recovery-transcript.test.ts`
  - `knowledge-lifecycle.test.ts`
  - `desktop-smoke.test.ts`

#### Task 8.3 添加缺失测试
- **新增文件**：`packages/store/src/database.test.ts`（better-sqlite3 基础 CRUD）
- **新增文件**：`packages/rag/src/reranker.test.ts`（BGEReranker 调用 Ollama mock）
- **新增文件**：`packages/rag/src/query-rewriter.test.ts`（OllamaQueryRewriter 解析）

---

### Phase 9：工程化配置（0.5 天）

**目标**：补齐 CI/CD 和代码规范。

#### Task 9.1 ESLint + Prettier
- **新建文件**：`eslint.config.mjs`、`.prettierrc`
- **命令**：
  ```bash
  pnpm add -D eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin --filter workagent
  ```
- **验证**：`pnpm lint`

#### Task 9.2 GitHub Actions CI
- **新建文件**：`.github/workflows/ci.yml`
- **内容**：
  - 触发：push / PR 到 main
  - 步骤：checkout → setup-node → pnpm install → doctor-env（可选）→ test:unit → test:e2e → build

#### Task 9.3 更新根 package.json 脚本
- **文件**：`package.json`
- **修改**：确保 `lint`、`build`、`verify` 可用

---

## 4. Verification

最终验收必须依次通过以下命令：

```bash
# 1. 依赖安装
pnpm install

# 2. 环境检查
pnpm doctor:env

# 3. 单元测试
pnpm test:unit

# 4. 端到端测试
pnpm test:e2e

# 5. 所有包构建
pnpm -r build

# 6. Electron 桌面构建
pnpm --filter @workagent/desktop build

# 7. 完整门禁（等价于以上所有）
pnpm verify
```

---

## 5. Risks & Mitigations

| 风险 | 影响 | 缓解 |
|------|------|------|
| `better-sqlite3` 在 Electron Worker 中加载失败 | 运行时崩溃 | 先在 Worker 中验证 native 模块加载；失败则保留 `sql.js` 作为降级 |
| `js-tiktoken` bundle 过大 | 渲染进程包体积增加 | 仅在 main/worker 使用，不暴露到 renderer |
| Ollama `/api/rank` 与模型格式不兼容 | Reranker 失效 | 保留 chat-based rerank 降级 |
| e2e 测试依赖本地 Ollama | CI 无法运行 | CI 中跳过需要 Ollama 的测试，或引入 mock provider |

---

## 6. Critical Files

- `package.json` — pnpm.overrides、lint 脚本
- `packages/store/src/database.ts` — better-sqlite3 迁移核心
- `packages/agent-core/src/context/budget.ts` — token 估算
- `packages/shared/src/logger.ts` — pino 日志工厂
- `packages/shared/src/tokens.ts` — js-tiktoken 封装
- `packages/rag/src/reranker.ts` — BGEReranker 完整实现
- `packages/rag/src/query-rewriter.ts` — OllamaQueryRewriter 完整实现
- `packages/rag/src/retrieval-pipeline.ts` — 默认链配置
- `apps/desktop/electron/ipc/chat-ipc.ts` — Worker 模式默认开关
- `tests/e2e/rag-quality-regression.test.ts:127` — 语法错误

---

*计划生成时间：2026-06-15*
*基于会话：880068d3-d398-463e-84f3-446c8e6b6dd0*
