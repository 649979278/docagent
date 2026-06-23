# Frameless 顶部标题栏继续项记录

## 目标

让 `文件/编辑/视图/帮助` 与最小化、最大化、关闭按钮处于同一顶部行，并移除系统菜单栏与页面菜单分离的问题。

## 已落地

- Electron 主窗口启用 `frame: false`，隐藏系统边框菜单。
- 新增 renderer 自定义标题栏，包含应用标题、中文菜单、窗口控制按钮。
- 暴露 `window-control` IPC，最小化、最大化/还原、关闭按钮均调用真实 Electron 窗口能力。
- 标题栏拖拽区域使用 `-webkit-app-region: drag`，菜单和窗口按钮使用 `no-drag`，保证交互正常。

## 验证

- `pnpm --filter @workagent/desktop build` 通过。
- `pnpm desktop:prepare-native` 通过，`electron_native: ok`。
- 本地 dev 服务已重启，Electron Worker 模式初始化成功。
