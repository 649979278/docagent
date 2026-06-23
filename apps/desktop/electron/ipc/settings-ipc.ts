/**
 * 设置和模型相关 IPC 处理器。
 * 负责 settings-update、settings-get、models-status、open-file-dialog 四个 IPC 通道。
 */

import { ipcMain, dialog, shell } from 'electron';
import type { IpcHandlerContext } from './context.js';
import { getSetting, setSetting, listSettings } from '@workagent/store';

/**
 * 设置更新回调类型。
 * 当设置变更需要触发运行时重初始化时调用。
 */
export type SettingsChangeCallback = (changedKeys: string[]) => void;

/**
 * 注册设置和模型相关 IPC 处理器。
 * @param ctx - IPC 共享上下文。
 * @param onSettingsChange - 设置变更回调（如需重初始化 runtime）。
 */
export function registerSettingsIpc(
  ctx: IpcHandlerContext,
  onSettingsChange?: SettingsChangeCallback,
): void {
  // 更新设置
  ipcMain.handle('settings-update', async (_ev, settings: Record<string, unknown>) => {
    const db = await ctx.ensureDb();
    const changedKeys: string[] = [];

    for (const [key, value] of Object.entries(settings)) {
      setSetting(db, key, value);
      changedKeys.push(key);
    }

    // 如果更新了 OpenAI 兼容配置，通知调用方重初始化
    if (onSettingsChange) {
      onSettingsChange(changedKeys);
    }

    return { success: true };
  });

  // 获取设置
  ipcMain.handle('settings-get', async (_ev, key?: string) => {
    const db = await ctx.ensureDb();
    if (key) {
      return getSetting(db, key);
    }
    return listSettings(db);
  });

  // 模型状态
  ipcMain.handle('models-status', async () => {
    const bundle = await ctx.ensureRuntime();
    return bundle.modelProvider.getModelsStatus();
  });

  // 文件对话框
  ipcMain.handle('open-file-dialog', async (_ev, options?: { multiple?: boolean; directory?: boolean; filters?: Array<{ name: string; extensions: string[] }> }) => {
    const properties: Array<'openDirectory' | 'multiSelections'> = [];
    if (options?.directory) {
      properties.push('openDirectory');
    }
    if (options?.multiple) {
      properties.push('multiSelections');
    }
    const result = await dialog.showOpenDialog(ctx.win, {
      properties,
      filters: options?.filters,
    });
    return result.filePaths;
  });

  // 在资源管理器中打开目录
  ipcMain.handle('reveal-in-explorer', async (_ev, targetPath: string) => {
    const error = await shell.openPath(targetPath);
    return error ? { success: false, error } : { success: true };
  });
}
