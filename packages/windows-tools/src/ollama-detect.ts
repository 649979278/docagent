/**
 * Ollama安装检测
 * 检测Ollama是否已安装、是否运行、模型是否可用
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OLLAMA_DEFAULT_BASE_URL, DEFAULT_CHAT_MODEL, DEFAULT_EMBEDDING_MODEL } from '@workagent/shared';

const execFileAsync = promisify(execFile);

/** Ollama检测结果 */
export interface OllamaDetectResult {
  installed: boolean;
  running: boolean;
  installPath: string | null;
  chatModelAvailable: boolean;
  embeddingModelAvailable: boolean;
  baseUrl: string;
}

/**
 * 检测Ollama是否已安装
 * Windows: 检查PATH和常见安装路径
 * macOS: 检查/Applications和/usr/local/bin
 */
export async function detectOllama(): Promise<OllamaDetectResult> {
  const baseUrl = OLLAMA_DEFAULT_BASE_URL;
  let installed = false;
  let running = false;
  let installPath: string | null = null;
  let chatModelAvailable = false;
  let embeddingModelAvailable = false;

  // 1. 检查Ollama是否运行（HTTP健康检查）
  running = await checkOllamaRunning(baseUrl);

  if (running) {
    installed = true;
    // 2. 检查模型可用性
    const models = await listOllamaModels(baseUrl);
    chatModelAvailable = models.some(m => m.startsWith(DEFAULT_CHAT_MODEL));
    embeddingModelAvailable = models.some(m => m.startsWith(DEFAULT_EMBEDDING_MODEL));
  } else {
    // 3. 检查Ollama是否已安装但未运行
    const pathResult = await findOllamaBinary();
    installed = pathResult !== null;
    installPath = pathResult;
  }

  return { installed, running, installPath, chatModelAvailable, embeddingModelAvailable, baseUrl };
}

/**
 * 检查Ollama API是否可用
 */
export async function checkOllamaRunning(baseUrl: string = OLLAMA_DEFAULT_BASE_URL): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 列出Ollama已安装的模型
 */
export async function listOllamaModels(baseUrl: string = OLLAMA_DEFAULT_BASE_URL): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return [];
    const data = await response.json() as { models: Array<{ name: string }> };
    return data.models.map(m => m.name);
  } catch {
    return [];
  }
}

/**
 * 查找Ollama可执行文件路径
 */
export async function findOllamaBinary(): Promise<string | null> {
  const commands = ['ollama'];

  for (const cmd of commands) {
    try {
      const { stdout } = await execFileAsync('which', [cmd], { timeout: 5000 });
      if (stdout.trim()) return stdout.trim();
    } catch {
      // not found in PATH
    }
  }

  // 检查常见安装路径
  const commonPaths = [
    '/usr/local/bin/ollama',
    '/opt/homebrew/bin/ollama',
    // Windows路径（Wine/Cygwin环境下可能存在）
    '/c/Program Files/Ollama/ollama.exe',
  ];

  const { access } = await import('node:fs/promises');
  for (const p of commonPaths) {
    try {
      await access(p);
      return p;
    } catch {
      // not found
    }
  }

  return null;
}

/**
 * 启动Ollama服务
 */
export async function startOllama(ollamaPath?: string): Promise<boolean> {
  const cmd = ollamaPath ?? 'ollama';
  try {
    const { spawn } = await import('node:child_process');
    const child = spawn(cmd, ['serve'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    // 等待Ollama就绪
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      if (await checkOllamaRunning()) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
