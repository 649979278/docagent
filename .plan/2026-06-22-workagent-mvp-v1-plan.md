# WorkAgent MVP 一期整合改进计划

## 分析日期：2026-06-22

---

## 核心原则

- ❌ 不需要：子代理、MCP、插件、技能系统（二期再考虑）
- ✅ 需要：运行时骨架健壮 + RAG/向量库完整 + 文档解析/操作闭环 + 本地文件知识库
- 所有功能以可运行、可测试为完成标准

---

## 零、向量数据库选型决策：保留 LanceDB

### 为什么继续用 LanceDB

| 维度 | LanceDB | 说明 |
|------|---------|------|
| **集成方式** | npm 包 `@lancedb/lancedb` | 无需手动安装数据库，npm install 自动下载对应平台原生库 |
| **打包** | electron-rebuild 编译原生模块 | 已集成到 `desktop:prepare-native` 构建流程中 |
| **用户安装** | 用户只需装应用 + Ollama | LanceDB 原生模块被打包进安装包，对用户透明 |
| **检索能力** | Dense Vector + FTS 混合检索 | 配合 SQLite FTS5 实现 hybrid 检索 |
| **成熟度** | GitHub 9k+ stars, Apache 2.0 | 顶级开源项目，由 Lance 格式团队维护 |
| **当前代码** | 已有完整 `LanceDBVectorStore` 实现 | 无需重写已有代码，只需加固 |

### 关键：用户无需安装操作

LanceDB 是嵌入式数据库，不依赖外部服务。它的 Node.js 原生模块在 `npm install` 时自动下载对应平台（win32/linux/macos）的二进制文件，和项目中已有的 `better-sqlite3` 完全一样的工作方式。electron-rebuild 会将二者一起编译为 Electron 可用的版本。

### LanceDB 局限性确认

| 局限性 | 影响 | 缓解方案 |
|--------|------|---------|
| 仅 IVF_PQ 索引 | 大数据量下精度略逊于 HNSW | MVP 阶段数据量小，IVF_PQ 足够 |
| apache-arrow peer dep | 增加打包体积 | 已接受，arrow 是列存标准 |
| FTS 能力不如专用引擎 | 需要 SQLite FTS5 协同 | 已实现 BF5 + BM25 互补 |

---

## 一、Agent 运行时骨架加固

### 目标
运行时基础架构足够健壮，能稳定运行 agentic loop，为后续能力扩展打下基础。

### 1.1 统一 Runtime 装配工厂

**当前问题**：Main Process 和 Worker Thread 使用两套装配路径，Worker 缺少完整 RAG 能力

**改动方案**：
- 重构 `runtime-factory.ts` 为统一装配工厂，Main Process 和 Worker 共用
- Worker 模式的 `agent-worker.ts` 复用工厂方法（不再用简化版 MemoryVectorStore）
- Worker 模式通过 IPC 桥接访问 SQLite（BM25/FTS5 检索）

**关键文件**：
- `apps/desktop/electron/runtime-factory.ts`（重构）
- `apps/desktop/electron/workers/agent-worker.ts`（改造）
- `apps/desktop/electron/worker-bridge.ts`（增强）
- `apps/desktop/electron/ipc-handlers.ts`（精简）

**验证**：`tests/e2e/runtime.worker-parity.test.ts` — Worker 与 Direct 模式检索结果一致

### 1.2 运行态事件与中断语义标准化

**当前问题**：缺少 `run_status: running/failed/aborted/completed` 标准事件流

**改动方案**：
- `runtime.ts`: 启动 emit `running`、正常结束 `completed`、错误 `failed`、中断 `aborted`
- `worker-bridge.ts`: Worker 模式事件透传一致
- `useAgentEvents.ts`: React 端消费状态事件

**关键文件**：
- `packages/agent-core/src/runtime.ts`
- `apps/desktop/electron/worker-bridge.ts`
- `apps/desktop/electron/ipc-handlers.ts`
- `apps/desktop/src/hooks/useAgentEvents.ts`

