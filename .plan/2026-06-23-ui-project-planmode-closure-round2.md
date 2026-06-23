## 目标

收口桌面端新增的 7 个 UI/交互问题，并确保计划模式在 Renderer、IPC、Runtime 三层真实生效且状态不残留。

## 本轮范围

1. 修复标题栏、对话头部、空态与输入区比例问题。
2. 修复浮层定位、按钮对齐、最大化后的左右自适应。
3. 修复项目删除/归档后的会话回退与归档恢复。
4. 完善项目更多菜单行为：资源管理器打开、移除、仅 UI 重命名。
5. 修复计划模式切换/取消后的状态残留，保证摘要只出现在右上浮窗。
6. 校验 Shift+Tab、审批、执行恢复链路。

## 关键文件

- `D:\wsx_workspace\docagent\apps\desktop\src\components\ConversationPane.tsx`
- `D:\wsx_workspace\docagent\apps\desktop\src\components\session-sidebar.tsx`
- `D:\wsx_workspace\docagent\apps\desktop\src\components\app-titlebar.tsx`
- `D:\wsx_workspace\docagent\apps\desktop\src\components\environment-popover.tsx`
- `D:\wsx_workspace\docagent\apps\desktop\src\components\WorkbenchShell.tsx`
- `D:\wsx_workspace\docagent\apps\desktop\src\hooks\useSessionManager.ts`
- `D:\wsx_workspace\docagent\apps\desktop\src\hooks\useAgentEvents.ts`
- `D:\wsx_workspace\docagent\apps\desktop\src\stores\run-store.ts`
- `D:\wsx_workspace\docagent\apps\desktop\electron\runtime-factory.ts`

## 验证

1. 桌面端构建通过。
2. 新对话空态无多余滚动条。
3. 删除/归档后切到当前项目首个对话。
4. 设置页可恢复归档。
5. 计划模式开关、取消、审批后 UI 不残留旧计划摘要。
