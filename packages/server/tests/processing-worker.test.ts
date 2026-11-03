import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createCase, registerOriginalReference } from '@record-review/case-repository/cases';
import {
  failDocumentProcessing,
  findDocumentProcessingForReviewer,
  reserveDocumentProcessing,
} from '@record-review/case-repository/document-processing-attempts';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { runNextDocumentProcessing } from '../src/processing-worker.ts';

let database: PGlite;
const caseId = '00000000-0000-4000-8000-000000000301';
const reviewerId = '00000000-0000-4000-8000-000000000311';
const extractionVersion = 'pdfjs-native-v1';

beforeAll(async () => {
  database = await PGlite.create();
});

beforeEach(async () => {
  await database.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  for (const migration of [
    '202609230001_initial_case_metadata.sql',
    '202610010001_document_processing_attempts.sql',
    '202610150001_processing_claims.sql',
    '202611010001_original_document_metadata.sql',
  ]) {
    const sql = await readFile(
      new URL(`../../case-repository/migrations/${migration}`, import.meta.url),
      'utf8',
    );
    await database.exec(sql.replace(/-- Down Migration[\s\S]*$/, ''));
  }
  await createCase(database, { caseId, reviewerId, label: 'Synthetic worker case' });
});

afterAll(async () => {
  await database.close();
});

