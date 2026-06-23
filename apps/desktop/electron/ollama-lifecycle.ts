/**
 * Ollama进程生命周期管理
 * 参考Jan的Nitro sidecar管理模式
 */

import { createLogger, OLLAMA_HEALTH_CHECK_INTERVAL, OLLAMA_MAX_RESTART_ATTEMPTS } from '@workagent/shared';
import { checkOllamaRunning, startOllama, findOllamaBinary } from '@workagent/windows-tools';

/** Ollama状态 */
export type OllamaLifecycleStatus = 'running' | 'not_installed' | 'start_failed' | 'unavailable';

/** Ollama生命周期管理器 */
export class OllamaLifecycle {
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private restartAttempts = 0;
  private readonly logger = createLogger('ollama-lifecycle');

  /**
   * 初始化：检测→引导→启动
   */
  async initialize(): Promise<OllamaLifecycleStatus> {
    // 1. 检查是否已在运行
    if (await checkOllamaRunning()) {
      this.startHealthMonitoring();
      return 'running';
    }

    // 2. 尝试启动
    const ollamaPath = await findOllamaBinary();
    if (!ollamaPath) {
      return 'not_installed';
    }

    const started = await startOllama(ollamaPath);
    if (started) {
      this.startHealthMonitoring();
      return 'running';
    }

    return 'start_failed';
  }

  /**
   * 启动健康监控
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(async () => {
      const running = await checkOllamaRunning();
      if (!running) {
        await this.handleCrash();
      }
    }, OLLAMA_HEALTH_CHECK_INTERVAL);
  }

  /**
   * 处理Ollama崩溃
   */
  private async handleCrash(): Promise<void> {
    if (this.restartAttempts >= OLLAMA_MAX_RESTART_ATTEMPTS) {
      this.logger.error({ component: 'ollama', attempts: this.restartAttempts }, 'Ollama crashed and max restart attempts reached');
      return;
    }

    this.restartAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.restartAttempts), 30000);
    this.logger.warn({ component: 'ollama', delay, attempt: this.restartAttempts }, 'Ollama crashed, retrying');

    await new Promise(resolve => setTimeout(resolve, delay));

    const started = await startOllama();
    if (started) {
      this.restartAttempts = 0;
    }
  }

  /**
   * 停止监控
   */
  dispose(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
}
