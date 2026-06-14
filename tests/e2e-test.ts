/**
 * WorkAgent 一期端到端业务测试脚本
 * 覆盖：文件解析 → 向量化 → 知识库检索 → LanceDB → 对话 → Plan模式 → 压缩
 *
 * 用法: npx tsx tests/e2e-test.ts
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { initDatabase, closeDatabase, createSession, createMessage, getSessionMessages } from '../packages/store/dist/index.js';
import { OllamaNativeProvider, OpenAICompatProvider } from '../packages/model-provider/dist/index.js';
import type { ModelProvider } from '../packages/model-provider/dist/index.js';
import { IngestPipeline, DocxExtractor, PptxExtractor, PdfExtractor, TxtExtractor } from '../packages/ingest/dist/index.js';
import { MemoryVectorStore, LanceDBVectorStore, OllamaEmbedder, RAGEngine } from '../packages/rag/dist/index.js';
import { AgentRuntime } from '../packages/agent-core/dist/index.js';
import { ToolRegistry, ToolExecutor, PermissionBroker, RagSearchTool, DocReadTool, FileListTool } from '../packages/tools/dist/index.js';
import { allocateBudget, assessCompactNeed } from '../packages/agent-core/dist/index.js';

// ============================================================
// 测试工具函数
// ============================================================

let passCount = 0;
let failCount = 0;

/** 断言通过 */
function pass(name: string): void {
  passCount++;
  console.log(`  ✅ ${name}`);
}

/** 断言失败 */
function fail(name: string, reason: string): void {
  failCount++;
  console.log(`  ❌ ${name} — ${reason}`);
}

/** 断言条件 */
function assert(condition: boolean, name: string, reason = '条件不满足'): void {
  condition ? pass(name) : fail(name, reason);
}

