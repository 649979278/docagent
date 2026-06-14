/**
 * 常量定义 - 跨前后端共享
 */

// ============================================================
// 应用信息
// ============================================================

/** 应用名称 */
export const APP_NAME = 'WorkAgent';

/** 应用版本 */
export const APP_VERSION = '0.1.0';

/** 数据目录名（在%USERPROFILE%下） */
export const DATA_DIR_NAME = 'WorkAgent';

/** 默认知识库目录名（在Documents下） */
export const KNOWLEDGE_DIR_NAME = 'WorkAgent';

// ============================================================
// Ollama配置
// ============================================================

/** Ollama默认API地址 */
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';

/** Ollama健康检查端点 */
export const OLLAMA_HEALTH_ENDPOINT = '/api/tags';

/** Ollama聊天端点 */
export const OLLAMA_CHAT_ENDPOINT = '/api/chat';

/** Ollama Embedding端点 */
export const OLLAMA_EMBED_ENDPOINT = '/api/embed';

/** Ollama模型拉取端点 */
export const OLLAMA_PULL_ENDPOINT = '/api/pull';

/** Ollama模型详情端点 */
export const OLLAMA_SHOW_ENDPOINT = '/api/show';

/** Ollama健康检查间隔(ms) */
export const OLLAMA_HEALTH_CHECK_INTERVAL = 30_000;

/** Ollama启动等待超时(ms) */
export const OLLAMA_STARTUP_TIMEOUT = 30_000;

/** Ollama崩溃重启最大次数 */
export const OLLAMA_MAX_RESTART_ATTEMPTS = 3;

// ============================================================
// 默认模型
// ============================================================

/** 默认聊天模型 */
export const DEFAULT_CHAT_MODEL = 'qwen3.5:9b';

/** 默认Embedding模型 */
export const DEFAULT_EMBEDDING_MODEL = 'bge-m3';

/** Ollama 必需模型清单（精确匹配模型名） */
export const REQUIRED_OLLAMA_MODELS = {
  chat: 'qwen3.5:9b',
  embedding: 'bge-m3',
  reranker: 'bge-reranker-v2-m3',
} as const;

/**
 * 模型名 alias 白名单。
 * key = 期望模型名，value = 可接受的替代 tag 列表。
 * 不在白名单中的变体一律视为不匹配。
 */
export const MODEL_ALIASES: Record<string, string[]> = {
  'qwen3.5:9b': ['qwen3.5:9b-q4_K_M'],
  'bge-m3': ['bge-m3:latest'],
  'bge-reranker-v2-m3': ['qllama/bge-reranker-v2-m3:latest'],
};

/**
 * 检查 Ollama 模型列表是否包含指定模型。
 * 精确匹配优先，再查 alias 白名单。
 * qwen3.5:7b 不会误判为 qwen3.5:9b。
 *
 * @param modelName - 期望的模型名。
 * @param availableModels - Ollama 返回的可用模型名列表。
 * @returns 是否可用。
 */
export function isModelAvailable(modelName: string, availableModels: string[]): boolean {
  if (availableModels.includes(modelName)) return true;
  const aliases = MODEL_ALIASES[modelName] ?? [];
  return aliases.some(alias => availableModels.includes(alias));
}

/** 备选Embedding模型 */
export const FALLBACK_EMBEDDING_MODEL = 'nomic-embed-text';

/** bge-m3向量维度 */
export const BGE_M3_DIMENSIONS = 1024;

// ============================================================
// 上下文管理
// ============================================================

/** 默认上下文窗口大小(qwen3.5:9b) */
export const DEFAULT_CONTEXT_LENGTH = 32_768;

/** 上下文压缩触发阈值(75%) */
export const COMPACT_THRESHOLD = 0.75;

/** 压缩时保留最近N条消息 */
export const COMPACT_KEEP_RECENT_MESSAGES = 6;

/** 工具结果最大token数(防止单个结果吃掉context) */
export const MAX_TOOL_RESULT_TOKENS = 2000;

/** 工具执行超时(ms) */
export const TOOL_EXECUTION_TIMEOUT = 60_000;

// ============================================================
// RAG配置
// ============================================================

/** 默认检索topK */
export const DEFAULT_RAG_TOP_K = 5;

/** 注入模型的RAG片段最大数量 */
export const MAX_RAG_INJECT_CHUNKS = 3;

/** 每段RAG片段大约中文字数 */
export const RAG_CHUNK_CHAR_RANGE = { min: 200, max: 350 };

/** 文档分块大小(字符) */
export const CHUNK_SIZE = 500;

/** 文档分块重叠大小(字符) */
export const CHUNK_OVERLAP = 50;

// ============================================================
// 间隔和超时
// ============================================================

/** 索引任务轮询间隔(ms) */
export const INDEX_JOB_POLL_INTERVAL = 1000;

/** SSE重连间隔(ms) */
export const SSE_RECONNECT_INTERVAL = 3000;

/** 进程检查间隔(ms) */
export const PROCESS_CHECK_INTERVAL = 5000;

// ============================================================
// 文件类型
// ============================================================

/** 一期支持的文档类型 */
export const SUPPORTED_FILE_TYPES = [
  'docx', 'pptx', 'pdf', 'txt', 'md',
] as const;

/** 一期支持的文档类型集合 */
export const SUPPORTED_FILE_EXTENSIONS = new Set(SUPPORTED_FILE_TYPES);

/** 需要提示用户转换的旧格式 */
export const LEGACY_FILE_TYPES = ['doc', 'ppt'] as const;

/** 旧格式转换提示 */
export const LEGACY_FORMAT_HINT = '请先另存为docx/pptx/pdf格式后再导入';

// ============================================================
// 路径配置
// ============================================================

/** 应用数据目录（相对于%USERPROFILE%） */
export const APP_DATA_RELATIVE_PATH = 'WorkAgent';

/** 数据库文件名 */
export const DB_FILENAME = 'workagent.db';

/** 向量数据目录名 */
export const VECTORS_DIR_NAME = 'vectors';

/** 输出目录名 */
export const OUTPUT_DIR_NAME = 'output';

/** 日志目录名 */
export const LOGS_DIR_NAME = 'logs';

/** 模板目录名 */
export const TEMPLATES_DIR_NAME = 'templates';
