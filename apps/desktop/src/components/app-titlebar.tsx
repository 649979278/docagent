/**
 * 应用顶部标题栏。
 * 将中文菜单与应用标题放在最上方，贴近 Windows 标题栏视觉位置。
 */

import React, { useState } from 'react';
import { useSettingsStore } from '../stores/settings-store.js';

/** 顶部标题栏属性。 */
interface AppTitlebarProps {
  /** 创建新对话。 */
  onCreateSession: () => void;
  /** 打开项目文件夹。 */
  onOpenProject: () => void;
  /** 打开设置。 */
  onOpenSettings: () => void;
}

/**
 * 应用顶部标题栏组件。
 */
export function AppTitlebar({ onCreateSession, onOpenProject, onOpenSettings }: AppTitlebarProps): React.ReactElement {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { fontScale, setFontScale } = useSettingsStore();

  /** 执行菜单动作后关闭菜单。 */
  const runAction = (action: () => void): void => {
    action();
    setOpenMenu(null);
  };

  /** 执行浏览器编辑命令。 */
  const runEditCommand = (command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'): void => {
    document.execCommand(command);
    setOpenMenu(null);
  };

  /** 执行视图缩放命令。 */
  const runZoomCommand = (delta: number): void => {
    const root = document.documentElement;
    const current = fontScale;
    const next = delta === 0 ? 100 : Math.min(125, Math.max(90, current + delta * 100));
    setFontScale(next);
    root.style.setProperty('--wa-font-scale', String(next / 100));
    void window.workagent?.updateSettings({ ui_font_scale: { value: next } });
    setOpenMenu(null);
  };

  return (
    <header
      className="relative z-[70] flex h-[var(--wa-titlebar-height)] shrink-0 items-center border-b border-[#242424] bg-[#171717] px-3 text-[#c7c7c7] [-webkit-app-region:drag]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 items-center gap-2 px-2 text-[#e4e4e4]">
          <span className="h-2.5 w-2.5 rounded-full bg-[#4c9dff]" />
          <span className="truncate wa-body font-medium">WorkAgent 公文写作助手</span>
        </div>
        <nav className="flex items-center gap-0.5 py-2 [-webkit-app-region:no-drag]">
        <TitleMenu label="文件" open={openMenu === 'file'} onOpen={() => setOpenMenu(openMenu === 'file' ? null : 'file')}>
          <MenuItem label="新对话" onClick={() => runAction(onCreateSession)} />
          <MenuItem label="打开项目文件夹" onClick={() => runAction(onOpenProject)} />
          <MenuItem label="设置" onClick={() => runAction(onOpenSettings)} />
        </TitleMenu>
        <TitleMenu label="编辑" open={openMenu === 'edit'} onOpen={() => setOpenMenu(openMenu === 'edit' ? null : 'edit')}>
          <MenuItem label="撤销" onClick={() => runEditCommand('undo')} />
          <MenuItem label="重做" onClick={() => runEditCommand('redo')} />
          <MenuSeparator />
          <MenuItem label="剪切" onClick={() => runEditCommand('cut')} />
          <MenuItem label="复制" onClick={() => runEditCommand('copy')} />
          <MenuItem label="粘贴" onClick={() => runEditCommand('paste')} />
          <MenuItem label="全选" onClick={() => runEditCommand('selectAll')} />
        </TitleMenu>
        <TitleMenu label="视图" open={openMenu === 'view'} onOpen={() => setOpenMenu(openMenu === 'view' ? null : 'view')}>
          <MenuItem label="放大" onClick={() => runZoomCommand(0.05)} />
          <MenuItem label="缩小" onClick={() => runZoomCommand(-0.05)} />
          <MenuItem label="重置缩放" onClick={() => runZoomCommand(0)} />
          <MenuSeparator />
          <MenuItem label="打开设置面板" onClick={() => runAction(onOpenSettings)} />
        </TitleMenu>
        <TitleMenu label="帮助" open={openMenu === 'help'} onOpen={() => setOpenMenu(openMenu === 'help' ? null : 'help')}>
          <MenuItem label="关于 WorkAgent" onClick={() => runAction(() => setAboutOpen(true))} />
        </TitleMenu>
        </nav>
      </div>
      <div className="flex items-center gap-1 pr-1 [-webkit-app-region:no-drag]">
        <WindowButton title="最小化" onClick={() => { void window.workagent?.windowControl('minimize'); }}>
          <MinimizeIcon />
        </WindowButton>
        <WindowButton title="最大化/还原" onClick={() => { void window.workagent?.windowControl('maximize'); }}>
          <MaximizeIcon />
        </WindowButton>
        <WindowButton title="关闭" danger onClick={() => { void window.workagent?.windowControl('close'); }}>
          <CloseWindowIcon />
        </WindowButton>
      </div>
      {aboutOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 [-webkit-app-region:no-drag]" onClick={() => setAboutOpen(false)}>
          <section onClick={(event) => event.stopPropagation()} className="w-[360px] rounded-2xl border border-[#3c3c3c] bg-[#2b2b2b] p-5 shadow-2xl">
            <h2 className="wa-body font-semibold text-[#f0f0f0]">WorkAgent 公文写作助手</h2>
            <p className="mt-2 wa-body text-[#bdbdbd]">本地模型驱动的公文写作、知识库检索和计划执行工作台。</p>
            <button onClick={() => setAboutOpen(false)} className="mt-4 rounded-md bg-[#3a3a3a] px-3 py-1.5 text-[#e8e8e8] hover:bg-[#464646]">关闭</button>
          </section>
        </div>
      )}
    </header>
  );
}

/**
 * 顶部菜单容器。
 */
function TitleMenu({
  label,
  open,
  onOpen,
  children,
}: {
  label: string;
  open: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="relative">
      <button onClick={onOpen} className="flex h-8 items-center rounded-md px-3 wa-label text-[#cfcfcf] hover:bg-[#2b2b2b]">{label}</button>
      {open && (
        <div className="absolute left-0 top-10 min-w-[176px] rounded-xl border border-[#353535] bg-[#2b2b2b] p-1.5 shadow-xl">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * 顶部菜单操作项。
 */
function MenuItem({ label, onClick }: { label: string; onClick: () => void }): React.ReactElement {
  return (
    <button onClick={onClick} className="block w-full rounded-lg px-3 py-2 text-left wa-label text-[#e8e8e8] hover:bg-[#3a3a3a]">
      {label}
    </button>
  );
}

/**
 * 菜单分隔线。
 */
function MenuSeparator(): React.ReactElement {
  return <div className="my-1 h-px bg-[#3c3c3c]" />;
}

/**
 * 无边框窗口控制按钮。
 */
function WindowButton({
  title,
  danger = false,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-9 w-10 items-center justify-center rounded-xl text-[#d0d0d0] ${
        danger ? 'hover:bg-[#c42b1c] hover:text-white' : 'hover:bg-[#2b2b2b]'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * 最小化图标。
 */
function MinimizeIcon(): React.ReactElement {
  return <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 5.5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>;
}

/**
 * 最大化图标。
 */
function MaximizeIcon(): React.ReactElement {
  return <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="1.8" y="1.8" width="8.4" height="8.4" rx="0.6" stroke="currentColor" strokeWidth="1.2" /></svg>;
}

/**
 * 关闭窗口图标。
 */
function CloseWindowIcon(): React.ReactElement {
  return <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>;
}
