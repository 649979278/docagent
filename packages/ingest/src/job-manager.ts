/**
 * 索引任务状态机
 * 管理文档索引任务的生命周期，从排队到完成或失败
 * 每次状态变更通过回调通知上层
 */

import type { IndexJobStatus, IndexJob } from '@workagent/shared';

/**
 * 索引任务状态变更回调
 * @param job - 变更后的任务状态
 * @param previousStatus - 变更前的状态
 */
export type JobStatusCallback = (job: IndexJob, previousStatus: IndexJobStatus) => void;

/**
 * 索引任务管理器
 * 管理文档索引任务的状态机，支持创建、更新、查询和重试
 */
export class JobManager {
  /** 任务映射表 jobId -> IndexJob */
  private jobs: Map<string, IndexJob> = new Map();

  /** 状态变更回调列表 */
  private callbacks: JobStatusCallback[] = [];

  /** 自增ID计数器 */
  private nextId: number = 1;

  /**
   * 注册状态变更回调
   * @param callback - 状态变更回调函数
   */
  onStatusChange(callback: JobStatusCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * 创建新的索引任务
   * 初始状态为queued，进度为0
   * @param documentId - 关联的文档ID
   * @returns 创建的索引任务
   */
  createJob(documentId: string): IndexJob {
    const now = Date.now();
    const job: IndexJob = {
      id: `job_${this.nextId++}`,
      documentId,
      status: 'queued',
      progress: 0,
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.id, job);
    return { ...job };
  }

  /**
   * 更新任务状态和进度
   * @param jobId - 任务ID
   * @param status - 新状态
   * @param progress - 新进度（0-100），不传则保持原值
   * @param error - 错误信息（仅failed状态需要）
   * @returns 更新后的任务，任务不存在时返回null
   */
  updateJob(jobId: string, status: IndexJobStatus, progress?: number, error?: string): IndexJob | null {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }

    const previousStatus = job.status;

    // 验证状态转换合法性
    if (!this.isValidTransition(previousStatus, status)) {
      return null;
    }

    job.status = status;
    if (progress !== undefined) {
      job.progress = Math.max(0, Math.min(100, progress));
    }
    if (error !== undefined) {
      job.error = error;
    }
    job.updatedAt = Date.now();

    // 通知回调
    this.notifyCallbacks(job, previousStatus);

    return { ...job };
  }

  /**
   * 获取任务状态
   * @param jobId - 任务ID
   * @returns 任务状态，不存在时返回null
   */
  getJob(jobId: string): IndexJob | null {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  /**
   * 获取指定文档的所有任务
   * @param documentId - 文档ID
   * @returns 该文档的任务列表
   */
  getJobsByDocument(documentId: string): IndexJob[] {
    const result: IndexJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.documentId === documentId) {
        result.push({ ...job });
      }
    }
    return result.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * 重试失败的任务
   * 将状态重置为queued，清除错误信息
   * @param jobId - 任务ID
   * @returns 重试后的任务，任务不存在或非failed状态时返回null
   */
  retryJob(jobId: string): IndexJob | null {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'failed') {
      return null;
    }

    const previousStatus = job.status;

    job.status = 'queued';
    job.progress = 0;
    job.error = null;
    job.updatedAt = Date.now();

    this.notifyCallbacks(job, previousStatus);

    return { ...job };
  }

  /**
   * 获取所有任务
   * @returns 任务列表（按创建时间排序）
   */
  getAllJobs(): IndexJob[] {
    return [...this.jobs.values()]
      .map((job) => ({ ...job }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * 删除指定任务
   * @param jobId - 任务ID
   * @returns 是否删除成功
   */
  removeJob(jobId: string): boolean {
    return this.jobs.delete(jobId);
  }

  /**
   * 验证状态转换是否合法
   * 索引任务只能按以下顺序推进：queued -> hashing -> extracting -> chunking -> embedding -> indexing -> indexed
   * 任何状态都可以转换到failed
   * @param from - 当前状态
   * @param to - 目标状态
   * @returns 转换是否合法
   */
  private isValidTransition(from: IndexJobStatus, to: IndexJobStatus): boolean {
    // 任何状态都可以转为failed
    if (to === 'failed') {
      return true;
    }

    // 已经终态的任务不能再转换（indexed/failed）
    if (from === 'indexed' || from === 'failed') {
      return false;
    }

    // 定义合法的顺序转换
    const validNext: Record<IndexJobStatus, IndexJobStatus[]> = {
      queued: ['hashing'],
      hashing: ['extracting'],
      extracting: ['chunking'],
      chunking: ['embedding'],
      embedding: ['indexing'],
      indexing: ['indexed'],
      indexed: [],
      failed: [],
    };

    return validNext[from]?.includes(to) ?? false;
  }

  /**
   * 通知所有注册的回调
   * @param job - 变更后的任务
   * @param previousStatus - 变更前的状态
   */
  private notifyCallbacks(job: IndexJob, previousStatus: IndexJobStatus): void {
    for (const callback of this.callbacks) {
      try {
        callback({ ...job }, previousStatus);
      } catch {
        // 回调执行错误不中断其他回调
      }
    }
  }
}