**验证**：`tests/e2e/runtime-abort.test.ts` — abort 只发 1 次 `aborted` 事件

### 1.3 错误恢复链路验证

**当前问题**：已有三级恢复代码（reactive compact → drain collapse → graceful stop），但缺乏集成测试

**改动方案**：
- 对以下场景增加集成测试：
  - Context overflow → reactive compact → 恢复成功
  - reactive compact 后仍超限 → drain collapse → 恢复成功
  - 双重压缩后仍超限 → graceful stop（不崩溃）
  - `max_output_tokens` → 注入恢复消息（最多3次）

**关键文件**：
- `packages/agent-core/src/runtime.ts`（handleError 方法）
- `packages/agent-core/src/context/compact-recovery.ts`
- `packages/agent-core/src/context/drain-collapse.ts`
- `tests/e2e/recovery-transcript.test.ts`

### 1.4 工具系统基础扩充

**当前问题**：仅 7 个公文专用工具，缺少文件 I/O 基础工具

**改动方案**：新增 4 个基础工具

| 工具 | 用途 | 安全级别 | 实现方式 |
|------|------|---------|---------|
| `file_read` | 读取本地文件内容 | read_only | 参考 `doc-read` 模式新增 |
| `file_search` | GLOB 模式搜索文件 | read_only | 用 Node.js `glob` API 封装 |
| `bash_exec` | 执行 shell 命令 | write（需权限） | 参考 Claude Code BashTool，使用 Node.js child_process |
| `web_search` | 联网搜索 | read_only | 可选，仅当 Ollama 联网时可用 |

**关键文件**：
- `packages/tools/src/file-read/index.ts`（新增）
- `packages/tools/src/file-search/index.ts`（新增）
- `packages/tools/src/bash-exec/index.ts`（新增）
- `packages/tools/src/base.ts`（Tool 基类增强）
- `apps/desktop/electron/runtime-factory.ts`（注册新工具）

---

## 二、RAG / 向量数据库检索

### 目标
构建完整可用的本地知识库检索：文档索引 → LanceDB 向量存储 → FTS5 稀疏检索 → 混合融合 → 引用输出

### 2.1 LanceDB 向量存储增强

**当前实现**：
- `@lancedb/lancedb` v0.30.0
- `LanceDBVectorStore` 封装
- IVF_PQ 索引（256 条后自动创建）
- `mergeInsert` 增量更新

**加固方案**：

| 改进项 | 现状 | 方案 |
|--------|------|------|
| 索引策略 | 仅 IVF_PQ | 小数据量（<256 条）走 flat 暴力搜索，大数据量用 IVF_PQ |
| 健康检查 | 无 | 新增 `health()` 方法检查 LanceDB 连接和表状态 |
| 重建索引 | 无 | 新增 `reindex()` 方法，支持重建 |
| 降级路径 | MemoryVectorStore 有数据无持久化 | 降级路径写入 JSON 持久化文件 |
| Worker 模式 | 不访问 LanceDB | Worker 通过 IPC 透传访问主进程 LanceDB |

**关键文件**：
- `packages/rag/src/lancedb-store.ts`
- `packages/rag/src/memory-store.ts`（增强持久化）
- `packages/rag/src/knowledge-index.ts`

**验证**：LanceDB 连接 → 写入 → 检索 → 重建 → 降级 全路径可测

### 2.2 检索管线完整闭环

**当前实现**（已有，需要增强）：

```
normalize → rewrite → dense → sparse → fusion → rerank → grade → truncate → pack
```

**加固方案**：

