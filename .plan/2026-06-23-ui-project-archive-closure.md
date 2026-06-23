# 2026-06-23 UI 项目流与归档闭环修复

## 目标
- 修复桌面端项目侧栏、对话区、标题栏、设置面板和环境浮窗的 UI/交互问题。
- 让项目目录、会话归档、计划模式、权限模式、模型切换和字号设置都具备真实业务行为。

## 本轮改动范围
- `apps/desktop/src/components/ConversationPane.tsx`
- `apps/desktop/src/components/session-sidebar.tsx`
- `apps/desktop/src/components/settings-dialog.tsx`
- `apps/desktop/src/components/app-titlebar.tsx`
- `apps/desktop/src/components/environment-popover.tsx`
- `apps/desktop/src/hooks/useSessionManager.ts`
- `apps/desktop/src/stores/settings-store.ts`
- `apps/desktop/src/App.tsx`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/electron/ipc/settings-ipc.ts`
- `apps/desktop/electron/ipc-handlers.ts`
- `apps/desktop/src/index.css`

## 设计决策
- 归档不再通过“解绑项目”假装实现，而是使用 `archived_sessions` 持久化设置存储；归档会话从项目列表隐藏，但可在设置面板恢复。
- 项目“移除”只移除应用内项目和对应对话，不修改磁盘目录；“重命名”只修改应用展示名称。
- 计划阶段信息从对话主内容区移除，只保留审批横幅，并把计划摘要统一收口到右上角环境浮窗。
- 字体缩放统一通过 `--wa-font-scale` 和设置持久化控制，不再由标题栏单独维护一套临时缩放状态。

## 待验证
- 删除当前对话后，是否正确跳到当前项目下第一条剩余对话。
- 归档当前对话后，是否立即切换到当前项目下第一条可见对话。
- 设置中的“归档会话”页签是否能恢复会话并回到侧栏显示。
- Shift + Tab 开关计划模式后，新会话和已有会话都能正确进入计划链路。
