# UI 字号、图标基线与滚动条收口记录

## 目标

按 impeccable product register 收口当前桌面 UI 的视觉系统，重点修复字体缩放无效、图标与文本不齐、滚动条风格不适配、会话标题生成与底部控件对齐问题。

## 已落地

- 新增全局字号 token：`--wa-font-xs/sm/md/lg`，以及 `wa-label / wa-body / wa-meta` 文本 utility。
- 新增 `wa-icon / wa-row / wa-control-button / wa-scrollbar`，统一图标尺寸、按钮基线和滚动条样式。
- 替换主路径组件中的字符型图标为 SVG/几何图标：侧栏、输入栏、权限菜单、模型菜单、环境浮窗、聊天消息状态。
- 将主消息区滚动条切换到新的桌面风格 `wa-scrollbar`。
- 设置面板、标题栏、会话栏、环境浮窗、聊天消息都切换到变量字号体系，避免固定 `text-[px]` 破坏字体缩放。
- 新增 `session-update-title` IPC；首次发送消息后，会话标题同步为用户首句简略版本，最多 20 字，并更新左侧项目内显示。

## 验证

- `pnpm --filter @workagent/desktop build` 通过。
- `pnpm desktop:prepare-native` 通过，`electron_native: ok`。
- 本地 dev 服务已启动，Electron Worker 模式初始化成功。