| 环节 | 现状 | 问题 | 方案 |
|------|------|------|------|
| normalize | ✅ | — | 保留 |
| rewrite | ✅ RuleBased + OllamaQueryRewriter | Worker 模式无 rewrite | Worker 模式通过 IPC 调用主进程 rewrite |
| dense | ✅ LanceDB vector search | — | 保留 |
| sparse | ✅ BM25 + SQLite FTS5 | Worker 模式无 FTS5 | Worker 模式通过 IPC 访问主进程 SQLite |
| fusion | ✅ RRF (k=60) | k 值固定 | 改为可配置，默认 k=60 |
| rerank | ✅ BGEReranker / PassThrough | — | 保留，BGE 不可用时自动 PassThrough |
| grade | ✅ ScoreAndKeywordGrader | — | 保留 |
| truncate | ✅ budgetTokens | — | 保留 |
| pack | ✅ [ref_N] | — | 保留 |

**关键文件**：
- `packages/rag/src/retrieval-pipeline.ts`
- `packages/rag/src/bm25-search.ts`
- `packages/rag/src/hybrid-fusion.ts`
- `packages/rag/src/components.ts`
- `apps/desktop/electron/runtime-factory.ts`

**验证**：
- `tests/e2e/hybrid-rag-pipeline.test.ts`
- `tests/e2e/rag-quality-regression.test.ts`

### 2.3 知识库生命周期完整闭环

**当前实现**（基本完整，需要测试验证）：

```
用户添加文件 → KnowledgeService.addDocument()
  → IngestPipeline.ingest() → ExtractedDocument
  → DocumentChunker.chunk() → DocumentChunk[]
  → OllamaEmbedder.embedBatch() → VectorChunk[]
  → LanceDBVectorStore.upsert() → 向量索引
  → SQLite chunks 表写入全文 → FTS5 同步
```

**测试验证覆盖**：

| 场景 | 预期行为 |
|------|---------|
| 新增 docx 文件 | 解析 → 分块 → 嵌入 → 向量 + FTS5 双索引 |
| 重复文件（SHA-256 未变）| 幂等跳过，不重复索引 |
| 修改文件后添加 | 检测到 SHA-256 变更，删除旧索引 → 重新索引 |
| 删除知识 | 清理 LanceDB 向量 + SQLite 元数据 + FTS5 |
| 重启后检索 | 知识库内容保留（依赖 LanceDB 持久化） |
| 跨 Workspace | 移动文档归属，向量不变 |
| 索引进度 | callback 上报 10%/30%/70%/100% 进度 |
| 索引失败 | 状态标记为 error，保留错误信息 |

**关键文件**：
- `apps/desktop/electron/ipc/knowledge-ipc.ts`
- `apps/desktop/electron/services/knowledge-service.ts`
- `packages/rag/src/engine.ts`
- `apps/desktop/src/hooks/useKnowledgeManager.ts`

**验证**：`tests/e2e/knowledge-lifecycle.test.ts`、`tests/e2e/knowledge-service-closure.test.ts`

---

## 三、文档操作读取解析

### 目标
完整的文档流水线：解析 → 读取 → 生成 → 导出，支持公文格式规范

### 3.1 文档解析增强

**当前问题**：
- 表格提取缺失
- 文档结构信息保留不足
- PDF 非标准编码处理不完善

**改动方案**：

```
packages/ingest/src/
├── docx.ts          → 增强：表格提取（行/列/合并单元格）
│                     增强：保留标题层级嵌套结构
│                     增强：保留图片占位符（用于引用标记）
├── pdf.ts           → 增强：段落+标题分层
│                     修复：非标准编码（GBK/GB2312）支持
├── pipeline.ts      → 增强：进度回调（10% 粒度）
├── txt.ts           → 保留
├── pttx.ts          → 保留
```

**关键文件**：
- `packages/ingest/src/docx.ts`
- `packages/ingest/src/pdf.ts`
- `packages/ingest/src/pipeline.ts`
- `packages/shared/src/types.ts`（ExtractedDocument 接口增强，增加表格/结构类型）

**验证**：`packages/ingest/src/__tests__/*`

### 3.2 文档生成与导出

**当前问题**：`docgen` 包已有基础 Markdown → docx 能力，但样式和模板不够成熟

