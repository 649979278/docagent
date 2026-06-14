import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { initDatabase } from '@workagent/store';
import { createRuntimeBundleForTest } from '../../apps/desktop/electron/runtime-factory.js';

/**
 * Worker / direct 运行时一致性测试。
 */
describe('runtime worker parity', () => {
  it('worker and direct runtime bundles are equivalent', async () => {
    const db = await initDatabase({
      dbPath: path.join(process.cwd(), '.tmp-runtime-parity.db'),
    });

    const direct = await createRuntimeBundleForTest('direct', { db });
    const worker = await createRuntimeBundleForTest('worker', { db });

    expect(direct.tools).toEqual(worker.tools);
    expect(direct.hasRagProvider).toBe(worker.hasRagProvider);
    expect(direct.providerKind).toBe(worker.providerKind);
    expect(direct.hasPlanController).toBe(worker.hasPlanController);
  });
});
