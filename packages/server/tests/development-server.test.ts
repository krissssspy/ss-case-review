import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { migrateCaseSchema } from '@record-review/case-repository/migrations';
import { createDevelopmentApi } from '../src/case-api.ts';
import { readDevelopmentDatabaseConfig } from '../src/development-database.ts';
import {
  reconcileAllOriginalReferencesForReviewer,
  recoverStaleOriginalUploads,
} from '../src/original-upload-recovery.ts';
import { startDevelopmentServer } from '../src/development-server.ts';
import { startDocumentProcessingScheduler } from '../src/processing-scheduler.ts';

vi.mock('pg', () => ({ Pool: vi.fn() }));
vi.mock('@record-review/case-repository/migrations', () => ({ migrateCaseSchema: vi.fn() }));
vi.mock('../src/case-api.ts', () => ({ createDevelopmentApi: vi.fn() }));
vi.mock('../src/original-upload-recovery.ts', () => ({
  reconcileAllOriginalReferencesForReviewer: vi.fn(),
  recoverStaleOriginalUploads: vi.fn(),
}));
vi.mock('../src/processing-scheduler.ts', () => ({ startDocumentProcessingScheduler: vi.fn() }));

test('handles an idle database error with a fixed diagnostic instead of exposing details', async () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    await startDevelopmentServer(environment);
    expect(database.emit('error', new Error('synthetic private driver details'))).toBe(true);
    expect(stderr).toHaveBeenCalledExactlyOnceWith('development_database_connection_lost\n');
    expect(database.end).not.toHaveBeenCalled();
  } finally {
    stderr.mockRestore();
  }
});

test('closes the pool after the requested loopback listener cannot start', async () => {
  vi.mocked(api.listen).mockImplementation(async () => {
    throw new Error('synthetic private listener details');
  });
  await expect(startDevelopmentServer(environment)).rejects.toThrow(
    'development_server_start_failed',
  );
  expect(migrateCaseSchema).toHaveBeenCalledExactlyOnceWith(client);
  expect(client.release).toHaveBeenCalledExactlyOnceWith();
  expect(database.end).toHaveBeenCalledExactlyOnceWith();
});

test('closes the pool without migrating or listening after a connection failure', async () => {
  database.connect.mockRejectedValue(new Error('synthetic private connection details'));
  await expect(startDevelopmentServer(environment)).rejects.toThrow(
    'development_server_start_failed',
  );
  expect(database.end).toHaveBeenCalledExactlyOnceWith();
  expect(migrateCaseSchema).not.toHaveBeenCalled();
  expect(client.release).not.toHaveBeenCalled();
  expect(api.listen).not.toHaveBeenCalled();
});

test('releases migration resources and refuses to listen after a schema failure', async () => {
  vi.mocked(migrateCaseSchema).mockRejectedValue(new Error('synthetic private schema details'));
  await expect(startDevelopmentServer(environment)).rejects.toThrow(
    'development_server_start_failed',
  );
  expect(client.release).toHaveBeenCalledExactlyOnceWith();
  expect(database.end).toHaveBeenCalledExactlyOnceWith();
  expect(api.listen).not.toHaveBeenCalled();
});

test('rejects nondevelopment identity before constructing database resources', async () => {
  await expect(startDevelopmentServer({ ...environment, APP_ENV: 'production' })).rejects.toThrow(
    'development_identity_disabled',
  );
  expect(Pool).not.toHaveBeenCalled();
  expect(createDevelopmentApi).not.toHaveBeenCalled();
  expect(api.listen).not.toHaveBeenCalled();
});

const environment = {
  APP_ENV: 'development',
  DATA_CLASSIFICATION: 'synthetic',
  AUTH_MODE: 'development',
  BIND_ADDRESS: '127.0.0.1',
  DEVELOPMENT_DATABASE_PASSWORD: 'synthetic-only',
};
const client = { release: vi.fn() };
const database = Object.assign(new EventEmitter(), {
  connect: vi.fn(),
  end: vi.fn(),
});
const stopProcessing = vi.fn();
let api: ReturnType<typeof createDevelopmentApi>;

