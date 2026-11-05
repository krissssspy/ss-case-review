import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  createCase,
  findOriginalReference,
  registerOriginalReference,
} from '@record-review/case-repository/cases';
import { findDocumentProcessingForReviewer } from '@record-review/case-repository/document-processing-attempts';
import * as originalStorage from '@record-review/record-storage/originals';
import {
  findTextSourceForReviewer,
  insertTextSourceForReviewer,
} from '@record-review/case-repository/source-units';
import { reserveOriginalUpload } from '@record-review/case-repository/upload-attempts';
import {
  findOriginalDocumentMetadata,
  registerOriginalDocumentMetadata,
} from '@record-review/case-repository/original-document-metadata';
import { readOriginal, writeOriginalStream } from '@record-review/record-storage/originals';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { createDevelopmentApi } from '../src/case-api.ts';
import { requestHeaders } from './fixtures.ts';

const environment = {
  APP_ENV: 'development',
  DATA_CLASSIFICATION: 'synthetic',
  AUTH_MODE: 'development',
  BIND_ADDRESS: '127.0.0.1',
};
const reviewerId = '00000000-0000-4000-8000-000000000011';
const otherReviewerId = '00000000-0000-4000-8000-000000000012';
let database: PGlite;
let api: ReturnType<typeof createDevelopmentApi>;

beforeAll(async () => {
  database = await PGlite.create();
});
beforeEach(async () => {
  await database.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await database.exec(
    await readFile(
      new URL(
        '../../case-repository/migrations/202609230001_initial_case_metadata.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  await database.exec(
    await readFile(
      new URL(
        '../../case-repository/migrations/202609230002_original_upload_attempts.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  await database.exec(
    (
      await readFile(
        new URL(
          '../../case-repository/migrations/202611010001_original_document_metadata.sql',
          import.meta.url,
        ),
        'utf8',
      )
    ).replace(/-- Down Migration[\s\S]*$/, ''),
  );
  await database.exec(
    (
      await readFile(
        new URL(
          '../../case-repository/migrations/202610270001_case_revision_events.sql',
          import.meta.url,
        ),
        'utf8',
      )
    ).replace(/-- Down Migration[\s\S]*$/, ''),
  );
  const processingMigration = await readFile(
    new URL(
      '../../case-repository/migrations/202610010001_document_processing_attempts.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await database.exec(processingMigration.replace(/-- Down Migration[\s\S]*$/, ''));
  await database.exec(
    (
      await readFile(
        new URL(
          '../../case-repository/migrations/202610150001_processing_claims.sql',
          import.meta.url,
        ),
        'utf8',
      )
    ).replace(/-- Down Migration[\s\S]*$/, ''),
  );
  await database.exec(
    (
      await readFile(
        new URL(
          '../../case-repository/migrations/202610200001_correction_suggestions.sql',
          import.meta.url,
        ),
        'utf8',
      )
    ).replace(/-- Down Migration[\s\S]*$/, ''),
  );
  api = createDevelopmentApi(environment, database);
});
afterEach(async () => {
  await api.close();
});
afterAll(async () => {
  await database.close();
});

test('creates and lists revision-scoped correction suggestions for a case member', async () => {
  const caseId = '00000000-0000-4000-8000-000000000001';
  await createCase(database, { caseId, reviewerId, label: 'Correction route case' });
  const body = {
    artifact: 'medical',
    entryKey: '2024-01-12|North Clinic|follow-up',
    proposedText: 'The provider recorded an improved range of motion.',
    rationale: 'The source page uses the phrase improved range of motion.',
  };

  const created = await api.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/correction-suggestions`,
    headers: { ...requestHeaders, 'content-type': 'application/json' },
    payload: body,
  });
  expect(created.statusCode).toBe(201);
  expect(created.json()).toMatchObject({
    suggestion: {
      caseId,
      recordRevision: 1,
      artifact: body.artifact,
      entryKey: body.entryKey,
      proposedText: body.proposedText,
      rationale: body.rationale,
      status: 'pending',
    },
  });

  const listed = await api.inject({
    method: 'GET',
    url: `/api/v1/cases/${caseId}/correction-suggestions`,
    headers: requestHeaders,
  });
  expect(listed.statusCode).toBe(200);
  expect(listed.json()).toEqual({ suggestions: [created.json().suggestion] });

  const invalid = await api.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/correction-suggestions`,
    headers: { ...requestHeaders, 'content-type': 'application/json' },
    payload: { ...body, artifact: 'unknown' },
  });
  expect(invalid.statusCode).toBe(400);

  const extra = await api.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/correction-suggestions`,
    headers: { ...requestHeaders, 'content-type': 'application/json' },
    payload: { ...body, unexpected: true },
  });
  expect(extra.statusCode).toBe(400);

  const hiddenCaseId = '00000000-0000-4000-8000-000000000002';
  const hiddenPost = await api.inject({
    method: 'POST',
    url: `/api/v1/cases/${hiddenCaseId}/correction-suggestions`,
    headers: { ...requestHeaders, 'content-type': 'application/json' },
    payload: body,
  });
  expect(hiddenPost.statusCode).toBe(404);
  const hiddenGet = await api.inject({
    method: 'GET',
    url: `/api/v1/cases/${hiddenCaseId}/correction-suggestions`,
    headers: requestHeaders,
  });
  expect(hiddenGet.statusCode).toBe(404);
  expect(hiddenGet.json()).toEqual({ code: 'case_not_found' });
  expect(hiddenPost.json()).toEqual({ code: 'case_not_found' });

  for (const artifact of ['summary', 'procedural', 'five_step']) {
    const accepted = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/correction-suggestions`,
      headers: { ...requestHeaders, 'content-type': 'application/json' },
      payload: { ...body, artifact, entryKey: `${artifact}-entry` },
    });
    expect(accepted.statusCode).toBe(201);
  }

  for (const field of ['artifact', 'entryKey', 'proposedText', 'rationale']) {
    const missing = Object.fromEntries(Object.entries(body).filter(([key]) => key !== field));
    const response = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/correction-suggestions`,
      headers: { ...requestHeaders, 'content-type': 'application/json' },
      payload: missing,
    });
    expect(response.statusCode).toBe(400);
  }

  for (const field of ['entryKey', 'proposedText', 'rationale']) {
    const whitespace = { ...body, [field]: '   ' };
    const response = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/correction-suggestions`,
      headers: { ...requestHeaders, 'content-type': 'application/json' },
      payload: whitespace,
    });
    expect(response.statusCode).toBe(400);
  }

  for (const method of ['POST', 'GET'] as const) {
    const response = await api.inject({
      method,
      url: `/api/v1/cases/not-a-uuid/correction-suggestions`,
      headers:
        method === 'POST'
          ? { ...requestHeaders, 'content-type': 'application/json' }
          : requestHeaders,
      ...(method === 'POST' ? { payload: body } : {}),
    });
    expect(response.statusCode).toBe(400);
  }
});

