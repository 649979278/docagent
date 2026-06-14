/**
 * 模型健康检查与自动恢复
 * 持续监控Ollama可用性，检测到不可用时自动重试
 * 崩溃重启策略：指数退避，最多3次
 */

import { OLLAMA_HEALTH_CHECK_INTERVAL, OLLAMA_MAX_RESTART_ATTEMPTS } from '@workagent/shared';
import type { ModelProvider, OllamaStatus } from './provider.js';

/** 健康检查结果 */
export interface HealthCheckResult {
  /** 是否可用 */
  available: boolean;
  /** Ollama状态 */
  status: OllamaStatus;
  /** 上次检查时间 */
  checkedAt: number;
  /** 错误信息 */
  error?: string;
}

/** 健康监控回调 */
export type HealthCallback = (result: HealthCheckResult) => void;

/**
 * 模型健康监控器
 * 定期检查Ollama可用性，不可用时自动重连
 */
export class ModelHealthMonitor {
  /** 模型提供者 */
  private provider: ModelProvider;
  /** 健康检查定时器 */
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  /** 连续失败次数 */
  private consecutiveFailures = 0;
  /** 上次检查结果 */
  private lastResult: HealthCheckResult | null = null;
  /** 状态变化回调 */
  private callback: HealthCallback | null = null;
  /** 是否正在重连 */
  private reconnecting = false;

  /**
   * 创建健康监控器
   * @param provider - 模型提供者实例
   */
  constructor(provider: ModelProvider) {
    this.provider = provider;
  }

  /**
   * 设置状态变化回调
   * @param callback - 回调函数
   */
  onStatusChange(callback: HealthCallback): void {
    this.callback = callback;
  }

  /**
   * 启动健康监控
   * @param intervalMs - 检查间隔（毫秒），默认30秒
   */
  start(intervalMs: number = OLLAMA_HEALTH_CHECK_INTERVAL): void {
    if (this.checkTimer) return;

    // 立即执行一次检查
    this.performCheck();

    this.checkTimer = setInterval(() => {
      this.performCheck();
    }, intervalMs);
  }

  /**
   * 停止健康监控
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * 获取最近的健康检查结果
   * @returns 最近的检查结果，null表示尚未检查
   */
  getLastResult(): HealthCheckResult | null {
    return this.lastResult;
  }

  /**
   * 执行一次健康检查
   */
  private async performCheck(): Promise<void> {
    try {
      const available = await this.provider.isAvailable();

      if (available) {
        this.consecutiveFailures = 0;

        const result: HealthCheckResult = {
          available: true,
          status: 'running',
          checkedAt: Date.now(),
        };

        this.lastResult = result;
        this.reconnecting = false;
        this.callback?.(result);
      } else {
        this.consecutiveFailures++;
        await this.handleFailure();
      }
    } catch (error) {
      this.consecutiveFailures++;
      await this.handleFailure(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 处理健康检查失败
   * @param error - 错误信息
   */
  private async handleFailure(error?: string): Promise<void> {
    const result: HealthCheckResult = {
      available: false,
      status: this.consecutiveFailures >= OLLAMA_MAX_RESTART_ATTEMPTS ? 'start_failed' : 'unavailable',
      checkedAt: Date.now(),
      error,
    };

    this.lastResult = result;
    this.callback?.(result);

    // 尝试自动重连（指数退避）
    if (!this.reconnecting && this.consecutiveFailures < OLLAMA_MAX_RESTART_ATTEMPTS) {
      this.reconnecting = true;
      const delay = Math.min(1000 * Math.pow(2, this.consecutiveFailures), 30000);

      setTimeout(async () => {
        await this.performCheck();
        this.reconnecting = false;
      }, delay);
    }
  }
}

/**
 * 一次性健康检查（不启动持续监控）
 * @param provider - 模型提供者
 * @returns 健康检查结果
 */
export async function checkModelHealth(provider: ModelProvider): Promise<HealthCheckResult> {
  try {
    const available = await provider.isAvailable();
    return {
      available,
      status: available ? 'running' : 'unavailable',
      checkedAt: Date.now(),
    };
  } catch (error) {
    return {
      available: false,
      status: 'unavailable',
      checkedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
