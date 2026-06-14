/**
 * CLI测试入口 - 不依赖Electron，直接在Node.js中测试核心对话流程
 * 用法: npx tsx apps/cli.ts
 */

import { initDatabase, closeDatabase, createSession, createMessage, getSessionMessages, listSessions } from '@workagent/store';
import { MockModelProvider, OllamaNativeProvider, OpenAICompatProvider } from '@workagent/model-provider';
import type { ModelProvider } from '@workagent/model-provider';
import * as readline from 'node:readline';

/**
 * 主函数 - 启动CLI测试对话
 */
async function main(): Promise<void> {
  console.log('=== WorkAgent CLI 测试模式 ===\n');

  // 1. 初始化数据库
  console.log('[1] 初始化数据库...');
  const db = await initDatabase({
    log: (msg: string) => console.log(`  [DB] ${msg}`),
  });
  console.log('  数据库初始化成功\n');

  // 2. 初始化模型提供者
  console.log('[2] 初始化模型提供者...');
  let provider: ModelProvider;

  // 先尝试Ollama
  const ollamaProvider = new OllamaNativeProvider();
  const available = await ollamaProvider.isAvailable();

  if (available) {
    provider = ollamaProvider;
    const status = await provider.getModelsStatus();
    console.log(`  Ollama: ${status.ollama}`);
    console.log(`  聊天模型 ${status.chatModel.name}: ${status.chatModel.available ? '✅' : '❌'}`);
    console.log(`  向量模型 ${status.embeddingModel.name}: ${status.embeddingModel.available ? '✅' : '❌'}\n`);
  } else {
    provider = new MockModelProvider();
    console.log('  Ollama不可用，使用MockProvider（模拟模式）\n');
  }

  // 3. 创建会话
  console.log('[3] 创建会话...');
  const sessionId = `test_${Date.now()}`;
  const session = createSession(db, { id: sessionId, title: 'CLI测试对话' });
  console.log(`  会话ID: ${session.id}\n`);

  // 4. 开始对话循环
  console.log('=== 对话开始 ===');
  console.log('输入消息开始对话，输入 /quit 退出，输入 /plan 进入计划模式\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let currentMode: 'chat' | 'plan' | 'execute' = 'chat';
  let messageSeq = 0;

  const askQuestion = (): void => {
    const modeHint = currentMode === 'plan' ? '[PLAN] ' : currentMode === 'execute' ? '[EXEC] ' : '';
    rl.question(`${modeHint}你: `, async (input: string) => {
      const trimmed = input.trim();

      if (!trimmed) {
        askQuestion();
        return;
      }

      // 命令处理
      if (trimmed === '/quit') {
        console.log('\n再见！');
        db.save();
        closeDatabase(db);
        rl.close();
        return;
      }

      if (trimmed === '/plan') {
        currentMode = 'plan';
        console.log('已切换到计划模式\n');
        askQuestion();
        return;
      }

      if (trimmed === '/chat') {
        currentMode = 'chat';
        console.log('已切换到对话模式\n');
        askQuestion();
        return;
      }

      if (trimmed === '/history') {
        const messages = getSessionMessages(db, sessionId);
        console.log(`\n--- 历史消息 (${messages.length}条) ---`);
        for (const msg of messages) {
          const roleLabel = msg.role === 'user' ? '你' : msg.role === 'assistant' ? '助手' : msg.role;
          console.log(`[${roleLabel}] ${msg.content.slice(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
        }
        console.log('---\n');
        askQuestion();
        return;
      }

      if (trimmed === '/status') {
        const messages = getSessionMessages(db, sessionId);
        const totalTokens = messages.reduce((sum, m) => sum + m.tokenCount, 0);
        console.log(`\n--- 状态 ---`);
        console.log(`会话: ${sessionId}`);
        console.log(`模式: ${currentMode}`);
        console.log(`消息数: ${messages.length}`);
        console.log(`总Token: ${totalTokens}`);
        console.log(`模型: ${provider.getConfig().chatModel}`);
        console.log('---\n');
        askQuestion();
        return;
      }

      // 保存用户消息
      const turnId = `turn_${Date.now()}`;
      createMessage(db, {
        id: `msg_${Date.now()}_user`,
        sessionId,
        turnId,
        sequence: messageSeq++,
        role: 'user',
        content: trimmed,
      });

      // 调用模型
      process.stdout.write('助手: ');
      let fullResponse = '';

      try {
        // 构建消息历史
        const history = getSessionMessages(db, sessionId);
        const chatMessages = [
          {
            role: 'system' as const,
            content: currentMode === 'plan'
              ? '你是一个公文写作计划助手。请帮助用户制定写作计划，包括文种确认、材料研读、提纲生成。只提供建议和问题，不直接生成完整文档。'
              : '你是一个专业的公文写作助手。你帮助用户撰写各类公文（通知、请示、报告、函等）。请用中文回复，格式规范，措辞严谨。',
          },
          ...history.map(m => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
          })),
        ];

        for await (const event of provider.chat({ messages: chatMessages })) {
          if (event.type === 'token') {
            process.stdout.write(event.data);
            fullResponse += event.data;
          }
          if (event.type === 'usage') {
            // 更新最后一条消息的token count
          }
        }

        // 保存助手消息
        createMessage(db, {
          id: `msg_${Date.now()}_asst`,
          sessionId,
          turnId,
          sequence: messageSeq++,
          role: 'assistant',
          content: fullResponse,
        });
        db.save();

        console.log('\n');
      } catch (error) {
        console.log(`\n[错误] ${error}\n`);
      }

      askQuestion();
    });
  };

  askQuestion();
}

main().catch(console.error);