test('lists current text source metadata through a guarded member-scoped route', async () => {
  const migration = await readFile(
    new URL('../../case-repository/migrations/202609280001_text_source_units.sql', import.meta.url),
    'utf8',
  );
  await database.exec(migration.replace(/-- Down Migration[\s\S]*$/, ''));
  await database.exec(
    (
      await readFile(
        new URL(
          '../../case-repository/migrations/202610190001_text_source_geometry.sql',
          import.meta.url,
        ),
        'utf8',
      )
    ).replace(/-- Down Migration[\s\S]*$/, ''),
  );
  const source = {
    sourceUnitId: '00000000-0000-4000-8000-000000000031',
    caseId: '00000000-0000-4000-8000-000000000001',
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    recordRevision: 1,
    documentSha256: 'a'.repeat(64),
    extractionVersion: 'synthetic-native-v1',
    pageNumber: 1,
    rawText: 'Synthetic source text excluded from inventory',
    geometry: { view: [], rotation: 0, items: [] },
  };
  await createCase(database, {
    caseId: source.caseId,
    reviewerId,
    label: 'Synthetic source inventory case',
  });
  await registerOriginalReference(database, reviewerId, {
    caseId: source.caseId,
    documentVersionId: source.documentVersionId,
    sha256: source.documentSha256,
    byteLength: 100,
  });
  await insertTextSourceForReviewer(database, reviewerId, source);

  const response = await api.inject({
    method: 'GET',
    url: `/api/v1/cases/${source.caseId}/text-sources`,
    headers: requestHeaders,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    sources: [
      {
        sourceUnitId: source.sourceUnitId,
        caseId: source.caseId,
        documentVersionId: source.documentVersionId,
        recordRevision: source.recordRevision,
        documentSha256: source.documentSha256,
        extractionVersion: source.extractionVersion,
        pageNumber: source.pageNumber,
        geometry: source.geometry,
      },
    ],
  });
  expect(response.headers['cache-control']).toBe('no-store');

  const emptyCaseId = '00000000-0000-4000-8000-000000000003';
  await createCase(database, {
    caseId: emptyCaseId,
    reviewerId,
    label: 'Synthetic empty source case',
  });
  const empty = await api.inject({
    method: 'GET',
    url: `/api/v1/cases/${emptyCaseId}/text-sources`,
    headers: requestHeaders,
  });
  expect(empty.statusCode).toBe(200);
  expect(empty.json()).toEqual({ sources: [] });

  const hiddenCaseId = '00000000-0000-4000-8000-000000000004';
  await createCase(database, {
    caseId: hiddenCaseId,
    reviewerId: otherReviewerId,
    label: 'Synthetic hidden source case',
  });
  const hidden = await api.inject({
    method: 'GET',
    url: `/api/v1/cases/${hiddenCaseId}/text-sources`,
    headers: requestHeaders,
  });
  expect(hidden.statusCode).toBe(404);
  expect(hidden.json()).toEqual({ code: 'case_not_found' });

  const query = vi.spyOn(database, 'query');
  try {
    const invalid = await api.inject({
      method: 'GET',
      url: '/api/v1/cases/invalid/text-sources',
      headers: requestHeaders,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ code: 'invalid_request' });
    expect(query).not.toHaveBeenCalled();
    query.mockRejectedValueOnce(new Error('Synthetic private inventory diagnostic'));
    const unavailable = await api.inject({
      method: 'GET',
      url: `/api/v1/cases/${source.caseId}/text-sources`,
      headers: requestHeaders,
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({ code: 'case_service_unavailable' });
  } finally {
    query.mockRestore();
  }
});

test('opens stored page text through a guarded member-scoped source route', async () => {
  const migration = await readFile(
    new URL('../../case-repository/migrations/202609280001_text_source_units.sql', import.meta.url),
    'utf8',
  );
  await database.exec(migration.replace(/-- Down Migration[\s\S]*$/, ''));
  await database.exec(
    (
      await readFile(
        new URL(
          '../../case-repository/migrations/202610190001_text_source_geometry.sql',
          import.meta.url,
        ),
        'utf8',
      )
    ).replace(/-- Down Migration[\s\S]*$/, ''),
  );
  const source = {
    sourceUnitId: '00000000-0000-4000-8000-000000000031',
    caseId: '00000000-0000-4000-8000-000000000001',
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    recordRevision: 1,
    documentSha256: 'a'.repeat(64),
    extractionVersion: 'synthetic-native-v1',
    pageNumber: 1,
    rawText: 'Synthetic source A😀B\nLiteral quotation',
    geometry: { view: [], rotation: 0, items: [] },
  };
  await createCase(database, {
    caseId: source.caseId,
    reviewerId,
    label: 'Synthetic source API case',
  });
  await registerOriginalReference(database, reviewerId, {
    caseId: source.caseId,
    documentVersionId: source.documentVersionId,
    sha256: source.documentSha256,
    byteLength: 100,
  });
  await insertTextSourceForReviewer(database, reviewerId, source);
  const url = `/api/v1/cases/${source.caseId}/text-sources/${source.sourceUnitId}`;
  const response = await api.inject({ method: 'GET', url, headers: requestHeaders });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ source });
  expect(response.headers['cache-control']).toBe('no-store');
  const absent = await api.inject({
    method: 'GET',
    url: `/api/v1/cases/${source.caseId}/text-sources/00000000-0000-4000-8000-000000000032`,
    headers: requestHeaders,
  });
  expect(absent.statusCode).toBe(404);
  expect(absent.json()).toEqual({ code: 'source_not_found' });
  const query = vi.spyOn(database, 'query');
  try {
    for (const invalidUrl of [
      `/api/v1/cases/invalid/text-sources/${source.sourceUnitId}`,
      `/api/v1/cases/${source.caseId}/text-sources/invalid`,
    ]) {
      const invalid = await api.inject({ method: 'GET', url: invalidUrl, headers: requestHeaders });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toEqual({ code: 'invalid_request' });
    }
    expect(query).not.toHaveBeenCalled();
    query.mockRejectedValueOnce(new Error('Synthetic private source diagnostic'));
    const unavailable = await api.inject({ method: 'GET', url, headers: requestHeaders });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({ code: 'case_service_unavailable' });
  } finally {
    query.mockRestore();
  }
});

