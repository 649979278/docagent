#!/usr/bin/env node

/**
 * Electron开发启动脚本
 * 1. 编译Electron主进程TypeScript
 * 2. 启动Vite开发服务器（渲染进程）
 * 3. 等待Vite就绪后启动Electron
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON_DIST = path.join(ROOT, 'dist', 'electron');
const VITE_PORT = 5173;
const VITE_URL = `http://localhost:${VITE_PORT}`;

/** 等待Vite开发服务器就绪 */
function waitForVite(maxRetries = 30) {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const check = () => {
      http.get(VITE_URL, (res) => {
        if (res.statusCode === 200 || res.statusCode === 304) {
          console.log('[dev] Vite开发服务器就绪');
          resolve(true);
        } else {
          retry();
        }
      }).on('error', () => {
        retry();
      });
    };

    const retry = () => {
      retries++;
      if (retries >= maxRetries) {
        reject(new Error('Vite开发服务器启动超时'));
        return;
      }
      setTimeout(check, 1000);
    };

    check();
  });
}

async function main() {
  console.log('[dev] 1. 编译Electron主进程...');
  try {
    execSync('npx tsc', {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'development' },
    });
  } catch (error) {
    console.error('[dev] TypeScript编译失败');
    process.exit(1);
  }

  console.log('[dev] 2. 启动Vite开发服务器...');
  const vite = spawn('npx', ['vite'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, NODE_ENV: 'development' },
  });

  try {
    await waitForVite();
  } catch (error) {
    console.error(error.message);
    vite.kill();
    process.exit(1);
  }

  console.log('[dev] 3. 启动Electron...');
  const electron = spawn('npx', ['electron', '.'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, NODE_ENV: 'development' },
  });

  electron.on('close', (code) => {
    console.log(`[dev] Electron退出 (code=${code})`);
    vite.kill();
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => {
    electron.kill();
    vite.kill();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[dev] 启动失败:', error);
  process.exit(1);
});
