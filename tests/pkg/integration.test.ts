/**
 * 集成测试 - 验证各核心包的功能
 * 运行方式: npx tsx tests/integration.test.ts
 */

import { initDatabase, closeDatabase, createSession, getSession, listSessions, deleteSession, createMessage, getSessionMessages, updateSession } from '@workagent/store';
import type { Database } from '@workagent/store';
import { MockModelProvider } from '@workagent/model-provider';
import { IngestPipeline, DocxExtractor, PptxExtractor, PdfExtractor, TxtExtractor } from '@workagent/ingest';
import { MemoryVectorStore, OllamaEmbedder, RAGEngine, DocumentChunker } from '@workagent/rag';
import { ToolRegistry, ToolExecutor, PermissionBroker } from '@workagent/tools';
import { DocReadTool, FileListTool, RagSearchTool, DraftOutlineTool } from '@workagent/tools';
import { AgentRuntime } from '@workagent/agent-core';
import { generateMarkdown, markdownToDocx, fillTemplate, getAvailableDocTypes, TEMPLATE_NOTICE } from '@workagent/docgen';
import type { PlanOutline } from '@workagent/shared';
import { SUPPORTED_FILE_EXTENSIONS } from '@workagent/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ============================================================
// 测试工具
// ============================================================

let passed = 0;
let failed = 0;
const errors: string[] = [];

