const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * 解析仓库内 Electron 可执行文件路径。
 * @returns {string} Electron 可执行文件绝对路径。
 */
function resolveElectronBinary() {
  const electronModule = require.resolve('electron', {
    paths: [path.resolve(__dirname, '..', 'apps', 'desktop')],
  });
  const electronPackageDir = path.dirname(electronModule);
  const executable = require(electronPackageDir);
  return executable;
}

/**
 * 使用 Electron 运行时加载 native 依赖，确保 ABI 与真实桌面应用一致。
 */
function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const electronBinary = resolveElectronBinary();
  const script = [
    "const betterSqlite3 = require('better-sqlite3');",
    'const db = new betterSqlite3(":memory:");',
    'db.exec("create table healthcheck(id integer primary key, value text)");',
    'db.prepare("insert into healthcheck(value) values (?)").run("ok");',
    'const row = db.prepare("select value from healthcheck where id = 1").get();',
    'db.close();',
    'if (!row || row.value !== "ok") process.exit(2);',
  ].join('');

  const result = spawnSync(electronBinary, ['-e', script], {
    cwd: path.join(repoRoot, 'apps', 'desktop'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  });

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    console.error(detail || 'Electron native dependency check failed');
    console.error('Run `pnpm desktop:prepare-native` before launching the desktop app.');
    process.exit(result.status || 1);
  }

  console.log('electron_native: ok');
}

main();
