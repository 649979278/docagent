/**
 * Electron主进程入口
 * 负责窗口管理、IPC桥接、Worker生命周期、Ollama引导
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'node:path';
import { OllamaLifecycle } from './ollama-lifecycle.js';
import { IpcHandlers } from './ipc-handlers.js';

let mainWindow: BrowserWindow | null = null;
const ollamaLifecycle = new OllamaLifecycle();
let ipcHandlers: IpcHandlers | null = null;

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
 * 应用启动
 */
app.whenReady().then(async () => {
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
