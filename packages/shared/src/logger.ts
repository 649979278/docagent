import pino, { type Logger } from 'pino';

/**
 * 创建结构化日志实例。
 * 开发环境默认启用 pretty 输出，其余环境保持 JSON 结构化日志。
 *
 * @param name - 日志命名空间。
 * @returns 日志实例。
 */
export function createLogger(name: string): Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true },
        }
      : undefined,
  });
}
