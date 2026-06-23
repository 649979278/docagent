/**
 * Electron主进程入口
 * 负责窗口管理、IPC桥接、Worker生命周期、Ollama引导
 */

import { app, BrowserWindow, ipcMain, dialog, Menu, type MenuItemConstructorOptions } from 'electron';
import * as path from 'node:path';
import { OllamaLifecycle } from './ollama-lifecycle.js';
import { IpcHandlers } from './ipc-handlers.js';

let mainWindow: BrowserWindow | null = null;
const ollamaLifecycle = new OllamaLifecycle();
let ipcHandlers: IpcHandlers | null = null;

/**
 * 创建中文应用菜单。
 */
function createApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '新对话', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu-command', { type: 'new-chat' }) },
        { label: '打开项目文件夹', click: () => mainWindow?.webContents.send('menu-command', { type: 'open-project' }) },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '切换开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { label: '重置缩放', role: 'resetZoom' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于 WorkAgent', click: () => dialog.showMessageBox({ type: 'info', message: 'WorkAgent 公文写作助手', detail: '本地模型驱动的公文写作与知识库助手。' }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * 创建主窗口
 */
function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'WorkAgent - 公文写作助手',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 加载页面
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../../renderer/index.html'));
    // 也尝试从dist目录加载（编译后）
    // 如果上面加载失败，会在下面catch中处理
  }

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

/**
 * 注册窗口控制 IPC。
 */
function registerWindowControlIpc(): void {
  ipcMain.handle('window-control', (_event, action: 'minimize' | 'maximize' | 'close') => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false };
    }
    if (action === 'minimize') {
      mainWindow.minimize();
      return { success: true };
    }
    if (action === 'maximize') {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      return { success: true };
    }
    mainWindow.close();
    return { success: true };
  });
}

/**
 * 应用启动
 */
app.whenReady().then(async () => {
  createApplicationMenu();
  registerWindowControlIpc();
  mainWindow = createMainWindow();

  // 初始化Ollama
  const ollamaStatus = await ollamaLifecycle.initialize();
  mainWindow.webContents.send('ollama-status', ollamaStatus);

  // 初始化IPC处理器
  ipcHandlers = new IpcHandlers(mainWindow);
  ipcHandlers.register();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

/**
 * 所有窗口关闭时退出（Windows/Linux）
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * 应用退出前清理
 */
app.on('before-quit', () => {
  ipcHandlers?.dispose();
});

export { mainWindow };