/** 断言辅助 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed++;
    errors.push(`FAIL: ${message}`);
    console.log(`  ❌ ${message}`);
  } else {
    passed++;
    console.log(`  ✅ ${message}`);
  }
}

/** 创建临时目录 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'workagent-test-'));
}

// ============================================================
// 测试1: Store - 数据库CRUD
// ============================================================

async function testStore(): Promise<void> {
  console.log('\n📦 测试 Store (数据库CRUD)');

  const db = await initDatabase({ log: () => {} });
  assert(db !== null, '数据库初始化成功');

  // 创建会话
  const session = createSession(db, { id: 'test-session-1', title: '测试会话', mode: 'chat' });
  assert(session.id === 'test-session-1', '创建会话成功');

  // 读取会话
  const loaded = getSession(db, 'test-session-1');
  assert(loaded !== undefined, '读取会话成功');
  assert(loaded?.title === '测试会话', '会话标题正确');

  // 列出会话
  const sessions = listSessions(db);
  assert(sessions.length >= 1, '列出会话成功');

  // 更新会话
  updateSession(db, 'test-session-1', { title: '更新后的标题' });
  const updated = getSession(db, 'test-session-1');
  assert(updated?.title === '更新后的标题', '更新会话成功');

  // 创建消息
  createMessage(db, {
    id: 'msg-1',
    sessionId: 'test-session-1',
    turnId: 'turn-1',
    sequence: 0,
    role: 'user',
    content: '你好',
  });
  createMessage(db, {
    id: 'msg-2',
    sessionId: 'test-session-1',
    turnId: 'turn-1',
    sequence: 1,
    role: 'assistant',
    content: '你好！我是WorkAgent助手。',
  });

  // 读取消息
  const messages = getSessionMessages(db, 'test-session-1');
  assert(messages.length === 2, '消息数量正确');
  assert(messages[0].content === '你好', '用户消息内容正确');
  assert(messages[1].content === '你好！我是WorkAgent助手。', '助手消息内容正确');

  // 删除会话
  deleteSession(db, 'test-session-1');
  const deleted = getSession(db, 'test-session-1');
  assert(deleted === undefined, '删除会话成功');

  closeDatabase(db);
}

// ============================================================
// 测试2: ModelProvider - MockProvider
// ============================================================

async function testModelProvider(): Promise<void> {
  console.log('\n🤖 测试 ModelProvider (MockProvider)');

  const provider = new MockModelProvider();
  const available = await provider.isAvailable();
  assert(available === true, 'MockProvider可用');

  const config = provider.getConfig();
  assert(config.chatModel === 'qwen3.5:9b', 'MockProvider配置正确');

  const status = await provider.getModelsStatus();
  assert(status.ollama === 'running', 'MockProvider状态为running');

  // 测试聊天
  let responseText = '';
  for await (const event of provider.chat({
    messages: [{ role: 'user', content: '测试消息' }],
  })) {
    if (event.type === 'token') {
      responseText += event.data;
    }
  }
  assert(responseText.length > 0, 'MockProvider返回了响应');

  // 测试Embedding
  const embedResult = await provider.embed({ input: ['测试文本'] });
  assert(embedResult.embeddings.length === 1, 'Embedding返回正确');
  assert(embedResult.embeddings[0].length > 0, 'Embedding向量维度正确');
}

// ============================================================
// 测试3: Ingest - 文档解析
// ============================================================

async function testIngest(): Promise<void> {
  console.log('\n📄 测试 Ingest (文档解析)');

  const pipeline = new IngestPipeline();
  pipeline.register(new DocxExtractor());
  pipeline.register(new PptxExtractor());
  pipeline.register(new PdfExtractor());
  pipeline.register(new TxtExtractor());

  // 测试txt解析
  const tmpDir = createTempDir();
  const txtPath = path.join(tmpDir, 'test.txt');
  fs.writeFileSync(txtPath, '# 测试标题\n\n这是第一段。\n\n这是第二段。\n', 'utf-8');

  const doc = await pipeline.ingest(txtPath);
  assert(doc.fileType === 'txt', 'TXT文件类型正确');
  assert(doc.content.includes('测试标题'), 'TXT内容包含标题');
  assert(doc.sections.length >= 1, 'TXT解析出章节');

  // 测试PDF占位解析
  const pdfPath = path.join(tmpDir, 'test.pdf');
  fs.writeFileSync(pdfPath, '%PDF-1.4\nfake pdf content');
  const pdfDoc = await pipeline.ingest(pdfPath);
  assert(pdfDoc.fileType === 'pdf', 'PDF文件类型正确');
  assert(pdfDoc.metadata.isPlaceholder === true, 'PDF为占位解析');

  // 测试不支持的文件类型
  let errorCaught = false;
  try {
    await pipeline.ingest(path.join(tmpDir, 'test.xyz'));
  } catch {
    errorCaught = true;
  }
  assert(errorCaught, '不支持的文件类型正确抛出错误');

  // 清理
  fs.rmSync(tmpDir, { recursive: true });
}

// ============================================================
// 测试4: RAG - 向量检索
// ============================================================

async function testRAG(): Promise<void> {
  console.log('\n🔍 测试 RAG (向量检索)');

  const provider = new MockModelProvider();
  const vectorStore = new MemoryVectorStore();
  const embedder = new OllamaEmbedder(provider);
  const engine = new RAGEngine(vectorStore, embedder);

  // 测试分块
  const chunker = new DocumentChunker();
  const chunks = chunker.chunk({
    filePath: '/test/test.txt',
    fileName: 'test.txt',
    fileType: 'txt',
    content: '这是第一段测试文本，用于验证文档分块功能是否正常工作。'.repeat(10),
    sections: [],
    metadata: {},
  });
  assert(chunks.length >= 1, '文档分块成功');

  // 测试统计
  const stats = await vectorStore.stats();
  assert(stats.backend === 'memory', '向量库后端为memory');

  // 测试空向量库统计
  const emptyStats = await vectorStore.stats();
  assert(emptyStats.totalChunks === 0, '空向量库统计正确');
}

// ============================================================
// 测试5: Docgen - 文档生成
// ============================================================

async function testDocgen(): Promise<void> {
  console.log('\n📝 测试 Docgen (文档生成)');

  // 测试模板
  const docTypes = getAvailableDocTypes();
  assert(docTypes.length >= 4, '至少有4种公文模板');

  // 测试通知模板填充
  const noticeTemplate = TEMPLATE_NOTICE;
  const filled = fillTemplate(noticeTemplate, {
    title: '关于开展测试工作的通知',
    mainRecipient: '各部门',
    content: '现就测试工作有关事项通知如下：',
    issuer: '测试办公室',
    date: '2026年6月13日',
  });
  assert(filled.includes('关于开展测试工作的通知'), '模板填充成功');
  assert(filled.includes('各部门'), '主送机关填充正确');

  // 测试Markdown生成
  const plan: PlanOutline = {
    title: '测试公文',
    goal: '验证Markdown生成',
    materialBasis: '测试材料',
    structure: [
      { id: 'step1', description: '一、背景', toolName: undefined, toolInput: undefined, status: 'completed', result: '背景描述' },
      { id: 'step2', description: '二、要求', toolName: undefined, toolInput: undefined, status: 'completed', result: '具体要求' },
    ],
    expectedOutput: '一份测试公文',
    risks: ['风险1'],
    questions: [],
    citations: [],
  };

  const markdown = generateMarkdown(plan, {
    step1: '这是背景段落的内容。',
    step2: '这是具体要求段落的内容。',
  });
  assert(markdown.includes('# 测试公文'), 'Markdown标题正确');
  assert(markdown.includes('背景'), 'Markdown包含章节');
  assert(markdown.includes('风险1'), 'Markdown包含风险');

  // 测试docx输出（回退到.md因为需要docx包运行时支持）
  const tmpDir = createTempDir();
  const outputPath = path.join(tmpDir, 'test-output.md');
  const result = await markdownToDocx(markdown, outputPath);
  assert(fs.existsSync(result.outputPath), '文档文件已生成');

  fs.rmSync(tmpDir, { recursive: true });
}

// ============================================================
// 测试6: Tools - 工具注册与执行
// ============================================================

async function testTools(): Promise<void> {
  console.log('\n🔧 测试 Tools (工具系统)');

  const registry = new ToolRegistry();

  // 注册工具
  registry.register(new FileListTool() as any);
  registry.register(new DraftOutlineTool() as any);

  assert(registry.has('file_list'), 'FileListTool注册成功');
  assert(registry.has('draft_outline'), 'DraftOutlineTool注册成功');

  // 按模式过滤
  const chatTools = registry.getTools('chat');
  assert(chatTools.length >= 1, 'chat模式有可用工具');

  const planTools = registry.getTools('plan');
  assert(planTools.some(t => t.name === 'draft_outline'), 'plan模式包含draft_outline');

  // 测试提纲生成工具
  const outlineTool = registry.getTool('draft_outline');
  assert(outlineTool !== undefined, '获取工具成功');
  assert(outlineTool!.safety === 'read_only', '提纲工具为只读');
}

// ============================================================
// 测试7: AgentRuntime - 完整agentic loop
// ============================================================

async function testAgentRuntime(): Promise<void> {
  console.log('\n🧠 测试 AgentRuntime (完整运行时)');

  const db = await initDatabase({ log: () => {} });
  const provider = new MockModelProvider();
  const registry = new ToolRegistry();

  // 注册最少工具
  registry.register(new FileListTool() as any);
  registry.register(new DraftOutlineTool() as any);

  const permissionBroker = new PermissionBroker({
    saveDecision() {},
    loadDecisions() { return []; },
    removeDecision() {},
  });

  const executor = new ToolExecutor(registry, permissionBroker);
  const runtime = new AgentRuntime(provider, registry, executor, db);

  // 创建会话
  const sessionId = `rt-test-${Date.now()}`;
  createSession(db, { id: sessionId, title: 'Runtime测试' });

  // 运行一个turn
  let eventCount = 0;
  let hasTokenEvent = false;
  let hasDoneEvent = false;

  for await (const event of runtime.runTurn(sessionId, '帮我写一份通知', 'chat')) {
    eventCount++;
    if (event.type === 'token') hasTokenEvent = true;
    if (event.type === 'done') hasDoneEvent = true;
  }

  assert(eventCount > 0, 'Runtime产生了事件');
  assert(hasTokenEvent, 'Runtime产生了token事件');
  assert(hasDoneEvent, 'Runtime产生了done事件');

  closeDatabase(db);
}

// ============================================================
// 测试8: Shared - 常量与类型
// ============================================================

async function testShared(): Promise<void> {
  console.log('\n🔗 测试 Shared (共享模块)');

  assert(SUPPORTED_FILE_EXTENSIONS.has('docx'), '支持docx格式');
  assert(SUPPORTED_FILE_EXTENSIONS.has('pdf'), '支持pdf格式');
  assert(!SUPPORTED_FILE_EXTENSIONS.has('exe'), '不支持exe格式');

  // 测试错误体系
  const { AgentError, OllamaConnectionError, getRecoveryStrategy } = await import('@workagent/shared');
  const err = new OllamaConnectionError('连接失败');
  assert(err instanceof AgentError, 'OllamaConnectionError是AgentError子类');
  assert(err.code === 'OLLAMA_UNAVAILABLE', '错误码正确');

  const strategy = getRecoveryStrategy(err);
  assert(strategy.action === 'retry', '恢复策略为retry');
}

// ============================================================
// 运行所有测试
// ============================================================

async function runAllTests(): Promise<void> {
  console.log('🚀 WorkAgent 集成测试');
  console.log('='.repeat(50));

  try {
    await testShared();
    await testStore();
    await testModelProvider();
    await testIngest();
    await testRAG();
    await testDocgen();
    await testTools();
    await testAgentRuntime();
  } catch (error) {
    failed++;
    errors.push(`UNEXPECTED: ${error}`);
    console.log(`\n💥 意外错误: ${error}`);
  }

  console.log('\n' + '='.repeat(50));
  console.log(`📊 测试结果: ${passed} 通过, ${failed} 失败`);

  if (errors.length > 0) {
    console.log('\n❌ 失败项:');
    errors.forEach(e => console.log(`  ${e}`));
    process.exit(1);
  } else {
    console.log('\n✅ 所有测试通过！');
  }
}

runAllTests();