**改动方案**：

| 模块 | 内容 |
|------|------|
| `writer.ts` | 增强段落/标题/表格/列表渲染 |
| `styles.ts` | 增加公文标准样式：正文（方正仿宋_GBK 17磅）、标题（方正小标宋_GBK 22磅）等 |
| `templates.ts` | 4 类公文模板：通知/请示/报告/函 |
| `index.ts` | 新增 `generateWithReferences()` — 导出时自动附文末引用列表 |

**引用注入机制**：
```
对话中出现的 [ref_1] [ref_2] 标记
  → 导出 docx 时自动生成「参考资料」章节
  → 列出对应来源文件名、索引位置、摘要
```

**关键文件**：
- `packages/docgen/src/writer.ts`
- `packages/docgen/src/styles.ts`
- `packages/docgen/src/templates.ts`
- `packages/docgen/src/index.ts`

**验证**：`tests/e2e/output-closure.test.ts`

---

## 四、本地文件知识库 UI

### 目标
用户能在桌面应用中直观管理知识库：查看状态、搜索内容、增删文档

### 4.1 知识库面板完善

**改动方案**：

```
apps/desktop/src/components/knowledge-panel.tsx
├── 文档列表展示（文件名、类型、状态、时间）
├── 索引进度条（progress 0-100%）
├── 状态标签（pending/extracting/indexed/error）
├── 搜索输入 → 实时检索结果预览
├── 批量选择 → 批量删除/移动到工作区
├── 右键菜单（删除、刷新）

apps/desktop/src/hooks/useKnowledgeManager.ts
├── 文档列表查询（按工作区/状态过滤）
├── 搜索（带匹配度分数展示）
├── 删除（UI 确认 → IPC 调用 → 刷新列表）
├── 索引进度监听（useAgentEvents 集成）
├── 刷新（检测文件变化增量更新）

apps/desktop/src/stores/knowledge-store.ts
├── 文档列表状态
├── 搜索状态/结果
├── 索引队列状态
├── 错误状态
```

### 4.2 知识库 IPC 增强

| 通道 | 增强内容 |
|------|---------|
| `knowledge-search` | 返回结果含匹配度分数 `score` 和来源片段 `locator` |
| `knowledge-list` | 支持按状态过滤（indexed/pending/error） |
| `knowledge-refresh` | 支持增量刷新：只扫描变更文件 |

**关键文件**：
- `apps/desktop/electron/ipc/knowledge-ipc.ts`
- `packages/rag/src/engine.ts`

---

## 五、实施路线

### 第一批：骨架加固 + 文档解析（2 周）

| # | 任务 | 涉及文件 | 验证 |
|---|------|---------|------|
| 1 | 统一 Runtime 装配工厂 | runtime-factory.ts, agent-worker.ts, worker-bridge.ts | `runtime.worker-parity.test.ts` ✅ |
| 2 | 运行态事件标准化 | runtime.ts, ipc-handlers.ts, useAgentEvents.ts | `runtime-abort.test.ts` ✅ |
| 3 | 错误恢复验证 | runtime.ts, compact-recovery.ts | `recovery-transcript.test.ts` ✅ |
| 4 | 工具扩充（4 个新工具） | file-read, file-search, bash-exec, base.ts | tools test ✅ |
| 5 | 文档解析表格/结构增强 | docx.ts, pdf.ts, pipeline.ts, types.ts | ingest test ✅ |

### 第二批：RAG 检索 + 向量库（2 周）

| # | 任务 | 涉及文件 | 验证 |
|---|------|---------|------|
| 6 | LanceDB 索引策略增强 | lancedb-store.ts, knowledge-index.ts | `knowledge-lifecycle.test.ts` ✅ |
| 7 | Worker 模式 FTS5 通路 | bm25-search.ts, runtime-factory.ts | `hybrid-rag-pipeline.test.ts` ✅ |
| 8 | 检索管线 RRF 优化 | hybrid-fusion.ts, retrieval-pipeline.ts | `retrieval-pipeline.test.ts` ✅ |
| 9 | 知识库生命周期验证 | knowledge-service.ts, knowledge-ipc.ts | `knowledge-lifecycle.test.ts` ✅ |