test('verifies a citation quote against the authorized persisted source', async () => {
  const migration = await readFile(
    new URL('../../case-repository/migrations/202609280001_text_source_units.sql', import.meta.url),
    'utf8',
  );
  await database.exec(migration.replace(/-- Down Migration[\s\S]*$/, ''));
  await database.exec(
    (
      await readFile(
        new URL(
          '../../case-repository/migrations/202610190001_text_source_geometry.sql',
          import.meta.url,
        ),
        'utf8',
      )
    ).replace(/-- Down Migration[\s\S]*$/, ''),
  );
  const source = {
    sourceUnitId: '00000000-0000-4000-8000-000000000041',
    caseId: '00000000-0000-4000-8000-000000000001',
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    recordRevision: 1,
    documentSha256: 'a'.repeat(64),
    extractionVersion: 'synthetic-native-v1',
    pageNumber: 1,
    rawText: 'The claimant cannot return to past work.',
    geometry: { view: [], rotation: 0, items: [] },
  };
  await createCase(database, { caseId: source.caseId, reviewerId, label: 'Citation case' });
  await registerOriginalReference(database, reviewerId, {
    caseId: source.caseId,
    documentVersionId: source.documentVersionId,
    sha256: source.documentSha256,
    byteLength: 100,
  });
  await insertTextSourceForReviewer(database, reviewerId, source);
  const url = `/api/v1/cases/${source.caseId}/text-sources/${source.sourceUnitId}/spans`;
  const quote = 'cannot return to past work';
  const located = await api.inject({
    method: 'POST',
    url,
    headers: { ...requestHeaders, 'content-type': 'application/json' },
    payload: {
      recordRevision: source.recordRevision,
      documentVersionId: source.documentVersionId,
      documentSha256: source.documentSha256,
      extractionVersion: source.extractionVersion,
      sourceUnitId: source.sourceUnitId,
      start: source.rawText.indexOf(quote),
      end: source.rawText.indexOf(quote) + quote.length,
      quote,
    },
  });
  expect(located.statusCode).toBe(200);
  expect(located.json()).toEqual({
    span: {
      caseId: source.caseId,
      recordRevision: source.recordRevision,
      documentVersionId: source.documentVersionId,
      documentSha256: source.documentSha256,
      extractionVersion: source.extractionVersion,
      sourceUnitId: source.sourceUnitId,
      start: source.rawText.indexOf(quote),
      end: source.rawText.indexOf(quote) + quote.length,
      quote,
    },
  });
  const validPayload = {
    recordRevision: source.recordRevision,
    documentVersionId: source.documentVersionId,
    documentSha256: source.documentSha256,
    extractionVersion: source.extractionVersion,
    sourceUnitId: source.sourceUnitId,
    start: source.rawText.indexOf(quote),
    end: source.rawText.indexOf(quote) + quote.length,
    quote,
  };
  const invalidPayloads = [
    ...Object.keys(validPayload).map((key) => {
      return Object.fromEntries(
        Object.entries(validPayload).filter(([field]) => field !== key),
      ) as Record<string, unknown>;
    }),
    { ...validPayload, recordRevision: 0 },
    { ...validPayload, documentVersionId: 'not-a-uuid' },
    { ...validPayload, documentSha256: 'bad-hash' },
    { ...validPayload, extractionVersion: '' },
    { ...validPayload, extractionVersion: ' '.repeat(128) },
    { ...validPayload, sourceUnitId: 'not-a-uuid' },
    { ...validPayload, start: -1 },
    { ...validPayload, end: 0 },
    { ...validPayload, quote: '' },
    { ...validPayload, extra: true },
  ];
  for (const payload of invalidPayloads) {
    const invalid = await api.inject({
      method: 'POST',
      url,
      headers: { ...requestHeaders, 'content-type': 'application/json' },
      payload,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ code: 'invalid_request' });
  }
  const invalidParams = await api.inject({
    method: 'POST',
    url: `/api/v1/cases/not-a-uuid/text-sources/${source.sourceUnitId}/spans`,
    headers: { ...requestHeaders, 'content-type': 'application/json' },
    payload: validPayload,
  });
  expect(invalidParams.statusCode).toBe(400);
  expect(invalidParams.json()).toEqual({ code: 'invalid_request' });
  const invalidSourceParams = await api.inject({
    method: 'POST',
    url: `/api/v1/cases/${source.caseId}/text-sources/not-a-uuid/spans`,
    headers: { ...requestHeaders, 'content-type': 'application/json' },
    payload: validPayload,
  });
  expect(invalidSourceParams.statusCode).toBe(400);
  expect(invalidSourceParams.json()).toEqual({ code: 'invalid_request' });
  const mismatch = await api.inject({
    method: 'POST',
    url,
    headers: { ...requestHeaders, 'content-type': 'application/json' },
    payload: {
      recordRevision: source.recordRevision,
      documentVersionId: source.documentVersionId,
      documentSha256: source.documentSha256,
      extractionVersion: source.extractionVersion,
      sourceUnitId: source.sourceUnitId,
      start: 0,
      end: 4,
      quote: 'Wrong',
    },
  });
  expect(mismatch.statusCode).toBe(422);
  expect(mismatch.json()).toEqual({ code: 'source_span_not_located', reason: 'quote_mismatch' });
  const bodyMismatch = await api.inject({
    method: 'POST',
    url,
    headers: { ...requestHeaders, 'content-type': 'application/json' },
    payload: {
      recordRevision: source.recordRevision,
      documentVersionId: source.documentVersionId,
      documentSha256: source.documentSha256,
      extractionVersion: source.extractionVersion,
      sourceUnitId: '00000000-0000-4000-8000-000000000042',
      start: 0,
      end: 4,
      quote: 'The ',
    },
  });
  expect(bodyMismatch.statusCode).toBe(422);
  expect(bodyMismatch.json()).toEqual({
    code: 'source_span_not_located',
    reason: 'source_mismatch',
  });
  const pathBodyMismatch = await api.inject({
    method: 'POST',
    url: `/api/v1/cases/${source.caseId}/text-sources/00000000-0000-4000-8000-000000000042/spans`,
    headers: { ...requestHeaders, 'content-type': 'application/json' },
    payload: validPayload,
  });
  expect(pathBodyMismatch.statusCode).toBe(422);
  expect(pathBodyMismatch.json()).toEqual({
    code: 'source_span_not_located',
    reason: 'source_mismatch',
  });
  const missing = await api.inject({
    method: 'POST',
    url: `/api/v1/cases/${source.caseId}/text-sources/00000000-0000-4000-8000-000000000042/spans`,
    headers: { ...requestHeaders, 'content-type': 'application/json' },
    payload: {
      recordRevision: source.recordRevision,
      documentVersionId: source.documentVersionId,
      documentSha256: source.documentSha256,
      extractionVersion: source.extractionVersion,
      sourceUnitId: '00000000-0000-4000-8000-000000000042',
      start: 0,
      end: 4,
      quote: 'The ',
    },
  });
  expect(missing.statusCode).toBe(422);
  expect(missing.json()).toEqual({ code: 'source_span_not_located', reason: 'source_unavailable' });
});

