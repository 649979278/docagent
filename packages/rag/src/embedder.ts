/**
 * Embedding封装
 * 调用ModelProvider.embed()生成向量，支持批量embedding
 * 一期如果Ollama不可用，返回随机向量（开发模式）
 */

import type { ModelProvider } from '@workagent/model-provider';
import { BGE_M3_DIMENSIONS } from '@workagent/shared';

/**
 * Embedding封装器
 * 将ModelProvider的embed方法封装为面向文档块的批量embedding接口
 */
export class OllamaEmbedder {
  /** 模型提供者实例 */
  private provider: ModelProvider;

  /** 向量维度 */
  private dimensions: number;

  /** 是否为开发模式（Ollama不可用时返回随机向量） */
  private devMode: boolean = false;

  /**
   * 创建Embedding封装器
   * @param provider - 模型提供者实例
   * @param dimensions - 向量维度，默认使用BGE_M3_DIMENSIONS
   */
  constructor(provider: ModelProvider, dimensions: number = BGE_M3_DIMENSIONS) {
    this.provider = provider;
    this.dimensions = dimensions;
  }

  /**
   * 检查Ollama是否可用，不可用时自动切换到开发模式
   * 应在创建实例后调用
   */
  async checkAvailability(): Promise<boolean> {
    try {
      const available = await this.provider.isAvailable();
      this.devMode = !available;
      return available;
    } catch {
      this.devMode = true;
      return false;
    }
  }

  /**
   * 对单个文本生成embedding向量
   * @param text - 输入文本
   * @returns 向量数组
   */
  async embed(text: string): Promise<number[]> {
    if (this.devMode) {
      return this.generateRandomVector();
    }

    try {
      const response = await this.provider.embed({
        input: text,
      });

      if (response.embeddings.length > 0) {
        return response.embeddings[0];
      }

      // embed失败时回退到随机向量
      return this.generateRandomVector();
    } catch {
      // Ollama调用失败，切换到开发模式
      this.devMode = true;
      return this.generateRandomVector();
    }
  }

  /**
   * 批量生成embedding向量
   * 优先使用批量接口，失败时逐个调用
   * @param texts - 输入文本列表
   * @returns 向量数组列表，与输入一一对应
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    if (this.devMode) {
      return texts.map(() => this.generateRandomVector());
    }

    try {
      const response = await this.provider.embed({
        input: texts,
      });

      if (response.embeddings.length === texts.length) {
        return response.embeddings;
      }

      // 批量结果不匹配，逐个生成
      return this.embedBatchFallback(texts);
    } catch {
      // 批量调用失败，先尝试逐个调用作为回退
      try {
        return await this.embedBatchFallback(texts);
      } catch {
        // 逐个调用也失败，才切换到开发模式
        this.devMode = true;
        return texts.map(() => this.generateRandomVector());
      }
    }
  }

  /**
   * 逐个调用embed的回退方案
   * @param texts - 输入文本列表
   * @returns 向量数组列表
   */
  private async embedBatchFallback(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  /**
   * 生成随机向量（开发模式）
   * 使用归一化的随机向量，维度与配置一致
   * @returns 随机向量
   */
  private generateRandomVector(): number[] {
    const vector: number[] = [];
    let norm = 0;

    for (let i = 0; i < this.dimensions; i++) {
      // Box-Muller变换生成正态分布随机数
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      vector.push(z);
      norm += z * z;
    }

    // 归一化
    const normSqrt = Math.sqrt(norm);
    if (normSqrt > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= normSqrt;
      }
    }

    return vector;
  }

  /**
   * 获取当前是否为开发模式
   * @returns 是否为开发模式
   */
  isDevMode(): boolean {
    return this.devMode;
  }

  /**
   * 获取向量维度
   * @returns 向量维度
   */
  getDimensions(): number {
    return this.dimensions;
  }
}
