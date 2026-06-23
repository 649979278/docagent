/**
 * ConversationPane 组件 - 中间对话区
 * 包含消息列表和输入区，支持流式输出和工具调用状态展示
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useMessageStore } from '../stores/message-store.js';
import { useRunStore } from '../stores/run-store.js';
import { useSessionStore } from '../stores/session-store.js';
import { useSettingsStore, type PermissionPolicy, type ReasoningLevel } from '../stores/settings-store.js';
import { ChatMessage } from './chat-message.js';
import { ToolResultViewer } from './tool-result-viewer.js';
import { EnvironmentPopover } from './environment-popover.js';
import { FloatingLayer } from './floating-layer.js';

/** ConversationPane 组件属性 */
interface ConversationPaneProps {
  /** 发送消息回调 */
  onSend: (message: string) => void;
  /** 中断对话回调 */
  onAbort: () => void;
  /** 切换 Plan 模式 */
  onTogglePlanMode: () => void;
  /** 导入知识回调 */
  onAddKnowledge: () => void;
  /** 当前助手消息ID */
  assistantMsgIdRef: React.MutableRefObject<string>;
  /** 是否正在思考 */
  isThinkingRef: React.MutableRefObject<boolean>;
}

/**
 * 中间对话区
 */
export function ConversationPane({
  onSend,
  onAbort,
  onTogglePlanMode,
  onAddKnowledge,
  assistantMsgIdRef,
  isThinkingRef,
}: ConversationPaneProps): React.ReactElement {
  const baseInputHeight = 56;
  const { messages, isLoading } = useMessageStore();
  const { mode, ollamaModel } = useRunStore();
  const {
    permissionPolicy,
    activeModel,
    availableModels,
    reasoningLevel,
    setPermissionPolicy,
    setActiveModel,
    setReasoningLevel,
  } = useSettingsStore();
  const currentSession = useSessionStore((state) => state.sessions.find((session) => session.id === state.currentSessionId));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputHeight, setInputHeight] = useState(baseInputHeight);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const permissionButtonRef = useRef<HTMLButtonElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const maxInputHeight = 176;

  // 自动滚动到底部
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  /** 发送消息 */
  const handleSend = useCallback(() => {
    const input = inputRef.current;
    if (!input || !input.value.trim() || isLoading) return;
    onSend(input.value.trim());
    input.value = '';
    input.style.height = `${baseInputHeight}px`;
    setInputHeight(baseInputHeight);
  }, [baseInputHeight, isLoading, onSend]);

  /** 输入框自动调高 */
  const handleInputChange = useCallback(() => {
    const input = inputRef.current;
    if (input) {
      input.style.height = 'auto';
      const newHeight = Math.min(Math.max(input.scrollHeight, baseInputHeight), maxInputHeight);
      input.style.height = `${newHeight}px`;
      setInputHeight(newHeight);
    }
  }, [baseInputHeight, maxInputHeight]);

  /** 键盘事件处理 */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      onTogglePlanMode();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend, onTogglePlanMode]);

  /** 绑定全局 Shift+Tab 快捷键切换计划模式。 */
  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.key !== 'Tab' || !event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && target.closest('[data-wa-menu="true"]')) return;
      event.preventDefault();
      onTogglePlanMode();
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [onTogglePlanMode]);

  /** 更新权限策略并持久化到主进程。 */
  const updatePermissionPolicy = useCallback((policy: PermissionPolicy) => {
    setPermissionPolicy(policy);
    setPermissionMenuOpen(false);
    void window.workagent?.updateSettings({ permission_policy: { value: policy } });
  }, [setPermissionPolicy]);

  /** 更新聊天模型并触发运行时重初始化。 */
  const updateModel = useCallback((model: string) => {
    setActiveModel(model);
    useRunStore.getState().setOllamaModel(model);
    setModelMenuOpen(false);
    void window.workagent?.updateSettings({ openai_compat_model: { value: model } });
  }, [setActiveModel]);

  /** 更新模型思考等级并持久化。 */
  const updateReasoningLevel = useCallback((level: ReasoningLevel) => {
    setReasoningLevel(level);
    void window.workagent?.updateSettings({ reasoning_level: { value: level } });
  }, [setReasoningLevel]);

  const permissionLabel = permissionPolicy === 'full_access'
    ? '完全访问'
    : permissionPolicy === 'ask_dangerous'
      ? '仅危险询问'
      : '每次询问';
  const displayModel = activeModel || ollamaModel || 'qwen3.5:9b';
  const reasoningLabel = reasoningLevel === 'high' ? '高' : reasoningLevel === 'medium' ? '中' : '低';
  const showInputScrollbar = inputHeight >= maxInputHeight;
  const sessionTitle = currentSession?.title && currentSession.title !== '新对话'
    ? currentSession.title
    : '';

  return (
    <main className="relative flex min-w-0 flex-1 flex-col bg-[var(--wa-bg-primary)]">
      <div className="shrink-0 border-b border-[var(--wa-border)]/40 bg-[var(--wa-bg-secondary)]/85 px-6">
        <div className="flex min-h-[60px] items-center justify-between gap-3">
          <div className="flex min-h-[60px] min-w-0 flex-1 items-center pr-4">
            {sessionTitle ? (
              <div className="truncate wa-body font-medium text-[#dfdfdf]">{sessionTitle}</div>
            ) : (
              <div />
            )}
          </div>
          <EnvironmentPopover onAddKnowledge={onAddKnowledge} />
        </div>
      </div>

      <div className={`min-h-0 flex-1 px-6 pb-3 pt-5 ${messages.length === 0 ? 'overflow-hidden' : 'overflow-y-auto wa-scrollbar'}`}>
        <div className="mx-auto max-w-[1120px]">
          <ToolResultViewer />
        </div>
        {messages.length === 0 && (
          <div className="flex min-h-full flex-col items-center justify-center px-6 text-[var(--wa-text-secondary)]">
            <div className="opacity-70"><EmptyFolderIcon /></div>
          </div>
        )}

        <div className="mx-auto max-w-[1120px]">
          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              isLoading={isLoading && msg.id === assistantMsgIdRef.current}
              isThinking={isThinkingRef.current && msg.id === assistantMsgIdRef.current}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="z-[80] shrink-0 px-6 pb-4 pt-1">
        <div className="mx-auto max-w-[1160px] rounded-[20px] border border-[#2f2f2f] bg-[#242424] shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
          <textarea
            ref={inputRef}
            placeholder=""
            onKeyDown={handleKeyDown}
            onInput={handleInputChange}
            disabled={isLoading}
            rows={1}
            style={{
              height: `${inputHeight}px`,
              overflowY: showInputScrollbar ? 'auto' : 'hidden',
              scrollbarWidth: showInputScrollbar ? 'thin' : 'none',
              boxSizing: 'border-box',
            }}
            className={`block w-full bg-transparent px-5 py-3.5 wa-body leading-6 text-[#ededed] placeholder-[#838383] align-top outline-none disabled:opacity-50 ${
              showInputScrollbar ? 'wa-scrollbar overflow-y-auto' : 'wa-scrollbar-hidden overflow-hidden'
            }`}
          />
          <div className="flex items-center justify-between border-t border-[#303030] px-4 py-1.5">
            <div className="relative flex min-w-0 items-center gap-2 wa-label">
              <button
                ref={addButtonRef}
                onClick={() => setAddMenuOpen((value) => !value)}
                data-wa-menu="true"
                className="wa-control-button wa-control-button--icon text-[#bdbdbd] hover:bg-[#333] hover:text-[#f1f1f1]"
                title="添加"
              >
                <PlusIcon />
              </button>
              <FloatingLayer
                open={addMenuOpen}
                anchorRef={addButtonRef}
                placement="top-start"
                className="w-[250px]"
                onClose={() => setAddMenuOpen(false)}
              >
                <div className="rounded-xl border border-[#3a3a3a] bg-[#2b2b2b] p-2 shadow-xl">
                  <button
                    onClick={() => {
                      setAddMenuOpen(false);
                      onAddKnowledge();
                    }}
                    className="flex min-h-[40px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[#eeeeee] hover:bg-[#3a3a3a]"
                  >
                    <PaperclipIcon />
                    <span>文件和文件夹</span>
                  </button>
                  <button
                    onClick={() => {
                      setAddMenuOpen(false);
                      onTogglePlanMode();
                    }}
                    className={`flex min-h-[40px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[#3a3a3a] ${
                      mode === 'plan' ? 'text-[#f1a24a]' : 'text-[#eeeeee]'
                    }`}
                  >
                    <ListIcon />
                    <span>计划模式</span>
                    <span className="ml-auto text-[#8b8b8b]">{mode === 'plan' ? '已开启' : '开启'}</span>
                  </button>
                </div>
              </FloatingLayer>
              <div className="relative flex items-center gap-2">
                <button
                  ref={permissionButtonRef}
                  onClick={() => setPermissionMenuOpen((value) => !value)}
                  data-wa-menu="true"
                  className="wa-control-button text-[#f0a33a] hover:bg-[#333]"
                >
                  <ShieldIcon />
                  <span>{permissionLabel}</span>
                  <ChevronDownIcon />
                </button>
                {mode === 'plan' && (
                  <span className="inline-flex h-[var(--wa-control-height)] items-center gap-1 rounded-full border border-[#4a3a23] bg-[#2f2417] px-2.5 text-[#f0b15d]">
                    <TodoIcon />
                    <span className="wa-label">计划</span>
                  </span>
                )}
                <FloatingLayer
                  open={permissionMenuOpen}
                  anchorRef={permissionButtonRef}
                  placement="top-start"
                  className="w-[390px]"
                  onClose={() => setPermissionMenuOpen(false)}
                >
                  <PermissionMenu
                    value={permissionPolicy}
                    onChange={updatePermissionPolicy}
                  />
                </FloatingLayer>
              </div>
            </div>
            <div className="flex items-center gap-2 wa-label text-[#a8a8a8]">
              <div className="relative">
                <button
                  ref={modelButtonRef}
                  onClick={() => setModelMenuOpen((value) => !value)}
                  data-wa-menu="true"
                  className="wa-control-button max-w-[280px] hover:bg-[#333]"
                >
                  <ModelChipIcon />
                  <span className="truncate">{displayModel}</span>
                  <span className="text-[#8b8b8b]">思考 {reasoningLabel}</span>
                  <ChevronDownIcon />
                </button>
                <FloatingLayer
                  open={modelMenuOpen}
                  anchorRef={modelButtonRef}
                  placement="top-end"
                  className="w-[320px]"
                  onClose={() => setModelMenuOpen(false)}
                >
                  <ModelMenu
                    value={displayModel}
                    reasoningLevel={reasoningLevel}
                    models={availableModels.length > 0 ? availableModels : [displayModel]}
                    onChange={updateModel}
                    onReasoningChange={updateReasoningLevel}
                  />
                </FloatingLayer>
              </div>
              <button
                onClick={isLoading ? onAbort : handleSend}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                  isLoading ? 'bg-[#5a2929] text-[#ffb0b0]' : 'bg-[#d7d7d7] text-[#1b1b1b] hover:bg-white'
                }`}
                title={isLoading ? '停止' : '发送'}
              >
                {isLoading ? <StopIcon /> : <SendIcon />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * 初始页面文件夹插图。
 */
function EmptyFolderIcon(): React.ReactElement {
  return (
    <svg width="90" height="90" viewBox="0 0 90 90" fill="none" aria-hidden="true">
      <rect x="18" y="29" width="54" height="33" rx="8" fill="currentColor" fillOpacity="0.06" />
      <path d="M14 33h22l6.5 7h31a5 5 0 0 1 5 5v14.5A8.5 8.5 0 0 1 70 68H20A8.5 8.5 0 0 1 11.5 59.5V35.5A2.5 2.5 0 0 1 14 33Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M11.5 33V27a8.5 8.5 0 0 1 8.5-8.5h16l6 6.5h21A8.5 8.5 0 0 1 71.5 33" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M40 50h20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 输入栏通用图标容器。
 */
function InlineIcon({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span className="wa-icon">{children}</span>;
}

/** 加号图标。 */
function PlusIcon(): React.ReactElement {
  return (
    <InlineIcon>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </InlineIcon>
  );
}

/** 附件图标。 */
function PaperclipIcon(): React.ReactElement {
  return (
    <InlineIcon>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21 11-8.8 8.8a5 5 0 0 1-7.1-7.1L14 3.9a3.2 3.2 0 0 1 4.5 4.5l-8.9 8.8a1.5 1.5 0 0 1-2.1-2.1L15.8 6.8" />
      </svg>
    </InlineIcon>
  );
}

/** 列表图标。 */
function ListIcon(): React.ReactElement {
  return (
    <InlineIcon>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" />
      </svg>
    </InlineIcon>
  );
}

/** 权限盾牌图标。 */
function ShieldIcon(): React.ReactElement {
  return (
    <InlineIcon>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 19 6v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
        <path d="m9.5 12 1.7 1.7 3.5-4" />
      </svg>
    </InlineIcon>
  );
}

/** 计划模式标识图标。 */
function TodoIcon(): React.ReactElement {
  return (
    <InlineIcon>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 6h10M9 12h10M9 18h10M5 6h.01M5 12h.01M5 18h.01" />
      </svg>
    </InlineIcon>
  );
}

/** 模型按钮图标。 */
function ModelChipIcon(): React.ReactElement {
  return (
    <InlineIcon>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Zm0 8 8-4M12 11 4 7M12 11v10" />
      </svg>
    </InlineIcon>
  );
}

/** 下拉箭头图标。 */
function ChevronDownIcon(): React.ReactElement {
  return (
    <InlineIcon>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m7 10 5 5 5-5" />
      </svg>
    </InlineIcon>
  );
}

/** 发送图标。 */
function SendIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

/** 停止图标。 */
function StopIcon(): React.ReactElement {
  return <span className="h-3 w-3 rounded-[2px] bg-current" />;
}

/** 选中图标。 */
function CheckIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

/**
 * 权限策略菜单。
 */
function PermissionMenu({
  value,
  onChange,
}: {
  value: PermissionPolicy;
  onChange: (value: PermissionPolicy) => void;
}): React.ReactElement {
  const options: Array<{ value: PermissionPolicy; title: string; desc: string }> = [
    { value: 'ask_every_time', title: '每次询问', desc: '所有写入、覆盖、命令和外部访问都请求批准' },
    { value: 'ask_dangerous', title: '仅危险询问', desc: '普通写入自动允许，覆盖、命令、破坏性操作请求批准' },
    { value: 'full_access', title: '完全访问', desc: '允许访问项目文件、知识库和联网模型服务，不再逐次询问' },
  ];
  return (
    <div data-wa-menu="true" className="rounded-xl border border-[#454545] bg-[#2b2b2b] p-3 shadow-xl">
      <div className="mb-3 flex items-center justify-between text-[#b7b7b7]">
        <span className="wa-body font-medium text-[#e8e8e8]">权限批准方式</span>
        <span className="wa-label text-[#9a9a9a]">可在设置中修改</span>
      </div>
      <div className="space-y-2">
        {options.map((option) => (
          <button key={option.value} onClick={() => onChange(option.value)} className="flex w-full items-start gap-3 rounded-lg p-3 text-left hover:bg-[#383838]">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#555] text-[#d8d8d8]">
              {value === option.value ? <CheckIcon /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block wa-body font-medium text-[#eeeeee]">{option.title}</span>
              <span className="block wa-label text-[#a2a2a2]">{option.desc}</span>
            </span>
            {value === option.value && <span className="pt-0.5 wa-label text-[#d8d8d8]">已选</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 模型选择菜单。
 */
function ModelMenu({
  value,
  reasoningLevel,
  models,
  onChange,
  onReasoningChange,
}: {
  value: string;
  reasoningLevel: ReasoningLevel;
  models: string[];
  onChange: (value: string) => void;
  onReasoningChange: (value: ReasoningLevel) => void;
}): React.ReactElement {
  const levels: Array<{ value: ReasoningLevel; label: string; desc: string }> = [
    { value: 'low', label: '低', desc: '更快回复，较少思考' },
    { value: 'medium', label: '中', desc: '平衡质量与速度' },
    { value: 'high', label: '高', desc: '更充分推理和规划' },
  ];
  return (
    <div data-wa-menu="true" className="rounded-xl border border-[#454545] bg-[#2b2b2b] p-3 shadow-xl">
      <div className="mb-2 wa-label text-[#9a9a9a]">模型</div>
      <div className="max-h-[190px] overflow-y-auto pr-1 wa-scrollbar">
        {models.map((model) => (
          <button
            key={model}
            onClick={() => onChange(model)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left wa-body text-[#eeeeee] hover:bg-[#3a3a3a]"
          >
            <span className="truncate">{model}</span>
            {value === model && <span>✓</span>}
          </button>
        ))}
      </div>
      <div className="my-3 h-px bg-[#3c3c3c]" />
      <div className="mb-2 wa-label text-[#9a9a9a]">思考程度</div>
      <div className="grid grid-cols-3 gap-1">
        {levels.map((level) => (
          <button
            key={level.value}
            onClick={() => onReasoningChange(level.value)}
            title={level.desc}
            className={`rounded-lg px-2 py-2 text-center ${
              reasoningLevel === level.value ? 'bg-[#3a3a3a] text-[#f0a33a]' : 'text-[#d6d6d6] hover:bg-[#343434]'
            }`}
          >
            {level.label}
          </button>
        ))}
      </div>
    </div>
  );
}
