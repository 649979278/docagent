/**
 * 系统设置浮窗。
 * 负责外观、权限、模型、知识库和归档会话恢复。
 */

import React, { useMemo, useState } from 'react';
import { useSettingsStore, type PermissionPolicy, type ThemeMode, type ReasoningLevel } from '../stores/settings-store.js';
import { useRunStore } from '../stores/run-store.js';

/** 设置浮窗属性。 */
interface SettingsDialogProps {
  /** 是否打开。 */
  open: boolean;
  /** 关闭回调。 */
  onClose: () => void;
  /** 导入知识库回调。 */
  onAddKnowledge: () => void;
  /** 恢复归档会话回调。 */
  onRestoreArchivedSession: (sessionId: string, workspaceId: string) => void;
}

type SettingsTab = 'general' | 'archive';

/**
 * 系统设置浮窗组件。
 */
export function SettingsDialog({ open, onClose, onAddKnowledge, onRestoreArchivedSession }: SettingsDialogProps): React.ReactElement | null {
  const {
    permissionPolicy,
    themeMode,
    fontScale,
    ollamaBaseUrl,
    activeModel,
    availableModels,
    reasoningLevel,
    archivedSessions,
    setPermissionPolicy,
    setThemeMode,
    setFontScale,
    setOllamaBaseUrl,
    setActiveModel,
    setReasoningLevel,
    restoreArchivedSession,
  } = useSettingsStore();
  const { setOllamaModel } = useRunStore();
  const [tab, setTab] = useState<SettingsTab>('general');
  const [draftBaseUrl, setDraftBaseUrl] = useState(ollamaBaseUrl);

  if (!open) return null;

  /**
   * 持久化设置项。
   * @param settings - 待持久化配置。
   */
  const persist = async (settings: Record<string, unknown>): Promise<void> => {
    await window.workagent?.updateSettings(settings);
  };

  /**
   * 统一持久化归档会话列表。
   * @param records - 最新归档列表。
   */
  const persistArchivedSessions = async (records = useSettingsStore.getState().archivedSessions): Promise<void> => {
    await persist({ archived_sessions: { value: records } });
  };

  /**
   * 更新主题设置。
   * @param mode - 主题模式。
   */
  const updateTheme = (mode: ThemeMode): void => {
    setThemeMode(mode);
    void persist({ ui_theme: { value: mode } });
    const effectiveTheme = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : mode;
    document.documentElement.dataset.theme = effectiveTheme;
  };

  /**
   * 更新字体缩放。
   * @param scale - 缩放百分比。
   */
  const updateFontScale = (scale: number): void => {
    setFontScale(scale);
    document.documentElement.style.setProperty('--wa-font-scale', `${scale / 100}`);
    void persist({ ui_font_scale: { value: scale } });
  };

  /**
   * 更新权限策略。
   * @param policy - 权限策略。
   */
  const updatePermissionSetting = (policy: PermissionPolicy): void => {
    setPermissionPolicy(policy);
    void persist({ permission_policy: { value: policy } });
  };

  /**
   * 更新模型。
   * @param model - 模型名称。
   */
  const updateModel = (model: string): void => {
    setActiveModel(model);
    setOllamaModel(model);
    void persist({ openai_compat_model: { value: model } });
  };

  /**
   * 更新模型思考等级。
   * @param level - 思考等级。
   */
  const updateReasoningSetting = (level: ReasoningLevel): void => {
    setReasoningLevel(level);
    void persist({ reasoning_level: { value: level } });
  };

  /**
   * 更新模型服务地址。
   */
  const saveBaseUrl = (): void => {
    setOllamaBaseUrl(draftBaseUrl);
    void persist({ openai_compat_url: { value: draftBaseUrl } });
  };

  /**
   * 恢复归档会话。
   * @param sessionId - 会话 ID。
   * @param workspaceId - 项目 ID。
   */
  const handleRestoreArchivedSession = (sessionId: string, workspaceId: string): void => {
    restoreArchivedSession(sessionId, workspaceId);
    void persistArchivedSessions(useSettingsStore.getState().archivedSessions);
    onRestoreArchivedSession(sessionId, workspaceId);
  };

  const archiveGroups = useMemo(() => {
    const groups = new Map<string, Array<typeof archivedSessions[number]>>();
    for (const record of archivedSessions) {
      const key = `${record.workspaceId}::${record.workspaceName}`;
      const entries = groups.get(key) ?? [];
      entries.push(record);
      groups.set(key, entries);
    }
    return Array.from(groups.entries()).map(([key, records]) => ({
      key,
      workspaceName: records[0]?.workspaceName ?? '未命名项目',
      workspaceId: records[0]?.workspaceId ?? '__default__',
      records,
    }));
  }, [archivedSessions]);

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/48" onClick={onClose}>
      <section
        onClick={(event) => event.stopPropagation()}
        className="flex h-[min(720px,calc(100vh-40px))] w-[720px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[20px] border border-[#353535] bg-[#202020] shadow-[0_32px_100px_rgba(0,0,0,0.55)]"
      >
        <aside className="w-[180px] border-r border-[#303030] bg-[#1a1a1a] p-3">
          <div className="mb-5 px-2">
            <h2 className="wa-body font-semibold text-[#f0f0f0]">设置</h2>
            <p className="mt-1 wa-label text-[#8d8d8d]">外观、模型、权限与归档</p>
          </div>
          <div className="space-y-1">
            <TabButton label="通用设置" active={tab === 'general'} onClick={() => setTab('general')} />
            <TabButton label={`归档会话 ${archivedSessions.length > 0 ? `(${archivedSessions.length})` : ''}`} active={tab === 'archive'} onClick={() => setTab('archive')} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-[#303030] px-5 py-4">
            <div>
              <div className="wa-body font-medium text-[#ededed]">{tab === 'general' ? '通用设置' : '归档会话'}</div>
              <div className="wa-label text-[#8f8f8f]">
                {tab === 'general' ? '即时生效并持久化到本地桌面环境。' : '已归档的对话会从项目列表隐藏，可在这里恢复。'}
              </div>
            </div>
            <button onClick={onClose} className="wa-control-button text-[#b5b5b5] hover:bg-[#2c2c2c] hover:text-[#f1f1f1]">关闭</button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 wa-scrollbar">
            {tab === 'general' ? (
              <div className="space-y-5">
                <SettingBlock title="外观">
                  <SegmentedControl
                    value={themeMode}
                    options={[
                      { value: 'dark', label: '深色' },
                      { value: 'light', label: '浅色' },
                      { value: 'system', label: '跟随系统' },
                    ]}
                    onChange={(value) => updateTheme(value as ThemeMode)}
                  />
                  <label className="mt-4 block wa-label text-[#b8b8b8]">
                    字体大小：{fontScale}%
                    <input
                      type="range"
                      min={90}
                      max={125}
                      step={5}
                      value={fontScale}
                      onChange={(event) => updateFontScale(Number(event.target.value))}
                      className="mt-2 w-full accent-[#f0a33a]"
                    />
                  </label>
                </SettingBlock>

                <SettingBlock title="权限批准">
                  <SegmentedControl
                    value={permissionPolicy}
                    options={[
                      { value: 'ask_every_time', label: '每次询问' },
                      { value: 'ask_dangerous', label: '仅危险询问' },
                      { value: 'full_access', label: '完全访问' },
                    ]}
                    onChange={(value) => updatePermissionSetting(value as PermissionPolicy)}
                  />
                  <p className="mt-3 wa-label text-[#8e8e8e]">
                    每次询问会对所有写入和命令请求确认；仅危险询问会放行普通写入；完全访问不再逐次提示。
                  </p>
                </SettingBlock>

                <SettingBlock title="模型">
                  <label className="mb-2 block wa-label text-[#8d8d8d]">当前对话模型</label>
                  <select
                    value={activeModel}
                    onChange={(event) => updateModel(event.target.value)}
                    className="w-full rounded-xl border border-[#393939] bg-[#161616] px-3 py-2.5 text-[#ececec] outline-none"
                  >
                    {(availableModels.length > 0 ? availableModels : [activeModel]).map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                  <div className="mt-4">
                    <label className="mb-2 block wa-label text-[#8d8d8d]">思考强度</label>
                    <SegmentedControl
                      value={reasoningLevel}
                      options={[
                        { value: 'low', label: '低' },
                        { value: 'medium', label: '中' },
                        { value: 'high', label: '高' },
                      ]}
                      onChange={(value) => updateReasoningSetting(value as ReasoningLevel)}
                    />
                  </div>
                  <div className="mt-4 flex gap-2">
                    <input
                      value={draftBaseUrl}
                      onChange={(event) => setDraftBaseUrl(event.target.value)}
                      className="min-w-0 flex-1 rounded-xl border border-[#393939] bg-[#161616] px-3 py-2.5 text-[#ececec] outline-none"
                      placeholder="http://localhost:11434"
                    />
                    <button onClick={saveBaseUrl} className="rounded-xl bg-[#f0a33a] px-3 py-2.5 text-[#181818] hover:bg-[#f4b257]">保存地址</button>
                  </div>
                </SettingBlock>

                <SettingBlock title="知识库">
                  <button
                    onClick={onAddKnowledge}
                    className="rounded-xl border border-[#393939] bg-[#191919] px-3 py-2.5 text-left text-[#d7d7d7] hover:bg-[#272727]"
                  >
                    增加知识库文档
                  </button>
                </SettingBlock>
              </div>
            ) : (
              <div className="space-y-4">
                {archiveGroups.length === 0 ? (
                  <div className="rounded-2xl border border-[#333333] bg-[#191919] px-4 py-5 text-[#a7a7a7]">
                    当前没有归档会话。
                  </div>
                ) : archiveGroups.map((group) => (
                  <div key={group.key} className="rounded-2xl border border-[#333333] bg-[#191919] p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="wa-body font-medium text-[#ececec]">{group.workspaceName}</div>
                        <div className="wa-label text-[#8d8d8d]">{group.records.length} 个归档对话</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {group.records
                        .sort((a, b) => b.archivedAt - a.archivedAt)
                        .map((record) => (
                          <div key={`${record.workspaceId}:${record.sessionId}`} className="flex items-center gap-3 rounded-xl border border-[#2f2f2f] bg-[#151515] px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[#ececec]">{record.sessionTitle}</div>
                              <div className="wa-label text-[#7f7f7f]">{new Date(record.archivedAt).toLocaleString('zh-CN')}</div>
                            </div>
                            <button
                              onClick={() => handleRestoreArchivedSession(record.sessionId, record.workspaceId)}
                              className="rounded-full border border-[#3a3a3a] px-3 py-1.5 text-[#e1e1e1] hover:bg-[#2c2c2c]"
                            >
                              恢复
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * 设置页签按钮。
 */
function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center rounded-xl px-3 py-2.5 text-left transition-colors ${
        active ? 'bg-[#2a2a2a] text-[#f2f2f2]' : 'text-[#9f9f9f] hover:bg-[#242424] hover:text-[#ececec]'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * 设置分组容器。
 */
function SettingBlock({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-2xl border border-[#333333] bg-[#191919] p-4">
      <div className="mb-3 wa-label font-medium text-[#8d8d8d]">{title}</div>
      {children}
    </div>
  );
}

/**
 * 分段选择控件。
 */
function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#141414] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-lg px-3 py-2 wa-label transition-colors ${
            value === option.value ? 'bg-[#2e2e2e] text-[#f1f1f1]' : 'text-[#9a9a9a] hover:bg-[#262626]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