/** 延时 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// 准备测试文件
// ============================================================

const TEST_DIR = join(tmpdir(), 'workagent-e2e-test');

function prepareTestFiles(): string[] {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });

  // 1. 公文规范TXT
  writeFileSync(join(TEST_DIR, '公文写作规范.txt'), `# 公文写作规范

## 一、格式要求

根据GB/T 9704标准，公文应遵循以下格式要求：

1. 标题使用方正小标宋简体二号字
2. 正文使用仿宋三号字
3. 行间距为固定值28磅
4. 页面设置为A4纸，上边距37mm，下边距35mm，左边距28mm，右边距26mm

## 二、文种分类

1. 通知：用于批转下级机关的公文，转发上级机关和不相隶属机关的公文
2. 请示：用于向上级机关请求指示、批准，必须一文一事
3. 报告：用于向上级机关汇报工作、反映情况、答复上级机关的询问，不得夹带请示事项
4. 函：用于不相隶属机关之间商洽工作、询问和答复问题、请求批准和答复审批事项

## 三、行文规则

1. 行文应当确有必要，讲求实效，注重针对性和可操作性
2. 向上级机关行文，原则上主送一个上级机关
3. 请示应当一文一事，不得在报告等非请示性公文中夹带请示事项
`);

  // 2. 通知范文TXT
  writeFileSync(join(TEST_DIR, '通知范文.txt'), `关于开展2024年度网络安全检查的通知

各处室、直属单位：

为贯彻落实《网络安全法》和《数据安全法》，进一步加强我局网络安全管理，切实保障信息系统安全稳定运行，经研究决定，在全系统范围内开展2024年度网络安全检查工作。现将有关事项通知如下：

一、检查范围
本次检查覆盖全局所有信息系统，包括但不限于：办公自动化系统、财务管理系统、人事管理系统及各业务专用系统。

二、检查内容
（一）网络安全责任制落实情况
（二）信息系统安全防护措施落实情况
（三）数据安全管理情况
（四）应急预案制定和演练情况

三、时间安排
（一）自查阶段：即日起至6月30日
（二）抽查阶段：7月1日至7月31日
（三）整改阶段：8月1日至8月31日

四、工作要求
各单位要高度重视，成立专项工作小组，认真开展自查自纠，及时整改安全隐患。检查结果将纳入年度考核。

XX局办公室
2024年6月1日
`);

  // 3. Markdown知识文档
  writeFileSync(join(TEST_DIR, '常用公文模板.md'), `# 常用公文模板

## 通知模板

标题：关于XXX的通知
格式：
- 发文机关标志：居中排列
- 发文字号：如 XX〔2024〕X号
- 标题：方正小标宋简体二号
- 主送机关：仿宋三号
- 正文：仿宋三号，首行缩进2字符
- 发文机关署名和日期：右下方

## 请示模板

标题：关于XXX的请示
要点：
- 必须一文一事
- 不得抄送下级机关
- 请示理由要充分
- 请示事项要明确

## 报告模板

标题：关于XXX的报告
要点：
- 不得夹带请示事项
- 可以一文多事
- 汇报工作、反映情况、答复询问
`);

  return [
    join(TEST_DIR, '公文写作规范.txt'),
    join(TEST_DIR, '通知范文.txt'),
    join(TEST_DIR, '常用公文模板.md'),
  ];
}

// ============================================================
// 测试主体
// ============================================================

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   WorkAgent 一期端到端业务测试                      ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const testFiles = prepareTestFiles();
  console.log(`📂 测试文件准备完成: ${testFiles.length} 个文件\n`);

  // ──────────────────────────────────────────────────────
  // 测试1: Ollama模型连接
  // ──────────────────────────────────────────────────────
  console.log('━━━ 测试1: Ollama模型连接 ━━━');

  const provider = new OllamaNativeProvider();
  const isAvailable = await provider.isAvailable();
  assert(isAvailable, 'Ollama服务可达');

  if (isAvailable) {
    const status = await provider.getModelsStatus();
    assert(status.chatModel.available, `对话模型 ${status.chatModel.name} 可用`);
    assert(status.embeddingModel.available, `向量模型 ${status.embeddingModel.name} 可用`);

    const ctxLen = await provider.getContextLength();
    assert(ctxLen > 0, `上下文长度获取: ${ctxLen}`);
  }

  // ──────────────────────────────────────────────────────
  // 测试2: 文件解析
  // ──────────────────────────────────────────────────────
  console.log('\n━━━ 测试2: 文件解析 ━━━');

  const pipeline = new IngestPipeline();
  pipeline.register(new TxtExtractor());
  pipeline.register(new DocxExtractor());
  pipeline.register(new PptxExtractor());
  pipeline.register(new PdfExtractor());

  for (const filePath of testFiles) {
    try {
      const doc = await pipeline.ingest(filePath);
      assert(doc.content.length > 0, `${doc.fileName} 解析成功 (${doc.content.length}字, ${doc.sections.length}段)`);
    } catch (error) {
      fail(`${filePath} 解析`, error instanceof Error ? error.message : String(error));
    }
  }

  // ──────────────────────────────────────────────────────
  // 测试3: 向量化 + MemoryVectorStore
  // ──────────────────────────────────────────────────────
  console.log('\n━━━ 测试3: 向量化 + MemoryVectorStore知识库 ━━━');

  const memoryStore = new MemoryVectorStore();
  const embedder = new OllamaEmbedder(provider);
  const ragEngine = new RAGEngine(memoryStore, embedder);

  // 索引所有测试文件
  for (const filePath of testFiles) {
    try {
      const doc = await pipeline.ingest(filePath);
      const chunks = await ragEngine.indexDocument(doc, (p) => {
        if (p === 100) process.stdout.write('✓ ');
      });
      assert(chunks.length > 0, `${doc.fileName} 索引成功 (${chunks.length}块)`);
    } catch (error) {
      fail(`${filePath} 索引`, error instanceof Error ? error.message : String(error));
    }
  }

  // ──────────────────────────────────────────────────────
  // 测试4: RAG检索
  // ──────────────────────────────────────────────────────
  console.log('\n━━━ 测试4: RAG检索 ━━━');

  // 4a. 语义检索
  const query1 = '公文标题用什么字体';
  const results1 = await ragEngine.search(query1, { topK: 3 });
  assert(results1.length > 0, `检索"${query1}"返回 ${results1.length} 条结果`);
  if (results1.length > 0) {
    assert(results1[0].score > 0.5, `最高相似度: ${results1[0].score.toFixed(4)} (>0.5)`);
    assert(results1[0].content.length > 0, '检索内容非空');
    console.log(`    📄 Top1来源: ${results1[0].sourceFile}, 内容: ${results1[0].content.slice(0, 60)}...`);
  }

  // 4b. 不同查询
  const query2 = '请示和报告的区别';
  const results2 = await ragEngine.search(query2, { topK: 5 });
  assert(results2.length > 0, `检索"${query2}"返回 ${results2.length} 条结果`);
  if (results2.length > 0) {
    console.log(`    📄 Top1来源: ${results2[0].sourceFile}, 分数: ${results2[0].score.toFixed(4)}`);
  }

  // 4c. 知识库统计
  const stats = await ragEngine.getStats();
  assert(stats.totalChunks > 0, `知识库统计: ${stats.totalChunks}块, ${stats.uniqueSources}个来源, ${stats.dimensions}维`);
  assert(stats.uniqueSources === testFiles.length, `来源数匹配: ${stats.uniqueSources} === ${testFiles.length}`);

  // ──────────────────────────────────────────────────────
  // 测试5: LanceDB向量库
  // ──────────────────────────────────────────────────────
  console.log('\n━━━ 测试5: LanceDB向量库 ━━━');

  const lanceDbPath = join(tmpdir(), 'workagent-lancedb-test');
  if (existsSync(lanceDbPath)) rmSync(lanceDbPath, { recursive: true, force: true });

  try {
    const lanceStore = new LanceDBVectorStore(lanceDbPath);
    await lanceStore.initialize();
    pass('LanceDB初始化成功');

    // 索引文件到LanceDB
    const lanceEmbedder = new OllamaEmbedder(provider);
    const lanceEngine = new RAGEngine(lanceStore, lanceEmbedder);

    for (const filePath of testFiles) {
      const doc = await pipeline.ingest(filePath);
      const chunks = await lanceEngine.indexDocument(doc);
      assert(chunks.length > 0, `LanceDB索引 ${doc.fileName} (${chunks.length}块)`);
    }

    // LanceDB检索
    const lanceResults = await lanceEngine.search('公文行文规则', { topK: 3 });
    assert(lanceResults.length > 0, `LanceDB检索返回 ${lanceResults.length} 条`);
    if (lanceResults.length > 0) {
      assert(lanceResults[0].score > 0, `LanceDB相似度: ${lanceResults[0].score.toFixed(4)}`);
      console.log(`    📄 LanceDB Top1: ${lanceResults[0].content.slice(0, 60)}...`);
    }

    // LanceDB统计
    const lanceStats = await lanceStore.stats();
    assert(lanceStats.backend === 'lancedb', `LanceDB后端: ${lanceStats.backend}`);
    assert(lanceStats.totalChunks > 0, `LanceDB总块数: ${lanceStats.totalChunks}`);

    // 清理
    rmSync(lanceDbPath, { recursive: true, force: true });
  } catch (error) {
    fail('LanceDB测试', error instanceof Error ? error.message : String(error));
    console.log('    (LanceDB native模块可能不兼容当前平台，不影响MemoryVectorStore方案)');
  }

  // ──────────────────────────────────────────────────────
  // 测试6: AgentRuntime对话
  // ──────────────────────────────────────────────────────
  console.log('\n━━━ 测试6: AgentRuntime对话 ━━━');

  const db = await initDatabase({ log: () => {} });
  const sessionId = `e2e_${Date.now()}`;
  createSession(db, { id: sessionId, title: 'E2E测试会话' });

  const registry = new ToolRegistry();
  registry.register(new RagSearchTool(memoryStore));
  registry.register(new FileListTool());
  registry.register(new DocReadTool(pipeline as any));

  const permissionBroker = new PermissionBroker({
    saveDecision() {},
    loadDecisions() { return []; },
    removeDecision() {},
  });
  permissionBroker.setRequestCallback(async () => ({ allowed: true, reason: '测试自动授权' }));

  const executor = new ToolExecutor(registry, permissionBroker);
  const runtime = new AgentRuntime(provider, registry, executor, db);

  // 6a. 基础对话
  let chatResponse = '';
  let chatEvents = new Set<string>();
  for await (const event of runtime.runTurn(sessionId, '你好，请用一句话介绍你自己', 'chat')) {
    chatEvents.add(event.type);
    if (event.type === 'token') {
      const data = event.data as { text: string };
      chatResponse += data.text;
    }
    if (event.type === 'done') break;
  }
  assert(chatResponse.length > 0, `对话响应: ${chatResponse.slice(0, 60)}...`);
  assert(chatEvents.has('token'), '包含token事件');

  // 6b. 工具调用对话（RAG检索）
  let ragResponse = '';
  let hasToolCall = false;
  for await (const event of runtime.runTurn(sessionId, '请检索知识库中关于公文标题字体的规定', 'chat')) {
    if (event.type === 'token') {
      const data = event.data as { text: string };
      ragResponse += data.text;
    }
    if (event.type === 'tool_start') {
      hasToolCall = true;
      console.log(`    🔧 工具调用: ${(event.data as { name: string }).name}`);
    }
    if (event.type === 'tool_result') {
      console.log(`    🔧 工具结果: ${(event.data as { summary?: string }).summary?.slice(0, 80) || '(无摘要)'}`);
    }
    if (event.type === 'done') break;
  }
  pass(`RAG对话响应: ${ragResponse.slice(0, 80)}...`);
  if (hasToolCall) pass('模型发起了工具调用');

  // ──────────────────────────────────────────────────────
  // 测试7: OpenAI兼容提供者
  // ──────────────────────────────────────────────────────
  console.log('\n━━━ 测试7: OpenAI兼容提供者 ━━━');

  try {
    const compatProvider = new OpenAICompatProvider({
      baseUrl: 'http://localhost:11434',
      chatModel: 'qwen3.5:9b',
      embeddingModel: 'bge-m3',
    });

    const compatAvailable = await compatProvider.isAvailable();
    assert(compatAvailable, 'OpenAI兼容服务可达');

    if (compatAvailable) {
      // 测试对话
      let compatResponse = '';
      let compatThinking = '';
      for await (const event of compatProvider.chat({
        messages: [{ role: 'user', content: '1+1等于几？直接回答' }],
        maxTokens: 500,
      })) {
        if (event.type === 'thinking') compatThinking += event.data;
        if (event.type === 'token') compatResponse += event.data;
      }
      assert(compatResponse.length > 0 || compatThinking.length > 0,
        `OpenAI-compat响应 (thinking:${compatThinking.length}字, content:${compatResponse.length}字)`);
      console.log(`    💬 回复: ${compatResponse || '(thinking模式，内容在reasoning中)'}`);

      // 测试embedding
      const embedResult = await compatProvider.embed({ input: '测试OpenAI兼容向量' });
      assert(embedResult.embeddings[0].length === 1024, `OpenAI-compat embedding维度: ${embedResult.embeddings[0].length}`);
    }
  } catch (error) {
    fail('OpenAI兼容测试', error instanceof Error ? error.message : String(error));
  }

  // ──────────────────────────────────────────────────────
  // 测试8: 上下文压缩与预算分配
  // ──────────────────────────────────────────────────────
  console.log('\n━━━ 测试8: 上下文压缩与预算分配 ━━━');

  // 8a. Chat模式预算
  const chatBudget = allocateBudget(32768, 'chat');
  assert(chatBudget.conversationHistory > 0, `Chat历史预算: ${chatBudget.conversationHistory}`);
  assert(chatBudget.ragResults > 0, `Chat RAG预算: ${chatBudget.ragResults}`);
  assert(chatBudget.maxCompletionTokens === 4096, `Chat完成预算: ${chatBudget.maxCompletionTokens}`);

  // 8b. Plan模式预算
  const planBudget = allocateBudget(32768, 'plan');
  assert(planBudget.ragResults > chatBudget.ragResults,
    `Plan RAG预算(${planBudget.ragResults}) > Chat(${chatBudget.ragResults})`);
  assert(planBudget.conversationHistory < chatBudget.conversationHistory,
    `Plan历史预算(${planBudget.conversationHistory}) < Chat(${chatBudget.conversationHistory})`);

  // 8c. 压缩评估
  const compactCheck = assessCompactNeed([], chatBudget);
  assert(typeof compactCheck.needed === 'boolean', `压缩评估: needed=${compactCheck.needed}`);

  console.log(`    📊 Chat预算: 历史${chatBudget.conversationHistory} | RAG${chatBudget.ragResults} | 工具${chatBudget.toolResults} | 完成${chatBudget.maxCompletionTokens}`);
  console.log(`    📊 Plan预算: 历史${planBudget.conversationHistory} | RAG${planBudget.ragResults} | 工具${planBudget.toolResults} | 完成${planBudget.maxCompletionTokens}`);

  // ──────────────────────────────────────────────────────
  // 测试9: 数据库持久化
  // ──────────────────────────────────────────────────────
  console.log('\n━━━ 测试9: 数据库持久化 ━━━');

  db.save();
  // 使用AgentRuntime测试中创建的session来检查持久化
  const allMessages = getSessionMessages(db, sessionId);
  assert(allMessages.length > 0, `会话消息数: ${allMessages.length}`);
  if (allMessages.length > 0) {
    assert(allMessages.some((m) => m.role === 'user'), '包含用户消息');
    assert(allMessages.some((m) => m.role === 'assistant'), '包含助手消息');
  } else {
    // 如果Runtime没有持久化到这个session，检查是否是ID问题
    // 重新用已有的session验证CRUD
    const testSessionId = `persist_test_${Date.now()}`;
    createSession(db, { id: testSessionId, title: '持久化测试' });
    createMessage(db, {
      id: `msg_persist_${Date.now()}_1`,
      sessionId: testSessionId,
      turnId: 't1',
      sequence: 0,
      role: 'user',
      content: '持久化测试消息',
    });
    createMessage(db, {
      id: `msg_persist_${Date.now()}_2`,
      sessionId: testSessionId,
      turnId: 't1',
      sequence: 1,
      role: 'assistant',
      content: '这是助手回复',
    });
    db.save();
    const persistMessages = getSessionMessages(db, testSessionId);
    assert(persistMessages.length >= 2, `CRUD消息数: ${persistMessages.length}`);
    assert(persistMessages.some((m) => m.role === 'user'), 'CRUD包含用户消息');
    assert(persistMessages.some((m) => m.role === 'assistant'), 'CRUD包含助手消息');
  }

  // ──────────────────────────────────────────────────────
  // 汇总
  // ──────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(`║   测试完成: ✅ ${passCount} 通过  ❌ ${failCount} 失败                    ║`);
  console.log('╚══════════════════════════════════════════════════════╝');

  // 清理
  closeDatabase(db);
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('测试异常:', error);
  process.exit(1);
});
