/**
 * Node.js核心模块类型声明
 * 不依赖@types/node，提供最小声明使编译通过
 */

// Buffer
declare const Buffer: {
  from(data: ArrayLike<number>): Buffer;
};

interface Buffer {
  toString(encoding?: string): string;
}

// Node.js内置模块
declare module 'path' {
  function join(...paths: string[]): string;
  function dirname(p: string): string;
  function basename(p: string, ext?: string): string;
  function extname(p: string): string;
  function resolve(...pathSegments: string[]): string;
  const sep: string;
}

declare module 'fs' {
  function existsSync(path: string): boolean;
  function readFileSync(path: string, options?: { encoding?: string; flag?: string } | string): Buffer | string;
  function writeFileSync(path: string, data: string | Buffer | Uint8Array, options?: { encoding?: string }): void;
  function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  function readdirSync(path: string, options?: { withFileTypes?: boolean }): string[] | import('fs').Dirent[];
  function statSync(path: string): { size: number; mtimeMs: number; isFile(): boolean; isDirectory(): boolean };
  function accessSync(path: string, mode?: number): void;
  function unlinkSync(path: string): void;
  const constants: { R_OK: number; W_OK: number };
  interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
  }
}

declare module 'os' {
  function homedir(): string;
  function tmpdir(): string;
  function platform(): string;
  function cpus(): Array<{ model: string }>;
  function totalmem(): number;
  function freemem(): number;
}

declare module 'child_process' {
  function execFile(file: string, args: string[], options: any, callback?: (error: any, stdout: string, stderr: string) => void): any;
  function spawn(command: string, args: string[], options?: any): any;
  const promisify: { (fn: Function): Function };
}

declare module 'crypto' {
  function createHash(algorithm: string): Hash;
  interface Hash {
    update(data: string | Buffer): Hash;
    digest(encoding: string): string;
  }
}

declare module 'readline' {
  function createInterface(options: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream }): Interface;
  interface Interface {
    question(prompt: string, callback: (answer: string) => void): void;
    close(): void;
  }
}

declare module 'http' {
  function createServer(handler: (req: any, res: any) => void): Server;
  interface Server {
    listen(port: number, callback?: () => void): Server;
    close(): void;
  }
}

// NodeJS global
declare namespace NodeJS {
  interface ReadableStream {}
  interface WritableStream {}
}
