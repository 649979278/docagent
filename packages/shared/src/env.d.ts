/**
 * Node.js内置模块类型声明
 * 确保TypeScript能识别node:协议的导入
 */
declare module 'node:path' {
  export * from 'path';
}
declare module 'node:fs' {
  export * from 'fs';
}
declare module 'node:os' {
  export * from 'os';
}
declare module 'node:child_process' {
  export * from 'child_process';
}
declare module 'node:crypto' {
  export * from 'crypto';
}
declare module 'node:readline' {
  export * from 'readline';
}