test('hides another reviewer text source through the guarded source route', async () => {
  const migration = await readFile(
    new URL('../../case-repository/migrations/202609280001_text_source_units.sql', import.meta.url),
    'utf8',
  );
  await database.exec(migration.replace(/-- Down Migration[\s\S]*$/, ''));
  await database.exec(
    (
      await readFile(
        new URL(
          '../../case-repository/migrations/202610190001_text_source_geometry.sql',
          import.meta.url,
        ),
        'utf8',
      )
    ).replace(/-- Down Migration[\s\S]*$/, ''),
  );
  const source = {
    sourceUnitId: '00000000-0000-4000-8000-000000000031',
    caseId: '00000000-0000-4000-8000-000000000002',
    documentVersionId: '00000000-0000-4000-8000-000000000022',
    recordRevision: 1,
    documentSha256: 'b'.repeat(64),
    extractionVersion: 'synthetic-native-v1',
    pageNumber: 1,
    rawText: 'Synthetic private source text',
    geometry: { view: [], rotation: 0, items: [] },
  };
  await createCase(database, {
    caseId: source.caseId,
    reviewerId: otherReviewerId,
    label: 'Synthetic private source API case',
  });
  await registerOriginalReference(database, otherReviewerId, {
    caseId: source.caseId,
    documentVersionId: source.documentVersionId,
    sha256: source.documentSha256,
    byteLength: 100,
  });
  await insertTextSourceForReviewer(database, otherReviewerId, source);
  expect(
    await findTextSourceForReviewer(database, otherReviewerId, source.caseId, source.sourceUnitId),
  ).toEqual(source);

  const response = await api.inject({
    method: 'GET',
    url: `/api/v1/cases/${source.caseId}/text-sources/${source.sourceUnitId}`,
    headers: requestHeaders,
  });
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ code: 'source_not_found' });
  expect(response.headers['cache-control']).toBe('no-store');
});

test('lists only server-selected reviewer cases despite request identity claims', async () => {
  const visible = {
    caseId: '00000000-0000-4000-8000-000000000001',
    label: 'Synthetic visible case',
    reviewerId,
  };
  await createCase(database, visible);
  await createCase(database, {
    caseId: '00000000-0000-4000-8000-000000000002',
    label: 'Synthetic other reviewer case',
    reviewerId: otherReviewerId,
  });
  const response = await api.inject({
    method: 'GET',
    url: `/api/v1/cases?reviewerId=${otherReviewerId}`,
    headers: { ...requestHeaders, 'x-reviewer-id': otherReviewerId },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    cases: [{ caseId: visible.caseId, label: visible.label, recordRevision: 1 }],
  });
});

test('reports synthetic upload availability without disclosing storage configuration', async () => {
  const disabled = await api.inject({ url: '/api/v1/capabilities', headers: requestHeaders });
  expect(disabled.statusCode).toBe(200);
  expect(disabled.json()).toEqual({ syntheticOriginalUpload: false });
  await api.close();
  api = createDevelopmentApi(environment, database, {
    root: '/synthetic-private-root',
    maximumBytes: 3,
  });
  const enabled = await api.inject({ url: '/api/v1/capabilities', headers: requestHeaders });
  expect(enabled.statusCode).toBe(200);
  expect(enabled.json()).toEqual({ syntheticOriginalUpload: true });
  expect(enabled.body).not.toContain('synthetic-private-root');
});

test('opens only a case assigned to the configured development reviewer', async () => {
  const visibleId = '00000000-0000-4000-8000-000000000001';
  const hiddenId = '00000000-0000-4000-8000-000000000002';
  await createCase(database, { caseId: visibleId, label: 'Synthetic visible case', reviewerId });
  await createCase(database, {
    caseId: hiddenId,
    label: 'Synthetic hidden case',
    reviewerId: otherReviewerId,
  });
  const visible = await api.inject({ url: `/api/v1/cases/${visibleId}`, headers: requestHeaders });
  expect(visible.statusCode).toBe(200);
  expect(visible.json()).toEqual({
    case: { caseId: visibleId, label: 'Synthetic visible case', recordRevision: 1 },
  });
  const hidden = await api.inject({ url: `/api/v1/cases/${hiddenId}`, headers: requestHeaders });
  expect(hidden.statusCode).toBe(404);
  expect(hidden.json()).toEqual({ code: 'case_not_found' });
  const malformed = await api.inject({ url: '/api/v1/cases/not-a-uuid', headers: requestHeaders });
  expect(malformed.statusCode).toBe(400);
  expect(malformed.json()).toEqual({ code: 'invalid_request' });
});

test('returns the complete member case payload from the case detail route', async () => {
  const caseId = '00000000-0000-4000-8000-000000000041';
  await createCase(database, { caseId, reviewerId, label: 'Detail route assertion' });

  const response = await api.inject({
    method: 'GET',
    url: `/api/v1/cases/${caseId}`,
    headers: requestHeaders,
  });

  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('application/json');
  expect(response.json()).toEqual({
    case: { caseId, label: 'Detail route assertion', recordRevision: 1 },
  });
});

test('lists revision history only for a member case', async () => {
  const caseId = '00000000-0000-4000-8000-000000000042';
  const documentVersionId = '00000000-0000-4000-8000-000000000043';
  await createCase(database, { caseId, reviewerId, label: 'Revision history route case' });
  await database.query(
    `INSERT INTO case_revision_events
      (case_id, record_revision, event_type, document_version_id)
    VALUES ($1, 2, 'original_registered', $2)`,
    [caseId, documentVersionId],
  );

  const response = await api.inject({
    method: 'GET',
    url: `/api/v1/cases/${caseId}/revision-history`,
    headers: requestHeaders,
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    revisions: [
      {
        recordRevision: 2,
        eventType: 'original_registered',
        documentVersionId,
      },
    ],
  });
});

test('lists upload attempts only for a member case', async () => {
  const caseId = '00000000-0000-4000-8000-000000000044';
  const documentVersionId = '00000000-0000-4000-8000-000000000045';
  await createCase(database, { caseId, reviewerId, label: 'Upload attempt route case' });
  await reserveOriginalUpload(database, {
    caseId,
    documentVersionId,
    reviewerId,
    maximumBytes: 16,
  });

  const response = await api.inject({
    method: 'GET',
    url: `/api/v1/cases/${caseId}/upload-attempts`,
    headers: requestHeaders,
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    attempts: [
      {
        documentVersionId,
        state: 'receiving',
        maximumBytes: 16,
      },
    ],
  });
});

