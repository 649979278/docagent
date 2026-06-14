/**
 * React主组件 - Codex风格暗色极简UI
 * 参考 OpenAI Codex CLI 和 Claude Code 的设计：
 * - 暗色主题 + 极简边距
 * - 上下文token进度条（底部状态栏）
 * - 工具执行状态展示
 * - Plan模式状态指示
 * - Markdown渲染消息
 * - 会话管理（创建/切换/删除）
 * - 知识库面板
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { useAppStore } from './stores/app-store.js';
import { ChatMessage } from './components/chat-message.js';
import { SessionSidebar } from './components/session-sidebar.js';
import { KnowledgePanel } from './components/knowledge-panel.js';
import { StatusBar } from './components/status-bar.js';

/** Electron preload暴露的API类型 */
declare global {
  interface Window {
    workagent?: {
      chat: (message: string, sessionId: string, mode?: string) => Promise<{ success: boolean }>;
      chatAbort: () => Promise<{ success: boolean }>;
      createSession: (title?: string) => Promise<{ id: string; title: string; mode: 'chat' | 'plan' | 'execute'; updatedAt: number }>;
      listSessions: () => Promise<Array<{ id: string; title: string; mode: 'chat' | 'plan' | 'execute'; updatedAt: number }>>;
      deleteSession: (sessionId: string) => Promise<{ success: boolean }>;
      sessionMessages: (sessionId: string) => Promise<Array<{ id: string; role: string; content: string; timestamp: number }>>;
      setPlanMode: (enabled: boolean, sessionId: string) => Promise<{ mode: string }>;
      approvePlan: (planId: string, approved: boolean, sessionId: string) => Promise<unknown>;
      addKnowledge: (filePaths: string[], sessionId: string) => Promise<unknown>;
      searchKnowledge: (query: string, topK?: number) => Promise<unknown>;
      permissionResponse: (toolName: string, allowed: boolean, remember?: boolean) => Promise<unknown>;
      updateSettings: (settings: Record<string, unknown>) => Promise<unknown>;
      getSettings: (key?: string) => Promise<unknown>;
      getModelsStatus: () => Promise<unknown>;
      openFileDialog: (options?: { multiple?: boolean; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string[]>;
      onAgentEvent: (callback: (event: unknown) => void) => () => void;
      onOllamaStatus: (callback: (status: unknown) => void) => () => void;
    };
  }
}

/** Agent事件信封 */
interface AgentEventEnvelope {
  sessionId: string;
  turnId: string;
  sequence: number;
  type: string;
  data: unknown;
  createdAt: number;
}

/**
 * 主App组件 - Codex暗色极简风格
 */
export function App(): React.ReactElement {
  const store = useAppStore();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const assistantContentRef = useRef<string>('');
  const assistantThinkingRef = useRef<string>('');
  const assistantMsgIdRef = useRef<string>('');
  const isThinkingRef = useRef<boolean>(false);

  // 输入框自动调高
  const [inputHeight, setInputHeight] = useState(40);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [store.messages]);

  // 监听Agent事件
  useEffect(() => {
    const api = window.workagent;
    if (!api) return;

    const unsub = api.onAgentEvent((rawEvent: unknown) => {
      const event = rawEvent as AgentEventEnvelope;

      if (event.type === 'token' || event.type === 'text') {
        const data = event.data as { text: string };
        assistantContentRef.current += data.text;
        // 收到实际token，thinking阶段结束
        isThinkingRef.current = false;
        const content = assistantContentRef.current;
        const msgId = assistantMsgIdRef.current;
        store.updateMessage(msgId, { content });
      }

      if (event.type === 'thinking') {
        // qwen3.5 thinking模式：累积思考内容，更新消息以触发UI刷新
        const data = event.data as { text: string };
        if (data.text) {
          assistantThinkingRef.current += data.text;
          isThinkingRef.current = true;
          // 仅更新tokenCount来展示思考进度，不将thinking文本混入content
          const msgId = assistantMsgIdRef.current;
          store.updateMessage(msgId, {
            tokenCount: (store.messages.find(m => m.id === msgId)?.tokenCount ?? 0) + data.text.length,
          });
        }
      }

      if (event.type === 'tool_start') {
        const data = event.data as { name: string };
        const msgId = assistantMsgIdRef.current;
        store.updateMessage(msgId, {
          toolCalls: [...(store.messages.find(m => m.id === msgId)?.toolCalls || []), { name: data.name, status: 'running' as const }],
        });
      }

      if (event.type === 'tool_result') {
        const data = event.data as { name: string; summary?: string };
        const msgId = assistantMsgIdRef.current;
        const calls = store.messages.find(m => m.id === msgId)?.toolCalls || [];
        store.updateMessage(msgId, {
          toolCalls: calls.map(c => c.name === data.name ? { ...c, status: 'done' as const, summary: data.summary } : c),
        });
      }

      if (event.type === 'usage') {
        const data = event.data as { promptTokens: number; completionTokens: number; contextLength?: number };
        const usedTokens = data.promptTokens + data.completionTokens;
        const contextLength = data.contextLength ?? store.contextMetrics.contextLength;
        store.setContextMetrics({
          usedTokens,
          contextLength,
          usedPercentage: (usedTokens / contextLength) * 100,
        });
      }

      if (event.type === 'compact') {
        const data = event.data as { freedTokens: number; level: number };
        store.setContextMetrics({
          lastCompactFreed: data.freedTokens,
          compactCount: store.contextMetrics.compactCount + 1,
        });
      }

      if (event.type === 'plan_phase') {
        const data = event.data as { phase: string };
        store.setPlanPhase(data.phase);
      }

      if (event.type === 'done') {
        store.setLoading(false);
        assistantContentRef.current = '';
        assistantThinkingRef.current = '';
        assistantMsgIdRef.current = '';
        isThinkingRef.current = false;
      }

      if (event.type === 'error') {
        const data = event.data as { message: string };
        const msgId = assistantMsgIdRef.current;
        if (msgId) {
          store.updateMessage(msgId, {
            content: (store.messages.find(m => m.id === msgId)?.content ?? '') + `\n\n⚠️ ${data.message}`,
          });
        }
        store.setLoading(false);
        assistantContentRef.current = '';
        assistantThinkingRef.current = '';
        assistantMsgIdRef.current = '';
        isThinkingRef.current = false;
      }
    });

    const unsubOllama = api.onOllamaStatus((status: unknown) => {
      store.setOllamaStatus(status as 'running' | 'not_installed' | 'start_failed');
    });

    return () => { unsub(); unsubOllama(); };
  }, []);

  // 初始化加载会话列表
  useEffect(() => {
    window.workagent?.listSessions().then((sessions) => {
      store.setSessions(sessions);
    });
  }, []);

  /** 发送消息 */
  const handleSend = useCallback(async () => {
    const input = inputRef.current;
    const api = window.workagent;
    if (!input || !input.value.trim() || store.isLoading || !api) return;

    const message = input.value.trim();
    input.value = '';
    // 重置输入框高度
    setInputHeight(40);

    let sessionId = store.currentSessionId;
    if (!sessionId) {
      const session = await api.createSession(message.slice(0, 30));
      sessionId = session.id;
      store.addSession(session);
      store.setCurrentSession(sessionId);
    }

    // 用户消息
    store.addMessage({
      id: `msg_${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });

    // 助手占位
    const assistantMsgId = `msg_${Date.now()}_asst`;
    assistantContentRef.current = '';
    assistantMsgIdRef.current = assistantMsgId;
    store.addMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
    });
    store.setLoading(true);

    try {
      await api.chat(message, sessionId, store.mode);
    } catch (error) {
      store.updateMessage(assistantMsgId, {
        content: `发送失败: ${error instanceof Error ? error.message : String(error)}`,
      });
      store.setLoading(false);
    }
  }, [store.currentSessionId, store.isLoading, store.mode]);

  /** 切换Plan模式 */
  const togglePlanMode = useCallback(async () => {
    const newMode = store.mode === 'plan' ? 'chat' : 'plan';
    if (window.workagent && store.currentSessionId) {
      await window.workagent.setPlanMode(newMode === 'plan', store.currentSessionId);
    }
    store.setMode(newMode);
  }, [store.mode, store.currentSessionId]);

  /** 中断对话 */
  const handleAbort = useCallback(async () => {
    if (window.workagent) {
      await window.workagent.chatAbort();
      store.setLoading(false);
    }
  }, []);

  /** 打开文件对话框导入知识 */
  const handleAddKnowledge = useCallback(async () => {
    const api = window.workagent;
    if (!api || !store.currentSessionId) return;
    try {
      const filePaths = await api.openFileDialog({
        multiple: true,
        filters: [{ name: '文档', extensions: ['docx', 'pptx', 'pdf', 'txt', 'md'] }],
      });
      if (filePaths.length > 0) {
        await api.addKnowledge(filePaths, store.currentSessionId);
      }
    } catch { /* 静默处理用户取消 */ }
  }, [store.currentSessionId]);

  /** 搜索知识库 */
  const handleSearchKnowledge = useCallback(async (query: string) => {
    if (window.workagent) {
      await window.workagent.searchKnowledge(query, 5);
    }
  }, []);

  /** 选择会话 */
  const handleSelectSession = useCallback(async (id: string) => {
    // 如果当前有正在进行的对话，先中断
    if (store.isLoading && window.workagent) {
      await window.workagent.chatAbort();
      store.setLoading(false);
    }
    // 切换会话
    store.setCurrentSession(id);
    assistantContentRef.current = '';
    assistantThinkingRef.current = '';
    assistantMsgIdRef.current = '';
    isThinkingRef.current = false;
    if (window.workagent) {
      const msgs = await window.workagent.sessionMessages(id);
      store.clearMessages();
      msgs.forEach((m) => store.addMessage({
        id: m.id,
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        timestamp: m.timestamp,
      }));
    }
  }, [store.isLoading]);

  /** 创建新会话 */
  const handleCreateSession = useCallback(async () => {
    const api = window.workagent;
    if (!api) return;
    const session = await api.createSession('新对话');
    store.addSession(session);
    store.setCurrentSession(session.id);
    store.clearMessages();
  }, []);

  /** 删除会话 */
  const handleDeleteSession = useCallback(async (id: string) => {
    if (window.workagent) {
      await window.workagent.deleteSession(id);
      if (store.currentSessionId === id) {
        store.setCurrentSession(null);
        store.clearMessages();
      }
      // 刷新会话列表
      const sessions = await window.workagent.listSessions();
      store.setSessions(sessions);
    }
  }, [store.currentSessionId]);

  /** 输入框自动调高 */
  const handleInputChange = useCallback(() => {
    const input = inputRef.current;
    if (input) {
      input.style.height = 'auto';
      const newHeight = Math.min(Math.max(input.scrollHeight, 40), 160);
      input.style.height = `${newHeight}px`;
      setInputHeight(newHeight);
    }
  }, []);

  /** 键盘事件处理 */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter发送（Shift+Enter换行）
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="flex flex-col h-screen bg-zinc-900 text-zinc-100 font-mono text-sm">
      {/* 顶部导航栏 */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-950 select-none">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-zinc-100 tracking-tight">WorkAgent</span>
          <span className="text-xs text-zinc-500 hidden sm:inline">公文写作助手</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Plan模式切换 */}
          <button
            onClick={togglePlanMode}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              store.mode === 'plan'
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-700'
            }`}
          >
            {store.mode === 'plan' ? '📋 Plan模式' : '💬 对话模式'}
          </button>

          {/* 中断按钮 */}
          {store.isLoading && (
            <button
              onClick={handleAbort}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors"
            >
              ⏹ 停止
            </button>
          )}

          {/* Ollama状态指示器 */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs ${
            store.ollamaStatus === 'running'
              ? 'bg-emerald-500/10 text-emerald-400'
              : store.ollamaStatus === 'checking'
              ? 'bg-zinc-800 text-zinc-500'
              : 'bg-red-500/10 text-red-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              store.ollamaStatus === 'running'
                ? 'bg-emerald-400'
                : store.ollamaStatus === 'checking'
                ? 'bg-zinc-500 animate-pulse'
                : 'bg-red-400'
            }`} />
            {store.ollamaStatus === 'running' ? 'Ollama' : store.ollamaStatus === 'checking' ? '检测中...' : '离线'}
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧会话列表 */}
        <SessionSidebar
          sessions={store.sessions}
          currentSessionId={store.currentSessionId}
          onSelectSession={handleSelectSession}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
        />

        {/* 中间对话区 */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-thin">
            {store.messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                <div className="text-5xl mb-4 opacity-50">📝</div>
                <p className="text-lg text-zinc-500 mb-1">WorkAgent 公文写作助手</p>
                <p className="text-xs text-zinc-600 mb-6">基于本地Ollama的离线公文写作工具</p>
                {/* 快捷操作提示 */}
                <div className="flex flex-col gap-2 text-xs text-zinc-600">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 text-[10px]">Enter</span>
                    <span>发送消息</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 text-[10px]">Shift+Enter</span>
                    <span>换行</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 text-[10px]">📋 Plan</span>
                    <span>切换计划模式</span>
                  </div>
                </div>
              </div>
            )}

            {store.messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                isLoading={store.isLoading && msg.id === assistantMsgIdRef.current}
                isThinking={isThinkingRef.current && msg.id === assistantMsgIdRef.current}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区 */}
          <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-3">
            <div className="flex gap-2 items-end max-w-4xl mx-auto">
              <textarea
                ref={inputRef}
                placeholder={store.mode === 'plan'
                  ? '描述写作需求，如"帮我写一份关于XX的通知"...'
                  : '输入消息，Shift+Enter换行...'
                }
                onKeyDown={handleKeyDown}
                onInput={handleInputChange}
                disabled={store.isLoading}
                rows={1}
                style={{ height: `${inputHeight}px` }}
                className="flex-1 bg-zinc-800 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30 disabled:opacity-40 resize-none overflow-hidden leading-relaxed"
              />
              <button
                onClick={store.isLoading ? handleAbort : handleSend}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
                  store.isLoading
                    ? 'bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                {store.isLoading ? '⏹ 停止' : '↵ 发送'}
              </button>
            </div>
          </div>
        </main>

        {/* 右侧知识库面板 */}
        <KnowledgePanel
          sessionId={store.currentSessionId}
          isPlanMode={store.mode === 'plan'}
          planPhase={store.planPhase}
          onAddKnowledge={handleAddKnowledge}
          onSearchKnowledge={handleSearchKnowledge}
          api={window.workagent}
        />
      </div>

      {/* 底部状态栏 */}
      <StatusBar
        contextMetrics={store.contextMetrics}
        messageCount={store.messages.length}
        ollamaStatus={store.ollamaStatus}
        mode={store.mode}
        isLoading={store.isLoading}
      />
    </div>
  );
}

export default App;