beforeEach(() => {
  vi.resetAllMocks();
  database.removeAllListeners();
  database.connect.mockResolvedValue(client);
  database.end.mockResolvedValue(undefined);
  vi.mocked(Pool).mockImplementation(function () {
    return database as unknown as Pool;
  });
  api = Fastify();
  vi.spyOn(api, 'listen').mockImplementation(async () => 'http://127.0.0.1:5176');
  vi.mocked(createDevelopmentApi).mockReturnValue(api);
  vi.mocked(migrateCaseSchema).mockResolvedValue([]);
  vi.mocked(recoverStaleOriginalUploads).mockResolvedValue(0);
  vi.mocked(reconcileAllOriginalReferencesForReviewer).mockResolvedValue({
    checked: 0,
    missing: 0,
    integrityFailures: 0,
  });
  vi.mocked(startDocumentProcessingScheduler).mockReturnValue(stopProcessing);
});

afterEach(async () => {
  await api.close();
});

test('migrates before listening and closes the pool with the development API', async () => {
  const events: string[] = [];
  database.connect.mockImplementation(async () => {
    events.push('connect');
    return client;
  });
  vi.mocked(migrateCaseSchema).mockImplementation(async () => {
    events.push('migrate');
    return [];
  });
  client.release.mockImplementation(() => events.push('release'));
  vi.mocked(api.listen).mockImplementation(async () => {
    events.push('listen');
    return 'http://127.0.0.1:5176';
  });
  const started = await startDevelopmentServer(environment);
  expect(started === api).toBe(true);
  expect(Pool).toHaveBeenCalledExactlyOnceWith(readDevelopmentDatabaseConfig(environment));
  expect(createDevelopmentApi).toHaveBeenCalledExactlyOnceWith(environment, database);
  expect(startDocumentProcessingScheduler).not.toHaveBeenCalled();
  expect(migrateCaseSchema).toHaveBeenCalledExactlyOnceWith(client);
  expect(api.listen).toHaveBeenCalledExactlyOnceWith({ host: '127.0.0.1', port: 5176 });
  expect(events).toEqual(['connect', 'migrate', 'release', 'listen']);
  expect(database.end).not.toHaveBeenCalled();
  await api.close();
  expect(database.end).toHaveBeenCalledExactlyOnceWith();
});

test('enables bounded synthetic original storage only for an explicit absolute root', async () => {
  const root = join(tmpdir(), 'record-review-synthetic-originals');
  const configured = { ...environment, DEVELOPMENT_ORIGINAL_STORAGE_ROOT: root };
  await startDevelopmentServer(configured);
  expect(createDevelopmentApi).toHaveBeenCalledExactlyOnceWith(configured, database, {
    root,
    maximumBytes: 512 * 1024 * 1024,
  });
  expect(api.listen).toHaveBeenCalledExactlyOnceWith({ host: '127.0.0.1', port: 5176 });
  expect(startDocumentProcessingScheduler).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      database,
      root,
      intervalMilliseconds: 250,
      leaseMilliseconds: 300_000,
    }),
  );
  const scheduler = vi.mocked(startDocumentProcessingScheduler).mock.calls[0]?.[0];
  if (!scheduler) throw new Error('Expected scheduler configuration');
  expect(scheduler.recoverStale).toEqual(expect.any(Function));
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-04T18:00:00Z'));
    await scheduler.recoverStale?.();
    expect(recoverStaleOriginalUploads).toHaveBeenNthCalledWith(2, {
      database,
      root,
      olderThan: new Date('2026-10-04T17:45:00Z'),
      limit: 25,
    });
  } finally {
    vi.useRealTimers();
  }
  expect(scheduler.now()).toBeInstanceOf(Date);
  expect(scheduler.createId()).toMatch(/^[a-f0-9-]{36}$/);
  vi.useFakeTimers();
  try {
    const callback = vi.fn(async () => undefined);
    const timer = scheduler.schedule(callback, 5);
    expect(timer).toBeDefined();
    scheduler.clear(timer);
    await vi.advanceTimersByTimeAsync(5);
    expect(callback).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
  expect(stopProcessing).not.toHaveBeenCalled();
  await api.close();
  expect(stopProcessing).toHaveBeenCalledExactlyOnceWith();
  expect(database.end).toHaveBeenCalledExactlyOnceWith();
  vi.mocked(createDevelopmentApi).mockClear();
  vi.mocked(api.listen).mockClear();
  await expect(
    startDevelopmentServer({ ...environment, DEVELOPMENT_ORIGINAL_STORAGE_ROOT: 'relative-root' }),
  ).rejects.toThrow('development_original_root_invalid');
  expect(createDevelopmentApi).not.toHaveBeenCalled();
  expect(api.listen).not.toHaveBeenCalled();
  await expect(
    startDevelopmentServer({ ...environment, DEVELOPMENT_ORIGINAL_STORAGE_ROOT: '/' }),
  ).rejects.toThrow('development_original_root_invalid');
  expect(createDevelopmentApi).not.toHaveBeenCalled();
});