test('updates a pending correction suggestion through the guarded reviewer route', async () => {
  const caseId = '00000000-0000-4000-8000-000000000051';
  await createCase(database, { caseId, reviewerId, label: 'Correction status route case' });
  const created = await api.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/correction-suggestions`,
    headers: { ...requestHeaders, 'content-type': 'application/json' },
    payload: {
      artifact: 'summary',
      entryKey: 'summary-entry',
      proposedText: 'Use the exact source wording.',
      rationale: 'The generated wording needs reviewer confirmation.',
    },
  });
  const correctionId = created.json().suggestion.correctionId as string;

  const accepted = await api.inject({
    method: 'PATCH',
    url: `/api/v1/cases/${caseId}/correction-suggestions/${correctionId}`,
    headers: { ...requestHeaders, 'content-type': 'application/json' },
    payload: { status: 'accepted' },
  });
  expect(accepted.statusCode).toBe(200);
  expect(accepted.json()).toMatchObject({ suggestion: { correctionId, status: 'accepted' } });

  const repeated = await api.inject({
    method: 'PATCH',
    url: `/api/v1/cases/${caseId}/correction-suggestions/${correctionId}`,
    headers: { ...requestHeaders, 'content-type': 'application/json' },
    payload: { status: 'rejected' },
  });
  expect(repeated.statusCode).toBe(404);
  expect(repeated.json()).toEqual({ code: 'correction_not_found' });
});

test('lists original metadata for a member case without exposing another case', async () => {
  const caseId = '00000000-0000-4000-8000-000000000031';
  const emptyCaseId = '00000000-0000-4000-8000-000000000032';
  const otherCaseId = '00000000-0000-4000-8000-000000000033';
  const memberOriginal = {
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000041',
    sha256: 'a'.repeat(64),
    byteLength: 12,
  };
  await createCase(database, { caseId, reviewerId, label: 'Synthetic inventory' });
  await createCase(database, { caseId: emptyCaseId, reviewerId, label: 'Empty inventory' });
  await createCase(database, {
    caseId: otherCaseId,
    reviewerId: otherReviewerId,
    label: 'Private inventory',
  });
  await registerOriginalReference(database, reviewerId, memberOriginal);
  await registerOriginalReference(database, otherReviewerId, {
    ...memberOriginal,
    caseId: otherCaseId,
    sha256: 'b'.repeat(64),
  });
  const listed = await api.inject({
    url: `/api/v1/cases/${caseId}/synthetic-originals`,
    headers: requestHeaders,
  });
  expect(listed.statusCode).toBe(200);
  expect(listed.json()).toEqual({ originals: [memberOriginal] });
  const empty = await api.inject({
    url: `/api/v1/cases/${emptyCaseId}/synthetic-originals`,
    headers: requestHeaders,
  });
  expect(empty.statusCode).toBe(200);
  expect(empty.json()).toEqual({ originals: [] });
  for (const hiddenCaseId of [otherCaseId, '00000000-0000-4000-8000-000000000099']) {
    const hidden = await api.inject({
      url: `/api/v1/cases/${hiddenCaseId}/synthetic-originals`,
      headers: requestHeaders,
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual({ code: 'case_not_found' });
  }
  const malformed = await api.inject({
    url: '/api/v1/cases/not-a-uuid/synthetic-originals',
    headers: requestHeaders,
  });
  expect(malformed.statusCode).toBe(400);
  expect(malformed.json()).toEqual({ code: 'invalid_request' });
});

test('includes uploaded filename and media type in the original inventory', async () => {
  const caseId = '00000000-0000-4000-8000-000000000034';
  const documentVersionId = '00000000-0000-4000-8000-000000000042';
  await createCase(database, { caseId, reviewerId, label: 'Named inventory' });
  await registerOriginalReference(database, reviewerId, {
    caseId,
    documentVersionId,
    sha256: 'c'.repeat(64),
    byteLength: 12,
  });
  await registerOriginalDocumentMetadata(database, reviewerId, {
    caseId,
    documentVersionId,
    fileName: '7-brief.pdf',
    mediaType: 'application/pdf',
  });

  const response = await api.inject({
    url: `/api/v1/cases/${caseId}/synthetic-originals`,
    headers: requestHeaders,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    originals: [
      {
        caseId,
        documentVersionId,
        sha256: 'c'.repeat(64),
        byteLength: 12,
        fileName: '7-brief.pdf',
        mediaType: 'application/pdf',
      },
    ],
  });
});

test('creates a synthetic draft with a server-generated identity and creator membership', async () => {
  const response = await api.inject({
    method: 'POST',
    url: '/api/v1/cases',
    payload: { label: '  Synthetic draft  ' },
    headers: { ...requestHeaders, origin: 'http://127.0.0.1:5175' },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{ case: { caseId: string; label: string; recordRevision: number } }>();
  expect(body).toEqual({
    case: {
      caseId: expect.stringMatching(
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
      ),
      label: 'Synthetic draft',
      recordRevision: 1,
    },
  });
  expect((await database.query('SELECT case_id, reviewer_id FROM case_memberships')).rows).toEqual([
    { case_id: body.case.caseId, reviewer_id: reviewerId },
  ]);
  expect((await api.inject({ url: '/api/v1/cases', headers: requestHeaders })).json()).toEqual({
    cases: [body.case],
  });
});

test('returns a safe failure when case creation rolls back in the database', async () => {
  await database.exec(
    'ALTER TABLE case_memberships ADD CONSTRAINT synthetic_private_failure CHECK (false)',
  );
  const response = await api.inject({
    method: 'POST',
    url: '/api/v1/cases',
    payload: { label: 'Synthetic rejected draft' },
    headers: requestHeaders,
  });
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({ code: 'case_service_unavailable' });
  expect((await database.query('SELECT * FROM cases')).rows).toEqual([]);
  expect((await database.query('SELECT * FROM case_memberships')).rows).toEqual([]);
});

test('accepts one synthetic original as streamed bytes for a member case', async () => {
  const root = await mkdtemp(join(tmpdir(), 'record-review-api-original-test-'));
  const caseId = '00000000-0000-4000-8000-000000000003';
  try {
    const disabled = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/synthetic-originals`,
      headers: { ...requestHeaders, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('abc'),
    });
    expect(disabled.statusCode).toBe(404);
    await api.close();
    api = createDevelopmentApi(environment, database, { root, maximumBytes: 3 });
    await createCase(database, { caseId, reviewerId, label: 'Synthetic original case' });
    const response = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/synthetic-originals`,
      headers: { ...requestHeaders, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('abc'),
    });
    expect(response.statusCode).toBe(201);
    const reference = response.json<{
      original: {
        caseId: string;
        documentVersionId: string;
        sha256: string;
        byteLength: number;
      };
    }>().original;
    expect(reference).toEqual({
      caseId,
      documentVersionId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      byteLength: 3,
    });
    expect(await readOriginal(root, caseId, reference)).toEqual(Buffer.from('abc'));
    expect(
      await findOriginalReference(database, reviewerId, caseId, reference.documentVersionId),
    ).toEqual(reference);
    expect((await database.query('SELECT state FROM original_upload_attempts')).rows).toEqual([
      { state: 'registered' },
    ]);
    await expect(
      findDocumentProcessingForReviewer(
        database,
        reviewerId,
        caseId,
        reference.documentVersionId,
        'pdfjs-native-v1',
      ),
    ).resolves.toEqual({
      caseId,
      documentVersionId: reference.documentVersionId,
      reviewerId,
      extractionVersion: 'pdfjs-native-v1',
      maximumBytes: 3,
      maximumPages: 800,
      state: 'queued',
      attemptCount: 0,
      failureCode: null,
    });
    const malformed = await api.inject({
      method: 'POST',
      url: '/api/v1/cases/not-a-uuid/synthetic-originals',
      headers: { ...requestHeaders, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('abc'),
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({ code: 'invalid_request' });
    expect(
      (await database.query('SELECT count(*)::int AS count FROM original_upload_attempts')).rows,
    ).toEqual([{ count: 1 }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stores upload filename and media metadata supplied by the guarded client', async () => {
  const root = await mkdtemp(join(tmpdir(), 'record-review-api-original-metadata-test-'));
  const caseId = '00000000-0000-4000-8000-000000000016';
  try {
    await api.close();
    api = createDevelopmentApi(environment, database, { root, maximumBytes: 3 });
    await createCase(database, { caseId, reviewerId, label: 'Named upload case' });
    const response = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/synthetic-originals`,
      headers: {
        ...requestHeaders,
        'content-type': 'application/octet-stream',
        'x-record-review-file-name': '7-brief.pdf',
        'x-record-review-media-type': 'application/pdf',
      },
      payload: Buffer.from('abc'),
    });
    expect(response.statusCode).toBe(201);
    const documentVersionId = response.json<{ original: { documentVersionId: string } }>().original
      .documentVersionId;
    await expect(
      findOriginalDocumentMetadata(database, reviewerId, caseId, documentVersionId),
    ).resolves.toEqual({
      caseId,
      documentVersionId,
      fileName: '7-brief.pdf',
      mediaType: 'application/pdf',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('returns member-scoped processing status for a registered original', async () => {
  const root = await mkdtemp(join(tmpdir(), 'record-review-api-processing-status-test-'));
  const caseId = '00000000-0000-4000-8000-000000000015';
  try {
    await api.close();
    api = createDevelopmentApi(environment, database, { root, maximumBytes: 3 });
    await createCase(database, { caseId, reviewerId, label: 'Synthetic processing status case' });
    const uploaded = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/synthetic-originals`,
      headers: { ...requestHeaders, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('abc'),
    });
    const documentVersionId = uploaded.json<{ original: { documentVersionId: string } }>().original
      .documentVersionId;
    const response = await api.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/document-processing/${documentVersionId}`,
      headers: requestHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      processing: {
        documentVersionId,
        extractionVersion: 'pdfjs-native-v1',
        state: 'queued',
        attemptCount: 0,
        failureCode: null,
      },
    });
    expect(Object.hasOwn(response.json().processing, 'claims')).toBe(false);

    await database.query(
      `UPDATE document_processing_attempts
       SET state = 'published', claims_json = $1::jsonb
       WHERE case_id = $2 AND document_version_id = $3`,
      [JSON.stringify({ status: 'validated', claims: [] }), caseId, documentVersionId],
    );
    const published = await api.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/document-processing/${documentVersionId}`,
      headers: requestHeaders,
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toEqual({
      processing: {
        documentVersionId,
        extractionVersion: 'pdfjs-native-v1',
        state: 'published',
        attemptCount: 0,
        failureCode: null,
        claims: { status: 'validated', claims: [] },
      },
    });

    const hidden = await api.inject({
      method: 'GET',
      url: `/api/v1/cases/00000000-0000-4000-8000-000000000099/document-processing/${documentVersionId}`,
      headers: requestHeaders,
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual({ code: 'processing_not_found' });

    const query = vi.spyOn(database, 'query');
    try {
      for (const url of [
        `/api/v1/cases/not-a-uuid/document-processing/${documentVersionId}`,
        `/api/v1/cases/${caseId}/document-processing/not-a-uuid`,
      ]) {
        query.mockClear();
        const malformed = await api.inject({ method: 'GET', url, headers: requestHeaders });
        expect(malformed.statusCode).toBe(400);
        expect(malformed.json()).toEqual({ code: 'invalid_request' });
        expect(query).not.toHaveBeenCalled();
      }
    } finally {
      query.mockRestore();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lists member-scoped processing records for a case', async () => {
  const root = await mkdtemp(join(tmpdir(), 'record-review-api-processing-list-test-'));
  const caseId = '00000000-0000-4000-8000-000000000016';
  try {
    await api.close();
    api = createDevelopmentApi(environment, database, { root, maximumBytes: 3 });
    await createCase(database, { caseId, reviewerId, label: 'Synthetic processing list case' });
    const documentVersionIds: string[] = [];
    for (const payload of ['abc', 'def']) {
      const uploaded = await api.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseId}/synthetic-originals`,
        headers: { ...requestHeaders, 'content-type': 'application/octet-stream' },
        payload: Buffer.from(payload),
      });
      documentVersionIds.push(
        uploaded.json<{ original: { documentVersionId: string } }>().original.documentVersionId,
      );
    }
    const response = await api.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/document-processing`,
      headers: requestHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ processing: unknown[] }>().processing).toHaveLength(2);
    expect(response.json<{ processing: Array<{ state: string }> }>().processing).toMatchObject([
      { state: 'queued' },
      { state: 'queued' },
    ]);
    await database.query(
      `UPDATE document_processing_attempts SET state = 'published', claims_json = $1::jsonb
       WHERE case_id = $2 AND document_version_id = $3`,
      [JSON.stringify({ status: 'validated', claims: [] }), caseId, documentVersionIds[0]],
    );
    const published = await api.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/document-processing`,
      headers: requestHeaders,
    });
    const publishedProcessing = published.json<{
      processing: Array<{ state: string; claims?: unknown }>;
    }>().processing;
    expect(publishedProcessing.find((item) => item.state === 'published')).toHaveProperty('claims');
    expect(publishedProcessing.find((item) => item.state === 'queued')).not.toHaveProperty(
      'claims',
    );
    const hidden = await api.inject({
      method: 'GET',
      url: '/api/v1/cases/00000000-0000-4000-8000-000000000099/document-processing',
      headers: requestHeaders,
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual({ code: 'case_not_found' });
    const query = vi.spyOn(database, 'query');
    try {
      query.mockClear();
      const malformed = await api.inject({
        method: 'GET',
        url: '/api/v1/cases/not-a-uuid/document-processing',
        headers: requestHeaders,
      });
      expect(malformed.statusCode).toBe(400);
      expect(query).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('builds member-scoped review artifacts from validated processing claims', async () => {
  const root = await mkdtemp(join(tmpdir(), 'record-review-api-artifacts-test-'));
  const caseId = '00000000-0000-4000-8000-000000000017';
  try {
    await api.close();
    api = createDevelopmentApi(environment, database, { root, maximumBytes: 3 });
    await createCase(database, { caseId, reviewerId, label: 'Synthetic artifact case' });
    const documentVersionIds: string[] = [];
    for (const payload of ['abc', 'def', 'ghi']) {
      const uploaded = await api.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseId}/synthetic-originals`,
        headers: { ...requestHeaders, 'content-type': 'application/octet-stream' },
        payload: Buffer.from(payload),
      });
      documentVersionIds.push(
        uploaded.json<{ original: { documentVersionId: string } }>().original.documentVersionId,
      );
    }
    const verified = {
      status: 'verified',
      claimId: 'claim-1',
      text: 'The ALJ found a severe impairment.',
      section: 'summary',
    };
    const unverified = {
      status: 'unverified',
      claimId: 'claim-1',
      text: 'The ALJ found a severe impairment.',
      section: 'summary',
    };
    await database.query(
      `UPDATE document_processing_attempts SET state = 'published', claims_json = $1::jsonb
       WHERE case_id = $2 AND document_version_id = $3`,
      [
        JSON.stringify({
          status: 'validated',
          claims: [
            verified,
            { status: 'verified', claimId: 'claim-2', text: 'Treatment occurred.' },
            {
              status: 'verified',
              claimId: 'claim-4',
              text: 'A medical visit occurred.',
              section: 'medical',
            },
            {
              status: 'verified',
              claimId: 'claim-5',
              text: 'The hearing occurred.',
              section: 'procedural',
            },
            { status: 'verified', claimId: 'claim-6', text: 'Malformed source is ignored.' },
            null,
          ],
        }),
        caseId,
        documentVersionIds[0],
      ],
    );
    await database.query(
      `UPDATE document_processing_attempts SET state = 'published', claims_json = $1::jsonb
       WHERE case_id = $2 AND document_version_id = $3`,
      [
        JSON.stringify({ status: 'refused', code: 'provider_error' }),
        caseId,
        documentVersionIds[2],
      ],
    );
    await database.query(
      `UPDATE document_processing_attempts SET state = 'published', claims_json = $1::jsonb
       WHERE case_id = $2 AND document_version_id = $3`,
      [
        JSON.stringify({
          status: 'validated',
          claims: [
            unverified,
            {
              status: 'verified',
              claimId: 'claim-3',
              text: 'The RFC was limited.',
              section: 'five_step',
            },
            { status: 'verified', text: 'Missing identity is ignored.' },
          ],
        }),
        caseId,
        documentVersionIds[1],
      ],
    );
    const response = await api.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/review-artifacts`,
      headers: requestHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      artifacts: {
        summary: [
          verified,
          { status: 'verified', claimId: 'claim-2', text: 'Treatment occurred.' },
          { status: 'verified', claimId: 'claim-6', text: 'Malformed source is ignored.' },
        ],
        medical: [
          {
            status: 'verified',
            claimId: 'claim-4',
            text: 'A medical visit occurred.',
            section: 'medical',
          },
        ],
        procedural: [
          {
            status: 'verified',
            claimId: 'claim-5',
            text: 'The hearing occurred.',
            section: 'procedural',
          },
        ],
        five_step: [
          {
            status: 'verified',
            claimId: 'claim-3',
            text: 'The RFC was limited.',
            section: 'five_step',
          },
        ],
      },
    });
    const hidden = await api.inject({
      method: 'GET',
      url: '/api/v1/cases/00000000-0000-4000-8000-000000000099/review-artifacts',
      headers: requestHeaders,
    });
    expect(hidden.statusCode).toBe(404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

test('requeues a failed processing record for a case member', async () => {
  const root = await mkdtemp(join(tmpdir(), 'record-review-api-processing-retry-test-'));
  const caseId = '00000000-0000-4000-8000-000000000017';
  try {
    await api.close();
    api = createDevelopmentApi(environment, database, { root, maximumBytes: 3 });
    await createCase(database, { caseId, reviewerId, label: 'Synthetic processing retry case' });
    const uploaded = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/synthetic-originals`,
      headers: { ...requestHeaders, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('abc'),
    });
    const documentVersionId = uploaded.json<{ original: { documentVersionId: string } }>().original
      .documentVersionId;
    await database.query(
      `UPDATE document_processing_attempts
       SET state = 'failed', failure_code = 'extraction_failed', attempt_count = 2
       WHERE case_id = $1 AND document_version_id = $2`,
      [caseId, documentVersionId],
    );

    const response = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/document-processing/${documentVersionId}/retry`,
      headers: requestHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      processing: {
        documentVersionId,
        extractionVersion: 'pdfjs-native-v1',
        state: 'queued',
        attemptCount: 2,
        failureCode: null,
      },
    });

    const missing = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/00000000-0000-0000-0000-000000000099/document-processing/${documentVersionId}/retry`,
      headers: requestHeaders,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'processing_not_found' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('downloads a member original as non-inline bytes after verifying its stored reference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'record-review-api-download-test-'));
  const caseId = '00000000-0000-4000-8000-000000000013';
  try {
    await api.close();
    api = createDevelopmentApi(environment, database, { root, maximumBytes: 3 });
    await createCase(database, { caseId, reviewerId, label: 'Synthetic download case' });
    const uploaded = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/synthetic-originals`,
      headers: { ...requestHeaders, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('abc'),
    });
    expect(uploaded.statusCode).toBe(201);
    const versionId = uploaded.json<{ original: { documentVersionId: string } }>().original
      .documentVersionId;
    const downloaded = await api.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/synthetic-originals/${versionId}`,
      headers: requestHeaders,
    });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers['content-type']).toMatch(/^application\/octet-stream/);
    expect(downloaded.headers['content-disposition']).toBe('attachment');
    expect(downloaded.headers['x-content-type-options']).toBe('nosniff');
    expect(downloaded.headers['cache-control']).toBe('no-store');
    expect(downloaded.rawPayload).toEqual(Buffer.from('abc'));
    const missing = await api.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/synthetic-originals/00000000-0000-4000-8000-000000000099`,
      headers: requestHeaders,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'original_not_found' });
    const query = vi.spyOn(database, 'query');
    try {
      for (const url of [
        `/api/v1/cases/not-a-uuid/synthetic-originals/${versionId}`,
        `/api/v1/cases/${caseId}/synthetic-originals/not-a-uuid`,
      ]) {
        query.mockClear();
        const malformed = await api.inject({ method: 'GET', url, headers: requestHeaders });
        expect(malformed.statusCode).toBe(400);
        expect(malformed.json()).toEqual({ code: 'invalid_request' });
        expect(query).not.toHaveBeenCalled();
      }
    } finally {
      query.mockRestore();
    }
    const read = vi.spyOn(originalStorage, 'readOriginal').mockResolvedValueOnce(undefined);
    try {
      const inconsistent = await api.inject({
        method: 'GET',
        url: `/api/v1/cases/${caseId}/synthetic-originals/${versionId}`,
        headers: requestHeaders,
      });
      expect(inconsistent.statusCode).toBe(404);
      expect(inconsistent.json()).toEqual({ code: 'original_not_found' });
    } finally {
      read.mockRestore();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('returns the persisted media type when a member opens an original', async () => {
  const root = await mkdtemp(join(tmpdir(), 'record-review-api-media-type-test-'));
  const caseId = '00000000-0000-4000-8000-000000000014';
  try {
    await api.close();
    api = createDevelopmentApi(environment, database, { root, maximumBytes: 32 });
    await createCase(database, { caseId, reviewerId, label: 'Media type case' });
    const uploaded = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/synthetic-originals`,
      headers: {
        ...requestHeaders,
        'content-type': 'application/octet-stream',
        'x-record-review-file-name': 'decision.pdf',
        'x-record-review-media-type': 'application/pdf',
      },
      payload: Buffer.from('%PDF-1.4 synthetic'),
    });
    const versionId = uploaded.json<{ original: { documentVersionId: string } }>().original
      .documentVersionId;
    const downloaded = await api.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/synthetic-originals/${versionId}`,
      headers: requestHeaders,
    });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers['content-type']).toMatch(/^application\/pdf/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('accepts an explicitly declared PDF upload media type', async () => {
  const root = await mkdtemp(join(tmpdir(), 'record-review-api-pdf-media-test-'));
  const caseId = '00000000-0000-4000-8000-000000000015';
  try {
    await api.close();
    api = createDevelopmentApi(environment, database, { root, maximumBytes: 32 });
    await createCase(database, { caseId, reviewerId, label: 'Declared PDF case' });
    const response = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/synthetic-originals`,
      headers: {
        ...requestHeaders,
        'content-type': 'application/pdf',
        'x-record-review-file-name': 'decision.pdf',
        'x-record-review-media-type': 'application/pdf',
      },
      payload: Buffer.from('%PDF-1.4 synthetic'),
    });
    expect(response.statusCode).toBe(201);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('hides another reviewer original even when its reference and bytes exist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'record-review-api-private-download-test-'));
  const caseId = '00000000-0000-4000-8000-000000000014';
  const documentVersionId = '00000000-0000-4000-8000-000000000024';
  try {
    await api.close();
    api = createDevelopmentApi(environment, database, { root, maximumBytes: 3 });
    await createCase(database, { caseId, reviewerId: otherReviewerId, label: 'Other reviewer' });
    const stored = await writeOriginalStream(
      root,
      { caseId, documentVersionId },
      (async function* () {
        yield Buffer.from('xyz');
      })(),
      3,
    );
    expect(await registerOriginalReference(database, otherReviewerId, stored)).toEqual(stored);
    const read = vi.spyOn(originalStorage, 'readOriginal');
    try {
      for (const requestedCaseId of [caseId, '00000000-0000-4000-8000-000000000099']) {
        const hidden = await api.inject({
          method: 'GET',
          url: `/api/v1/cases/${requestedCaseId}/synthetic-originals/${documentVersionId}`,
          headers: requestHeaders,
        });
        expect(hidden.statusCode).toBe(404);
        expect(hidden.json()).toEqual({ code: 'original_not_found' });
        expect(hidden.rawPayload).not.toEqual(Buffer.from('xyz'));
      }
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('refuses a nonmember synthetic original without storing bytes or an attempt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'record-review-api-original-test-'));
  const caseId = '00000000-0000-4000-8000-000000000004';
  try {
    await api.close();
    api = createDevelopmentApi(environment, database, { root, maximumBytes: 3 });
    await createCase(database, {
      caseId,
      reviewerId: otherReviewerId,
      label: 'Other reviewer case',
    });
    const response = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/synthetic-originals`,
      headers: { ...requestHeaders, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('abc'),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'case_not_found' });
    expect(await readdir(root)).toEqual([]);
    expect((await database.query('SELECT * FROM original_upload_attempts')).rows).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects an oversized synthetic original with a safe response and no stored bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'record-review-api-original-test-'));
  const caseId = '00000000-0000-4000-8000-000000000005';
  try {
    await api.close();
    api = createDevelopmentApi(environment, database, { root, maximumBytes: 3 });
    await createCase(database, { caseId, reviewerId, label: 'Oversized original case' });
    const response = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/synthetic-originals`,
      headers: { ...requestHeaders, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('abcd'),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ code: 'request_too_large' });
    expect((await database.query('SELECT state FROM original_upload_attempts')).rows).toEqual([
      { state: 'failed' },
    ]);
    expect((await database.query('SELECT * FROM original_references')).rows).toEqual([]);
    const caseDirectories = await readdir(root);
    expect(caseDirectories).toHaveLength(1);
    const [directory] = caseDirectories;
    if (!directory) throw new Error('Expected a case storage directory');
    expect(await readdir(join(root, directory))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects an unsupported synthetic original media type without an upload attempt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'record-review-api-original-test-'));
  const caseId = '00000000-0000-4000-8000-000000000006';
  try {
    await api.close();
    api = createDevelopmentApi(environment, database, { root, maximumBytes: 3 });
    await createCase(database, { caseId, reviewerId, label: 'Unsupported media case' });
    const response = await api.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/synthetic-originals`,
      headers: { ...requestHeaders, 'content-type': 'application/octet-stream; charset=utf-8' },
      payload: 'abc',
    });
    expect(response.statusCode).toBe(415);
    expect(response.json()).toEqual({ code: 'unsupported_media_type' });
    expect((await database.query('SELECT * FROM original_upload_attempts')).rows).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
