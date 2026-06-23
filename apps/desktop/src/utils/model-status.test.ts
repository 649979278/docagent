import { describe, expect, it } from 'vitest';
import { normalizeOllamaStatus, resolveActiveModelName } from './model-status.js';

describe('renderer model status mapping', () => {
  it('maps native Ollama provider status to online display state', () => {
    const status = {
      ollama: 'running',
      chatModel: { name: 'qwen3.5:9b', available: true },
      embeddingModel: { name: 'bge-m3', available: true },
      models: [{ name: 'qwen3.5:9b' }],
    };

    expect(normalizeOllamaStatus(status)).toBe('running');
    expect(resolveActiveModelName(status)).toBe('qwen3.5:9b');
  });

  it('keeps compatibility with legacy preload status shape', () => {
    const status = {
      providers: [{ name: 'ollama', available: true, models: ['qwen3.5:9b'] }],
      activeModel: 'qwen3.5:9b',
      health: true,
    };

    expect(normalizeOllamaStatus(status)).toBe('running');
    expect(resolveActiveModelName(status)).toBe('qwen3.5:9b');
  });
});
