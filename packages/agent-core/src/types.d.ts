/**
 * 全局类型声明（model-provider包）
 */

declare const Buffer: { from(data: ArrayLike<number> | Uint8Array): Buffer; };
interface Buffer { toString(encoding?: string): string; }

// fetch API (Node 18+)
declare function fetch(url: string, init?: RequestInit): Promise<Response>;
declare interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}
declare interface Response {
  ok: boolean;
  status: number;
  statusText: string;
  body: ReadableStream | null;
  json(): Promise<any>;
}
declare interface ReadableStream {
  getReader(): ReadableStreamDefaultReader;
}
declare interface ReadableStreamDefaultReader {
  read(): Promise<{ done: boolean; value: Uint8Array }>;
  releaseLock(): void;
}
declare class AbortSignal {
  static timeout(ms: number): AbortSignal;
  aborted: boolean;
}
declare class AbortController {
  signal: AbortSignal;
  abort(): void;
}
declare class TextDecoder {
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}

// Timer
declare function setTimeout(callback: (...args: any[]) => void, ms: number): any;
declare function clearTimeout(timer: any): void;
declare function setInterval(callback: (...args: any[]) => void, ms: number): any;
declare function clearInterval(timer: any): void;
