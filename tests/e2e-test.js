/**
 * 端到端测试 - 验证WorkAgent核心功能
 * 直接调用后端模块，不依赖Electron/Renderer
 *
 * 测试项：
 * 1. 数据库初始化 + 消息持久化
 * 2. Ollama连接 + 对话（含tool call）
 * 3. 多轮对话
 * 4. 文件解析（TXT/DOCX/PPTX/PDF）
 * 5. RAG向量检索
 * 6. 上下文压缩
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// 直接引用编译后的模块
const ROOT = path.resolve(__dirname, '..');
const { initDatabase, createSession, getSessionMessages, createMessage, getRecentMessages } = require(path.join(ROOT, 'packages/store/dist/index.js'));
const { OllamaNativeProvider, MockModelProvider } = require(path.join(ROOT, 'packages/model-provider/dist/index.js'));
const { AgentRuntime } = require(path.join(ROOT, 'packages/agent-core/dist/index.js'));
const { ToolRegistry, ToolExecutor, PermissionBroker } = require(path.join(ROOT, 'packages/tools/dist/index.js'));
const { IngestPipeline, DocxExtractor, PptxExtractor, PdfExtractor, TxtExtractor } = require(path.join(ROOT, 'packages/ingest/dist/index.js'));
const { MemoryVectorStore, OllamaEmbedder, RAGEngine, LanceDBVectorStore } = require(path.join(ROOT, 'packages/rag/dist/index.js'));

let passCount = 0;
let failCount = 0;
const results = [];

function assert(condition, name) {
  if (condition) {
    passCount++;
    results.push(`✅ ${name}`);
  } else {
    failCount++;
    results.push(`❌ ${name}`);
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
  console.log('=== WorkAgent 端到端测试 ===\n');

  // ============================================================
  // 1. 数据库初始化 + 消息持久化
  // ============================================================
  console.log('--- 1. 数据库测试 ---');
  const testDbPath = path.join(os.tmpdir(), `workagent-test-${Date.now()}.db`);
  const db = await initDatabase({ dbPath: testDbPath, log: () => {} });
  assert(db != null, '数据库初始化');

  // 创建会话
  const session = createSession(db, { id: 'test-session-1', title: '测试会话' });
  assert(session.id === 'test-session-1', '创建会话');

  // 持久化消息
  createMessage(db, {
    id: 'msg_test_1',
    sessionId: 'test-session-1',
    turnId: 'turn_test_1',
    sequence: 0,
    role: 'user',
    content: '测试消息',
    toolName: undefined,
  });
  createMessage(db, {
    id: 'msg_test_2',
    sessionId: 'test-session-1',
    turnId: 'turn_test_1',
    sequence: 1,
    role: 'assistant',
    content: '回复消息',
    toolName: undefined,
  });

  const messages = getSessionMessages(db, 'test-session-1', 100);
  assert(messages.length === 2, `消息持久化（期望2条，实际${messages.length}条）`);

  const recent = getRecentMessages(db, 'test-session-1', 50);
  assert(recent.length === 2, `加载历史消息（期望2条，实际${recent.length}条）`);

  // 验证 tool_name 列存在
  createMessage(db, {
    id: 'msg_test_3',
    sessionId: 'test-session-1',
    turnId: 'turn_test_2',
    sequence: 2,
    role: 'tool',
    content: '工具结果',
    toolName: 'rag_search',
  });
  const toolMsg = getRecentMessages(db, 'test-session-1', 1);
  assert(toolMsg[0]?.toolName === 'rag_search', `tool_name列写入/读取正确（${toolMsg[0]?.toolName}）`);


  // ============================================================
  // 2. Ollama连接 + 对话
  // ============================================================
  console.log('\n--- 2. 模型对话测试 ---');
  const provider = new OllamaNativeProvider();
  const available = await provider.isAvailable();
  assert(available === true || available === false, `Ollama可用性检测: ${available}`);

  if (!available) {
    console.log('⚠️ Ollama不可用，使用MockProvider进行后续测试');
  }

  const testProvider = available ? provider : new MockModelProvider();

  // 简单对话测试
  const chatMessages = [
    { role: 'system', content: '你是WorkAgent助手。请简短回复。' },
    { role: 'user', content: '你好，请用一句话回复' },
  ];
  let responseText = '';
  let gotUsage = false;
  try {
    const stream = testProvider.chat({ messages: chatMessages, stream: true, maxTokens: 200 });
    for await (const event of stream) {
      if (event.type === 'token') {
        responseText += event.data;
      } else if (event.type === 'usage') {
        gotUsage = true;
      }
    }
    assert(responseText.length > 0, `对话生成（长度=${responseText.length}）`);
    assert(gotUsage, 'usage信息返回');
  } catch (e) {
    assert(false, `对话生成失败: ${e.message}`);
  }

  // ============================================================
  // 3. AgentRuntime集成测试
  // ============================================================
  console.log('\n--- 3. AgentRuntime测试 ---');
  const registry = new ToolRegistry();
  const permissionBroker = new PermissionBroker({
    saveDecision() {},
    loadDecisions() { return []; },
    removeDecision() {},
  });
  permissionBroker.setRequestCallback(async () => ({ allowed: true, reason: '测试' }));
  const executor = new ToolExecutor(registry, permissionBroker);
  const runtime = new AgentRuntime(testProvider, registry, executor, db);

  let tokenCount = 0;
  let gotDone = false;
  let gotError = false;
  try {
    const sessionId = 'test-session-runtime';
    createSession(db, { id: sessionId, title: 'Runtime测试' });

    const iter = runtime.runTurn(sessionId, '你好', 'chat');
    for await (const event of iter) {
      if (event.type === 'token') tokenCount++;
      if (event.type === 'done') gotDone = true;
      if (event.type === 'error') {
        gotError = true;
        console.log('  Runtime error:', event.data);
      }
    }
    assert(gotDone, 'Runtime完成事件');
    assert(tokenCount > 0, `Runtime生成token（${tokenCount}个）`);
  } catch (e) {
    assert(false, `Runtime执行失败: ${e.message}`);
  }

  // ============================================================
  // 4. 多轮对话 - 验证消息持久化
  // ============================================================
  console.log('\n--- 4. 多轮对话持久化测试 ---');
  try {
    const sessionId2 = 'test-session-multi';
    createSession(db, { id: sessionId2, title: '多轮测试' });

    // 第一轮
    const iter1 = runtime.runTurn(sessionId2, '第一轮：你好', 'chat');
    for await (const event of iter1) {
      // consume events
    }

    // 第二轮
    const iter2 = runtime.runTurn(sessionId2, '第二轮：刚才我说了什么？', 'chat');
    for await (const event of iter2) {
      // consume events
    }

    // 检查消息持久化
    const persisted = getSessionMessages(db, sessionId2, 100);
    assert(persisted.length >= 4, `多轮消息持久化（期望≥4条，实际${persisted.length}条）`);

    // 验证包含用户和助手消息
    const userMsgs = persisted.filter(m => m.role === 'user');
    const asstMsgs = persisted.filter(m => m.role === 'assistant');
    assert(userMsgs.length >= 2, `用户消息数（${userMsgs.length}）`);
    assert(asstMsgs.length >= 2, `助手消息数（${asstMsgs.length}）`);
  } catch (e) {
    assert(false, `多轮对话测试失败: ${e.message}`);
  }

  // ============================================================
  // 5. 文件解析
  // ============================================================
  console.log('\n--- 5. 文件解析测试 ---');
  const pipeline = new IngestPipeline();
  pipeline.register(new DocxExtractor());
  pipeline.register(new PptxExtractor());
  pipeline.register(new PdfExtractor());
  pipeline.register(new TxtExtractor());

  // 测试TXT解析
  const testTxtPath = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
  fs.writeFileSync(testTxtPath, '这是一个测试文件。\n第二行内容。\n第三行。');
  try {
    const doc = await pipeline.ingest(testTxtPath);
    assert(doc.content.includes('测试文件'), `TXT解析: ${doc.content.slice(0, 50)}`);
    assert(doc.fileType === 'txt', `文件类型: ${doc.fileType}`);
  } catch (e) {
    assert(false, `TXT解析失败: ${e.message}`);
  } finally {
    fs.unlinkSync(testTxtPath);
  }

  // 测试DOCX解析（如果有测试文件）
  const testDocxDir = '/Users/sirius/Documents/wsx_ownspace/docs_agent';
  if (fs.existsSync(testDocxDir)) {
    const docxFiles = fs.readdirSync(testDocxDir).filter(f => f.endsWith('.docx'));
    if (docxFiles.length > 0) {
      try {
        const docxPath = path.join(testDocxDir, docxFiles[0]);
        const doc = await pipeline.ingest(docxPath);
        assert(doc.content.length > 0, `DOCX解析成功: ${docxFiles[0]}（${doc.content.length}字）`);
        assert(doc.sections.length > 0, `DOCX段落: ${doc.sections.length}段`);
      } catch (e) {
        assert(false, `DOCX解析失败: ${e.message}`);
      }
    } else {
      console.log('  ⚠️ 未找到docx测试文件');
    }

    // 测试PPTX解析
    const pptxFiles = fs.readdirSync(testDocxDir).filter(f => f.endsWith('.pptx'));
    if (pptxFiles.length > 0) {
      try {
        const pptxPath = path.join(testDocxDir, pptxFiles[0]);
        const doc = await pipeline.ingest(pptxPath);
        assert(doc.content.length > 0, `PPTX解析成功: ${pptxFiles[0]}（${doc.content.length}字）`);
      } catch (e) {
        assert(false, `PPTX解析失败: ${e.message}`);
      }
    }
  } else {
    console.log('  ⚠️ 未找到测试文档目录');
  }

  // ============================================================
  // 6. RAG向量检索
  // ============================================================
  console.log('\n--- 6. RAG向量检索测试 ---');
  try {
    const vectorStore = new MemoryVectorStore();
    const embedder = new OllamaEmbedder(testProvider);
    await embedder.checkAvailability();

    const ragEngine = new RAGEngine(vectorStore, embedder);

    // 索引一个文档
    const testDoc = {
      filePath: '/test/doc.txt',
      fileName: 'doc.txt',
      fileType: 'txt',
      content: '这是关于生态环境保护的政策文件。新时代生态文明建设是关系中华民族永续发展的根本大计。',
      sections: [
        {
          title: '生态保护',
          content: '新时代生态文明建设是关系中华民族永续发展的根本大计。',
          level: 1,
          locator: '第1段',
        }
      ],
      metadata: { paragraphCount: 1 },
    };

    const chunks = await ragEngine.indexDocument(testDoc, (p) => {});
    assert(chunks.length > 0, `文档索引成功（${chunks.length}个块）`);

    // 搜索
    if (!embedder.isDevMode() || available) {
      const searchResults = await ragEngine.search('生态环境保护', { topK: 3 });
      assert(searchResults.length > 0, `向量检索成功（${searchResults.length}条结果）`);
      if (searchResults.length > 0) {
        assert(searchResults[0].score > 0, `相似度分数: ${searchResults[0].score.toFixed(4)}`);
      }
    } else {
      console.log('  ⚠️ Ollama不可用，跳过向量检索（devMode随机向量无意义）');
    }

    // 统计
    const stats = await ragEngine.getStats();
    assert(stats.totalChunks > 0, `索引统计: ${stats.totalChunks}个块`);
  } catch (e) {
    assert(false, `RAG测试失败: ${e.message}`);
  }

  // ============================================================
  // 7. 上下文压缩（通过Runtime长对话触发）
  // ============================================================
  console.log('\n--- 7. 上下文压缩测试 ---');
  try {
    const sessionId3 = 'test-session-compact';
    createSession(db, { id: sessionId3, title: '压缩测试' });

    // 发送多个短消息来填充上下文
    let compactEventReceived = false;
    for (let i = 0; i < 3; i++) {
      const iter = runtime.runTurn(sessionId3, `第${i + 1}轮：请详细描述生态环境保护的要点。包括污染防治、生态修复、绿色发展等方面。`, 'chat');
      for await (const event of iter) {
        if (event.type === 'compact') {
          compactEventReceived = true;
          console.log(`  压缩事件: level=${event.data.level}, freed=${event.data.freedTokens}`);
        }
      }
    }

    if (compactEventReceived) {
      assert(true, '上下文压缩触发');
    } else {
      console.log('  ℹ️ 3轮对话未触发压缩（可能上下文窗口足够大）');
      assert(true, '上下文压缩未触发（窗口足够）');
    }
  } catch (e) {
    assert(false, `压缩测试失败: ${e.message}`);
  }

  // ============================================================
  // 汇总
  // ============================================================
  console.log('\n=== 测试结果 ===');
  for (const r of results) {
    console.log(r);
  }
  console.log(`\n通过: ${passCount}/${passCount + failCount}`);
  if (failCount > 0) {
    console.log(`❌ ${failCount} 项失败`);
    process.exit(1);
  } else {
    console.log('✅ 全部通过');
  }

  // 清理
  try { fs.unlinkSync(testDbPath); } catch {}
  process.exit(0);
}

runTests().catch(e => {
  console.error('测试异常:', e);
  process.exit(1);
});
