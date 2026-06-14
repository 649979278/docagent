/**
 * Node.js核心模块类型声明（store包本地）
 */

declare const Buffer: { from(data: ArrayLike<number> | Uint8Array): Buffer; };
interface Buffer { toString(encoding?: string): string; }

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
  function statSync(path: string): { size: number; mtimeMs: number; isFile(): boolean; isDirectory(): boolean };
  function accessSync(path: string, mode?: number): void;
  const constants: { R_OK: number; W_OK: number };
}

declare module 'os' {
  function homedir(): string;
  function platform(): string;
}

declare module 'sql.js' {
  interface SqlJsStatic { Database: new (data?: ArrayLike<number>) => Database; }
  interface Database {
    run(sql: string, params?: unknown[]): Database;
    prepare(sql: string): Statement;
    exec(sql: string): { columns: string[]; values: unknown[][] }[];
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }
  interface Statement {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
  }
  export type { Database, Statement };
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
