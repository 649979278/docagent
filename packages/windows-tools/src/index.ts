/**
 * @workagent/windows-tools - Windows专用工具入口
 */

export { detectOllama, checkOllamaRunning, listOllamaModels, startOllama, findOllamaBinary } from './ollama-detect.js';
export type { OllamaDetectResult } from './ollama-detect.js';

export { listFiles, isFileReadable, computeFileHash, ensureDir, getAppDataDir, getDefaultKnowledgeDir, getOutputDir } from './file-ops.js';
export type { FileInfo } from './file-ops.js';

export { executePowerShell } from './powershell.js';
export type { PowerShellResult } from './powershell.js';
