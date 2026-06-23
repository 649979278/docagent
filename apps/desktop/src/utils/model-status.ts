import type { RunState } from '../stores/run-store.js';

/** 前端可展示的模型状态结构，兼容原生 Ollama provider 与旧 preload 契约。 */
export interface RendererModelsStatus {
  ollama?: string;
  chatModel?: { name: string; available: boolean };
  embeddingModel?: { name: string; available: boolean };
  models?: Array<{ name: string }>;
  providers?: Array<{ name: string; available: boolean; models: string[] }>;
  activeModel?: string;
  health?: boolean;
}

/**
 * 将主进程/Provider 返回的 Ollama 状态映射为 run-store 可展示状态。
 * @param status - 主进程推送或模型状态查询结果。
 * @returns 前端运行状态枚举。
 */
export function normalizeOllamaStatus(status: unknown): RunState['ollamaStatus'] {
  if (status === 'running' || status === 'not_installed' || status === 'start_failed') {
    return status;
  }
  if (typeof status === 'object' && status !== null) {
    const modelsStatus = status as RendererModelsStatus;
    if (modelsStatus.ollama === 'running' || modelsStatus.health === true) {
      return 'running';
    }
    if (modelsStatus.ollama === 'not_installed') {
      return 'not_installed';
    }
  }
  return 'start_failed';
}

/**
 * 从模型状态结果中提取当前对话模型名称。
 * @param status - 模型状态查询结果。
 * @returns 当前模型名称，无法识别时返回空字符串。
 */
export function resolveActiveModelName(status: RendererModelsStatus): string {
  if (status.activeModel) return status.activeModel;
  if (status.chatModel?.name) return status.chatModel.name;
  const firstProviderModel = status.providers?.find((provider) => provider.models.length > 0)?.models[0];
  if (firstProviderModel) return firstProviderModel;
  return status.models?.[0]?.name ?? '';
}
