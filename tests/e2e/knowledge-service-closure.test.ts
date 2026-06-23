import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { initDatabase, listDocuments, getChunksByDocument } from '@workagent/store';
import { MockModelProvider } from '@workagent/model-provider';
import { createDesktopRuntimeBundle } from '../../apps/desktop/electron/runtime-factory.js';

describe('knowledge service closure', () => {
  it('indexes, searches, removes, and survives restart without stale hits', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workagent-knowledge-service-'));
    const dbPath = path.join(tempDir, 'knowledge.db');
    const filePath = path.join(tempDir, 'policy.txt');
    fs.writeFileSync(filePath, '国办发〔2024〕1号 要求优化营商环境，推进数字政务闭环。', 'utf8');

    const db = initDatabase({ dbPath });
    const bundle = await createDesktopRuntimeBundle({
      db,
      autoApprovePermissions: true,
      appDataDir: tempDir,
      modelProvider: new MockModelProvider({ delay: 0 }),
    });

    const addResult = await bundle.knowledgeService.addDocument(filePath);
    expect(addResult.status).toBe('indexed');
    expect(addResult.documentId).toBeTruthy();
    expect(getChunksByDocument(db, addResult.documentId!)).not.toHaveLength(0);

    const searchResult = await bundle.ragEngine.search('国办发〔2024〕1号', { topK: 3 });
    expect(searchResult.some((chunk) => chunk.content.includes('国办发〔2024〕1号'))).toBe(true);

    const removeResult = await bundle.knowledgeService.removeDocument(addResult.documentId!);
    expect(removeResult.success).toBe(true);
    expect(listDocuments(db)).toHaveLength(0);

    const restartedDb = initDatabase({ dbPath });
    const restartedBundle = await createDesktopRuntimeBundle({
      db: restartedDb,
      autoApprovePermissions: true,
      appDataDir: tempDir,
      modelProvider: new MockModelProvider({ delay: 0 }),
    });
    const afterRestart = await restartedBundle.ragEngine.search('国办发〔2024〕1号', { topK: 3 });
    expect(afterRestart.some((chunk) => chunk.sourceFile === filePath)).toBe(false);
  });
});
