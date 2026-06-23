const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { REQUIRED_OLLAMA_MODELS, isModelAvailable } = require('../packages/shared/model-constants.cjs');

/**
 * 读取命令输出。
 * @param {string} command - 要执行的命令。
 * @param {string[]} args - 命令参数。
 * @returns {{ok: boolean, text: string}} 命令执行结果。
 */
function run(command, args) {
  const isWindowsPnpm = process.platform === 'win32' && command === 'pnpm';
  const result = spawnSync(isWindowsPnpm ? 'cmd.exe' : command, isWindowsPnpm ? ['/c', command, ...args] : args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0) {
    return {
      ok: true,
      text: (result.stdout || '').trim(),
    };
  }

  return {
    ok: false,
    text: ((result.stderr || result.stdout || '').trim()) || 'unavailable',
  };
}

/**
 * 输出单行检查结果。
 * @param {string} label - 检查项名称。
 * @param {string} value - 检查结果。
 */
function printLine(label, value) {
  console.log(`${label}: ${value}`);
}

/**
 * 检查指定模块是否可被 Node 成功解析。
 * @param {string} moduleName - 模块名。
 * @param {string} [fromDir] - 解析起点目录。
 * @returns {{ok: boolean, detail: string}} 检查结果。
 */
function checkModule(moduleName, fromDir = process.cwd()) {
  try {
    require.resolve(moduleName, { paths: [fromDir] });
    return { ok: true, detail: 'ok' };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 检查本地环境是否满足第三期开发验证要求。
 */
async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const pkgJsonPath = path.join(repoRoot, 'package.json');
  const appsDesktopPkgPath = path.join(repoRoot, 'apps/desktop/package.json');
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  let hasErrors = false;

  printLine('repo', repoRoot);
  printLine('node', process.version);
  printLine('node_major_ok', nodeMajor >= 24 ? 'yes' : 'no');

  if (nodeMajor < 24) {
    hasErrors = true;
  }

  const pnpmResult = run('pnpm', ['-v']);
  printLine('pnpm', pnpmResult.ok ? pnpmResult.text : `missing (${pnpmResult.text})`);
  if (!pnpmResult.ok) hasErrors = true;

  const ollamaResult = run('ollama', ['--version']);
  printLine('ollama', ollamaResult.ok ? ollamaResult.text : `missing (${ollamaResult.text})`);

  const pkgJsonExists = fs.existsSync(pkgJsonPath);
  const desktopPkgExists = fs.existsSync(appsDesktopPkgPath);
  printLine('root_package_json', pkgJsonExists ? 'present' : 'missing');
  printLine('desktop_package_json', desktopPkgExists ? 'present' : 'missing');

  const workspaceConfigExists = fs.existsSync(path.join(repoRoot, 'pnpm-workspace.yaml'));
  printLine('pnpm_workspace', workspaceConfigExists ? 'present' : 'missing');

  const pnpmDirExists = fs.existsSync(path.join(repoRoot, 'node_modules', '.pnpm'));
  printLine('workspace_dependencies', pnpmDirExists ? 'installed' : 'missing → pnpm install');
  if (!pnpmDirExists) {
    hasErrors = true;
  }

  if (!pkgJsonExists || !desktopPkgExists || !workspaceConfigExists) {
    hasErrors = true;
  }

  const betterSqlite = checkModule('better-sqlite3', path.join(repoRoot, 'packages', 'store'));
  printLine('better_sqlite3', betterSqlite.ok ? 'ok' : `missing (${betterSqlite.detail})`);
  if (!betterSqlite.ok) hasErrors = true;

  const lanceDb = checkModule('@lancedb/lancedb', path.join(repoRoot, 'packages', 'rag'));
  printLine('lancedb', lanceDb.ok ? 'ok' : `missing (${lanceDb.detail})`);
  if (!lanceDb.ok) hasErrors = true;

  const vitest = checkModule('vitest');
  printLine('vitest', vitest.ok ? 'ok' : `missing (${vitest.detail})`);
  if (!vitest.ok) hasErrors = true;

  // Ollama 模型存在性检查
  if (ollamaResult.ok) {
    try {
      const tagsResp = await fetch('http://localhost:11434/api/tags');
      if (tagsResp.ok) {
        const tags = await tagsResp.json();
        const modelNames = (tags.models || []).map(m => m.name);
        let modelOk = true;
        for (const [key, required] of Object.entries(REQUIRED_OLLAMA_MODELS)) {
          const found = isModelAvailable(required, modelNames);
          printLine(`model_${key}`, found ? `ok (${required})` : `MISSING → ollama pull ${required}`);
          if (!found) {
            modelOk = false;
          }
        }
        if (!modelOk) hasErrors = true;
      } else {
        printLine('ollama_api', `error (status ${tagsResp.status})`);
        hasErrors = true;
      }
    } catch (err) {
      printLine('ollama_api', `unreachable (${err.message})`);
      hasErrors = true;
    }
  } else {
    printLine('ollama_models', 'skipped (ollama not running)');
    hasErrors = true;
  }

  if (hasErrors) {
    process.exitCode = 1;
  }
}

main();
