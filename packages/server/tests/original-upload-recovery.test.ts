import { expect, test, vi } from 'vitest';
import type { OriginalUploadAttempt } from '@record-review/case-repository/upload-attempts';
import type { OriginalReference } from '@record-review/case-repository/cases';
import { listOriginalReferencesForReviewer } from '@record-review/case-repository/cases';
import {
  failOriginalUpload,
  listRecoverableOriginalUploads,
} from '@record-review/case-repository/upload-attempts';
import { discardOriginal, readOriginal } from '@record-review/record-storage/originals';
import {
  recoverStaleOriginalUploads,
  reconcileOriginalReferencesForReviewer,
} from '../src/original-upload-recovery.ts';

vi.mock('@record-review/case-repository/cases', () => ({
  listOriginalReferencesForReviewer: vi.fn(),
}));

vi.mock('@record-review/case-repository/upload-attempts', () => ({
  failOriginalUpload: vi.fn(),
  listRecoverableOriginalUploads: vi.fn(),
}));
vi.mock('@record-review/record-storage/originals', () => ({
  discardOriginal: vi.fn(),
  readOriginal: vi.fn(),
}));

test('reports missing and integrity-failed registered originals without inventing replacements', async () => {
  const first: OriginalReference = {
    caseId: '00000000-0000-4000-8000-000000000001',
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    sha256: 'a'.repeat(64),
    byteLength: 10,
  };
  const second: OriginalReference = {
    ...first,
    documentVersionId: '00000000-0000-4000-8000-000000000022',
  };
  const third: OriginalReference = {
    ...first,
    documentVersionId: '00000000-0000-4000-8000-000000000023',
  };
  const fourth: OriginalReference = {
    ...first,
    documentVersionId: '00000000-0000-4000-8000-000000000024',
  };
  const fifth: OriginalReference = {
    ...first,
    documentVersionId: '00000000-0000-4000-8000-000000000025',
  };
  const database = { query: vi.fn() };
  vi.mocked(listOriginalReferencesForReviewer).mockResolvedValueOnce([
    first,
    second,
    third,
    fourth,
    fifth,
  ]);
  const missing = Object.assign(new Error('synthetic missing file'), { code: 'ENOENT' });
  vi.mocked(readOriginal)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('Stored original failed its integrity check'))
    .mockRejectedValueOnce(missing)
    .mockResolvedValueOnce(Buffer.from('valid'))
    .mockResolvedValueOnce(Buffer.from('another-valid'));

  await expect(
    reconcileOriginalReferencesForReviewer({
      database,
      reviewerId: '00000000-0000-4000-8000-000000000011',
      caseId: first.caseId,
      root: '/synthetic/originals',
    }),
  ).resolves.toEqual({ checked: 5, missing: 2, integrityFailures: 1 });
  expect(listOriginalReferencesForReviewer).toHaveBeenCalledExactlyOnceWith(
    database,
    '00000000-0000-4000-8000-000000000011',
    first.caseId,
  );
  expect(readOriginal).toHaveBeenNthCalledWith(1, '/synthetic/originals', first.caseId, first);
  expect(readOriginal).toHaveBeenNthCalledWith(2, '/synthetic/originals', first.caseId, second);
  expect(readOriginal).toHaveBeenNthCalledWith(3, '/synthetic/originals', first.caseId, third);
  expect(readOriginal).toHaveBeenNthCalledWith(4, '/synthetic/originals', first.caseId, fourth);
  expect(readOriginal).toHaveBeenNthCalledWith(5, '/synthetic/originals', first.caseId, fifth);
});

test('returns a safe reconciliation failure for an unexpected storage error', async () => {
  const reference: OriginalReference = {
    caseId: '00000000-0000-4000-8000-000000000001',
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    sha256: 'a'.repeat(64),
    byteLength: 10,
  };
  const database = { query: vi.fn() };
  vi.mocked(listOriginalReferencesForReviewer).mockResolvedValueOnce([reference]);
  const storageFailure = new Error('permission denied');
  vi.mocked(readOriginal).mockRejectedValueOnce(storageFailure);

  await expect(
    reconcileOriginalReferencesForReviewer({
      database,
      reviewerId: '00000000-0000-4000-8000-000000000011',
      caseId: reference.caseId,
      root: '/synthetic/originals',
    }),
  ).rejects.toMatchObject({ message: 'original_reconciliation_failed', cause: storageFailure });
});

test('fails and removes only stale upload attempts claimed for recovery', async () => {
  const first: OriginalUploadAttempt = {
    caseId: '00000000-0000-4000-8000-000000000001',
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    reviewerId: '00000000-0000-4000-8000-000000000011',
    maximumBytes: 16,
    state: 'receiving',
  };
  const alreadyResolved: OriginalUploadAttempt = {
    ...first,
    documentVersionId: '00000000-0000-4000-8000-000000000022',
  };
  const missingFile: OriginalUploadAttempt = {
    ...first,
    documentVersionId: '00000000-0000-4000-8000-000000000023',
  };
  const database = { query: vi.fn() };
  const list = vi
    .mocked(listRecoverableOriginalUploads)
    .mockResolvedValue([first, alreadyResolved, missingFile]);
  const fail = vi
    .mocked(failOriginalUpload)
    .mockResolvedValueOnce({ ...first, state: 'failed' })
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ ...missingFile, state: 'failed' });
  const missing = Object.assign(new Error('synthetic missing file'), { code: 'ENOENT' });
  const discard = vi
    .mocked(discardOriginal)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(missing);
  const olderThan = new Date('2026-10-04T16:00:00Z');

  await expect(
    recoverStaleOriginalUploads({
      database,
      root: '/synthetic/originals',
      olderThan,
      limit: 25,
    }),
  ).resolves.toBe(2);
  expect(list).toHaveBeenCalledExactlyOnceWith(database, olderThan, 25);
  expect(fail).toHaveBeenNthCalledWith(
    1,
    database,
    first.reviewerId,
    first.caseId,
    first.documentVersionId,
  );
  expect(fail).toHaveBeenNthCalledWith(
    2,
    database,
    alreadyResolved.reviewerId,
    alreadyResolved.caseId,
    alreadyResolved.documentVersionId,
  );
  expect(fail).toHaveBeenNthCalledWith(
    3,
    database,
    missingFile.reviewerId,
    missingFile.caseId,
    missingFile.documentVersionId,
  );
  expect(discard).toHaveBeenNthCalledWith(1, '/synthetic/originals', first);
  expect(discard).toHaveBeenNthCalledWith(2, '/synthetic/originals', missingFile);

  list.mockResolvedValueOnce([first]);
  fail.mockResolvedValueOnce({ ...first, state: 'failed' });
  const storageFailure = new Error('synthetic private storage details');
  discard.mockReset().mockRejectedValueOnce(storageFailure);
  await expect(
    recoverStaleOriginalUploads({
      database,
      root: '/synthetic/originals',
      olderThan,
      limit: 25,
    }),
  ).rejects.toMatchObject({ message: 'original_upload_recovery_failed', cause: storageFailure });
});