test('wires the configured Gemini generator into original processing', async () => {
  const root = join(tmpdir(), 'record-review-synthetic-originals');
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '[]' }] } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  await startDevelopmentServer({
    ...environment,
    DEVELOPMENT_ORIGINAL_STORAGE_ROOT: root,
    MODEL_PROVIDER: 'gemini',
    GEMINI_TRANSPORT: 'developer-api',
    GEMINI_MODEL_ID: 'gemini-2.5-flash',
    GEMINI_API_KEY: 'synthetic-key',
  });

  const scheduler = vi.mocked(startDocumentProcessingScheduler).mock.calls[0]?.[0];
  expect(scheduler?.generateClaims).toEqual(expect.any(Function));
  await expect(scheduler?.generateClaims?.('synthetic-case', [])).resolves.toEqual({
    status: 'validated',
    claims: [],
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

test('wires the configured local generator into original processing', async () => {
  const root = join(tmpdir(), 'record-review-synthetic-local-originals');
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  await startDevelopmentServer({
    ...environment,
    DEVELOPMENT_ORIGINAL_STORAGE_ROOT: root,
    MODEL_PROVIDER: 'local',
    LOCAL_MODEL_ENDPOINT: 'http://127.0.0.1:8080/v1/chat/completions',
    LOCAL_MODEL_ID: 'record-review-local',
  });

  const scheduler = vi.mocked(startDocumentProcessingScheduler).mock.calls[0]?.[0];
  expect(scheduler?.generateClaims).toEqual(expect.any(Function));
  await expect(scheduler?.generateClaims?.('synthetic-case', [])).resolves.toEqual({
    status: 'validated',
    claims: [],
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

test('leaves claim generation disabled when Gemini is not configured', async () => {
  const root = join(tmpdir(), 'record-review-synthetic-originals');
  await startDevelopmentServer({ ...environment, DEVELOPMENT_ORIGINAL_STORAGE_ROOT: root });
  const scheduler = vi.mocked(startDocumentProcessingScheduler).mock.calls[0]?.[0];
  expect(scheduler?.generateClaims).toBeUndefined();
});

test('recovers stale synthetic uploads before accepting new requests', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-04T18:00:00Z'));
    const events: string[] = [];
    const root = join(tmpdir(), 'record-review-synthetic-originals');
    vi.mocked(migrateCaseSchema).mockImplementation(async () => {
      events.push('migrate');
      return [];
    });
    vi.mocked(recoverStaleOriginalUploads).mockImplementation(async () => {
      events.push('recover');
      return 2;
    });
    vi.mocked(api.listen).mockImplementation(async () => {
      events.push('listen');
      return 'http://127.0.0.1:5176';
    });

    await startDevelopmentServer({ ...environment, DEVELOPMENT_ORIGINAL_STORAGE_ROOT: root });

    expect(recoverStaleOriginalUploads).toHaveBeenCalledExactlyOnceWith({
      database,
      root,
      olderThan: new Date('2026-10-04T17:45:00Z'),
      limit: 25,
    });
    expect(events).toEqual(['migrate', 'recover', 'listen']);
  } finally {
    vi.useRealTimers();
  }
});

test('reconciles every registered original before accepting new requests', async () => {
  const root = join(tmpdir(), 'record-review-synthetic-originals');

  await startDevelopmentServer({ ...environment, DEVELOPMENT_ORIGINAL_STORAGE_ROOT: root });

  expect(reconcileAllOriginalReferencesForReviewer).toHaveBeenCalledExactlyOnceWith({
    database,
    reviewerId: '00000000-0000-4000-8000-000000000011',
    root,
  });
});