test('runs one leased processing job to a durable safe terminal state', async () => {
  const processOriginal = vi.fn();
  const common = {
    database,
    root: '/synthetic/private/originals',
    now: new Date('2026-10-01T14:00:00Z'),
    leaseExpiresAt: new Date('2026-10-01T14:05:00Z'),
    leaseToken: '00000000-0000-4000-8000-000000000391',
    createSourceUnitId: () => '00000000-0000-4000-8000-000000000399',
    processOriginal,
  };
  await expect(runNextDocumentProcessing(common)).resolves.toEqual({ status: 'idle' });
  expect(processOriginal).not.toHaveBeenCalled();

  const reserve = async (suffix: string) => {
    const documentVersionId = `00000000-0000-4000-8000-0000000003${suffix}`;
    await registerOriginalReference(database, reviewerId, {
      caseId,
      documentVersionId,
      sha256: 'a'.repeat(64),
      byteLength: 512,
    });
    await reserveDocumentProcessing(database, {
      caseId,
      documentVersionId,
      reviewerId,
      extractionVersion,
      maximumBytes: 1024,
      maximumPages: 400,
    });
    return documentVersionId;
  };

  const publishedVersion = await reserve('21');
  processOriginal.mockResolvedValueOnce({
    status: 'published',
    sourceUnitIds: ['00000000-0000-4000-8000-000000000331'],
    gaps: [{ pageNumber: 2, reason: 'page_extraction_failed' }],
  });
  await expect(runNextDocumentProcessing(common)).resolves.toEqual({
    status: 'published',
    caseId,
    documentVersionId: publishedVersion,
    sourceUnitIds: ['00000000-0000-4000-8000-000000000331'],
    gaps: [{ pageNumber: 2, reason: 'page_extraction_failed' }],
  });
  expect(processOriginal).toHaveBeenLastCalledWith({
    database,
    reviewerId,
    caseId,
    documentVersionId: publishedVersion,
    root: common.root,
    maximumBytes: 1024,
    maximumPages: 400,
    extractionVersion,
    createSourceUnitId: common.createSourceUnitId,
  });
  await expect(
    findDocumentProcessingForReviewer(
      database,
      reviewerId,
      caseId,
      publishedVersion,
      extractionVersion,
    ),
  ).resolves.toMatchObject({ state: 'published', failureCode: null });

  const claimsVersion = await reserve('32');
  const claims = { status: 'validated' as const, claims: [] };
  const generateClaims = vi.fn();
  processOriginal.mockResolvedValueOnce({
    status: 'published',
    sourceUnitIds: ['00000000-0000-4000-8000-000000000332'],
    gaps: [],
    claims,
  });
  await expect(runNextDocumentProcessing({ ...common, generateClaims })).resolves.toEqual({
    status: 'published',
    caseId,
    documentVersionId: claimsVersion,
    sourceUnitIds: ['00000000-0000-4000-8000-000000000332'],
    gaps: [],
    claims,
  });
  expect(processOriginal).toHaveBeenLastCalledWith({
    database,
    reviewerId,
    caseId,
    documentVersionId: claimsVersion,
    root: common.root,
    maximumBytes: 1024,
    maximumPages: 400,
    extractionVersion,
    createSourceUnitId: common.createSourceUnitId,
    generateClaims,
  });
  await expect(
    findDocumentProcessingForReviewer(
      database,
      reviewerId,
      caseId,
      claimsVersion,
      extractionVersion,
    ),
  ).resolves.toMatchObject({ state: 'published', claims });

  const unavailableVersion = await reserve('22');
  processOriginal.mockResolvedValueOnce({ status: 'original_unavailable' });
  await expect(runNextDocumentProcessing(common)).resolves.toEqual({
    status: 'failed',
    caseId,
    documentVersionId: unavailableVersion,
    failureCode: 'original_unavailable',
  });
  await expect(
    findDocumentProcessingForReviewer(
      database,
      reviewerId,
      caseId,
      unavailableVersion,
      extractionVersion,
    ),
  ).resolves.toMatchObject({ state: 'failed', failureCode: 'original_unavailable' });

  const rejectedVersion = await reserve('23');
  processOriginal.mockResolvedValueOnce({ status: 'publication_rejected' });
  await expect(runNextDocumentProcessing(common)).resolves.toEqual({
    status: 'failed',
    caseId,
    documentVersionId: rejectedVersion,
    failureCode: 'publication_rejected',
  });

  for (const [suffix, message, failureCode] of [
    ['24', 'original_byte_budget_exceeded', 'byte_budget_exceeded'],
    ['25', 'unsupported_document_format', 'unsupported_document_format'],
    ['26', 'invalid_pdf_page_budget', 'page_budget_exceeded'],
    ['27', 'pdf_page_budget_exceeded', 'page_budget_exceeded'],
    ['28', 'pdf_extraction_failed', 'extraction_failed'],
  ] as const) {
    const documentVersionId = await reserve(suffix);
    processOriginal.mockRejectedValueOnce(new Error(message));
    await expect(runNextDocumentProcessing(common)).resolves.toEqual({
      status: 'failed',
      caseId,
      documentVersionId,
      failureCode,
    });
  }

  const nonErrorVersion = await reserve('29');
  processOriginal.mockRejectedValueOnce('synthetic private rejection');
  await expect(runNextDocumentProcessing(common)).resolves.toEqual({
    status: 'failed',
    caseId,
    documentVersionId: nonErrorVersion,
    failureCode: 'extraction_failed',
  });

  const lostVersion = await reserve('30');
  processOriginal.mockImplementationOnce(async () => {
    await failDocumentProcessing(database, {
      caseId,
      documentVersionId: lostVersion,
      extractionVersion,
      leaseToken: common.leaseToken,
      failureCode: 'extraction_failed',
    });
    return { status: 'published', sourceUnitIds: [], gaps: [] };
  });
  await expect(runNextDocumentProcessing(common)).resolves.toEqual({
    status: 'lease_lost',
    caseId,
    documentVersionId: lostVersion,
  });
  await expect(
    findDocumentProcessingForReviewer(database, reviewerId, caseId, lostVersion, extractionVersion),
  ).resolves.toMatchObject({ state: 'failed', failureCode: 'extraction_failed' });

  const concreteFailureVersion = await reserve('31');
  await expect(
    runNextDocumentProcessing({
      database,
      root: common.root,
      now: common.now,
      leaseExpiresAt: common.leaseExpiresAt,
      leaseToken: common.leaseToken,
      createSourceUnitId: common.createSourceUnitId,
    }),
  ).resolves.toEqual({
    status: 'failed',
    caseId,
    documentVersionId: concreteFailureVersion,
    failureCode: 'extraction_failed',
  });
});
