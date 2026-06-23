const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * 定位当前仓库实际安装的 vitest 入口。
 * @returns {string} vitest.mjs 绝对路径。
 */
function resolveVitestEntry() {
  const pnpmDir = path.join(process.cwd(), 'node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) {
    throw new Error('node_modules/.pnpm 不存在，无法定位 vitest。请先执行 pnpm install。');
  }

  const match = fs.readdirSync(pnpmDir)
    .filter((name) => name.startsWith('vitest@'))
    .sort()
    .reverse()[0];

  if (!match) {
    throw new Error('未安装 vitest。请先执行 pnpm install。');
  }

  const entry = path.join(pnpmDir, match, 'node_modules', 'vitest', 'vitest.mjs');
  if (!fs.existsSync(entry)) {
    throw new Error(`vitest 入口不存在: ${entry}`);
  }

  return entry;
}

/**
 * 运行 vitest 并透传参数。
 */
function main() {
  let entry;
  try {
    entry = resolveVitestEntry();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[run-vitest] ${message}\n`);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  });

  if (typeof result.status === 'number') {
    process.exit(result.status);
  }

  process.exit(1);
}

main();
