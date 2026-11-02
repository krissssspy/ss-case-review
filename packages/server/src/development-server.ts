import type { ServerEnvironment } from '@record-review/server-config/gemini-development';
import { readDevelopmentIdentity } from '@record-review/server-config/development-identity';
import { Pool } from 'pg';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { isAbsolute, parse, resolve } from 'node:path';
import { migrateCaseSchema } from '@record-review/case-repository/migrations';
import type { TextSourceUnit } from '@record-review/case-repository/source-units';
import { createDevelopmentApi } from './case-api.ts';
import { readDevelopmentDatabaseConfig } from './development-database.ts';
import { createDevelopmentTextGenerator } from './gemini-client.ts';
import {
  reconcileAllOriginalReferencesForReviewer,
  recoverStaleOriginalUploads,
} from './original-upload-recovery.ts';
import { startDocumentProcessingScheduler } from './processing-scheduler.ts';
import { runNextDocumentProcessing } from './processing-worker.ts';
import { generateValidatedClaims } from './source-grounded-generation.ts';

const STALE_UPLOAD_AGE_MILLISECONDS = 15 * 60 * 1_000;
const UPLOAD_RECOVERY_LIMIT = 25;
const CLAIM_GENERATION_TASK =
  'Extract only review claims explicitly supported by the supplied synthetic Social Security case record.';

export async function startDevelopmentServer(environment: ServerEnvironment) {
  const identity = readDevelopmentIdentity(environment);
  const configuredRoot = environment.DEVELOPMENT_ORIGINAL_STORAGE_ROOT;
  let originalStorage;
  if (configuredRoot !== undefined) {
    const root = resolve(configuredRoot);
    if (!isAbsolute(configuredRoot) || root === parse(root).root)
      throw new Error('development_original_root_invalid');
    originalStorage = { root, maximumBytes: 512 * 1024 * 1024 };
  }
  const database = new Pool(readDevelopmentDatabaseConfig(environment));
  database.on('error', () => {
    process.stderr.write('development_database_connection_lost\n');
  });
  const api = originalStorage
    ? createDevelopmentApi(environment, database, originalStorage)
    : createDevelopmentApi(environment, database);
  let stopProcessing: (() => void) | undefined;
  api.addHook('onClose', async () => {
    stopProcessing?.();
    await database.end();
  });
  try {
    const client = await database.connect();
    try {
      await migrateCaseSchema(client);
    } finally {
      client.release();
    }
    if (originalStorage)
      await recoverStaleOriginalUploads({
        database,
        root: originalStorage.root,
        olderThan: new Date(Date.now() - STALE_UPLOAD_AGE_MILLISECONDS),
        limit: UPLOAD_RECOVERY_LIMIT,
      });
    if (originalStorage)
      await reconcileAllOriginalReferencesForReviewer({
        database,
        reviewerId: identity.reviewerId,
        root: originalStorage.root,
      });
    await api.listen({ host: '127.0.0.1', port: 5176 });
    if (originalStorage) {
      const generateClaims = createClaimGenerator(environment);
      stopProcessing = startDocumentProcessingScheduler({
        database,
        root: originalStorage.root,
        intervalMilliseconds: 250,
        leaseMilliseconds: 300_000,
        now: () => new Date(),
        createId: randomUUID,
        schedule: (callback, delay) => setTimeout(callback, delay),
        clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
        runNext: runNextDocumentProcessing,
        recoverStale: async () => {
          await recoverStaleOriginalUploads({
            database,
            root: originalStorage.root,
            olderThan: new Date(Date.now() - STALE_UPLOAD_AGE_MILLISECONDS),
            limit: UPLOAD_RECOVERY_LIMIT,
          });
        },
        ...(generateClaims ? { generateClaims } : {}),
      });
    }
    return api;
  } catch {
    await api.close();
    throw new Error('development_server_start_failed');
  }
}

function createClaimGenerator(environment: ServerEnvironment) {
  const generator = createDevelopmentTextGenerator(environment);
  if (generator.status !== 'configured') return undefined;
  return (caseId: string, sources: readonly TextSourceUnit[]) =>
    generateValidatedClaims(generator.generate, CLAIM_GENERATION_TASK, caseId, sources);
}