### 第三批：知识库 UI + 文档导出（2 周）

| # | 任务 | 涉及文件 | 验证 |
|---|------|---------|------|
| 10 | 知识库面板 | knowledge-panel.tsx, knowledge-store.ts | `desktop-smoke.test.ts` ✅ |
| 11 | 知识库搜索反馈 | knowledge-ipc.ts, engine.ts | UI 人工验证 |
| 12 | 文档样式 + 模板 | styles.ts, templates.ts | docgen test ✅ |
| 13 | 引用注入导出 | writer.ts, citationRehydrate.ts | `output-closure.test.ts` ✅ |

---

## 六、验证标准

### Agent 运行时
- [ ] Main Process 和 Worker 装配一致（`runtime.worker-parity.test.ts` ✅）
- [ ] `run_status` 事件完整覆盖 running/failed/aborted/completed
- [ ] Context overflow / max_output_tokens / 网络超时三级恢复可验证
- [ ] 工具数量 ≥ 11（7 原有 + 4 新增），权限检查正常

### 知识库 / RAG
- [ ] LanceDB 连接 → 写入 → 检索 → 重建 → 降级 全路径可测
- [ ] 文档导入：docx/pdf/pptx/txt → 分块 → 嵌入 → LanceDB 向量 → FTS5 → hybrid 检索
- [ ] 文档重复（SHA-256 未变）幂等跳过
- [ ] 文档变更后重新索引成功
- [ ] Worker 模式检索结果与 Direct 模式一致
- [ ] 应用重启后知识库存活

### 文档操作
- [ ] DOCX 表格可提取（含多行/跨列合并单元格）
- [ ] 文档标题层级嵌套结构完整保留
- [ ] Markdown → docx 导出符合 4 类公文样式规范
- [ ] `[ref_N]` 引用自动注入到导出文档文末

### 整体
- [ ] `pnpm test:unit` 全绿
- [ ] `pnpm exec vitest run tests/e2e/` 全绿
- [ ] 桌面端闭环：创建会话 → 导入知识 → 对话中检索引用 → 导出为 docx

---

## 附录：向量数据库方案说明

LanceDB `@lancedb/lancedb` v0.30.0 节点说明：
- **npm install 时自动下载**对应平台（win32-x64）的原生库，无手动安装步骤
- **打包到安装包**：electron-rebuild 编译后，与 better-sqlite3 一样被打包进 app.asar
- **用户视角**：只需安装 WorkAgent 应用 → 启动 → 系统自动使用，对用户完全透明
- **数据存储位置**：`appDataDir/vectors/`（应用数据目录下，用户不需要关心）
- **与 SQLite 的分工**：LanceDB 存向量 + 检索，SQLite 存文档元数据 + chunks 全文 + FTS5

```
用户文件 (.docx/.pdf/.pptx/.txt)
  → IngestPipeline 解析
  → DocumentChunker 分块 (chunk_size=500, overlap=50)
  → OllamaEmbedder 嵌入 (bge-m3, 1024维)
  → ┌─────────────────────┐
    │ LanceDB (向量检索)    │ ← 存向量 + chunkId + sourceFile
    │   IVF_PQ 索引         │
    └─────────────────────┘
  + ┌───────────────────────────────┐
    │ SQLite (元数据 + 全文)          │
    │   documents 表 → 文件元信息     │
    │   chunks 表 → 全文 + locator   │
    │   chunks_fts → FTS5 稀疏索引   │
    └───────────────────────────────┘
  → RetrievalPipeline (dense + sparse → RRF → rerank → grade → pack)
  → [ref_N] 引用格式输出到对话/文档
```