import type { SqlClient } from '@record-review/case-repository/cases';
import {
  listCasesForReviewer,
  listOriginalReferencesForReviewer,
} from '@record-review/case-repository/cases';
import {
  failOriginalUpload,
  listRecoverableOriginalUploads,
} from '@record-review/case-repository/upload-attempts';
import { discardOriginal } from '@record-review/record-storage/originals';
import { readOriginal } from '@record-review/record-storage/originals';

type OriginalUploadRecoveryInput = Readonly<{
  database: SqlClient;
  root: string;
  olderThan: Date;
  limit: number;
}>;

function isMissingOriginal(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export async function reconcileOriginalReferencesForReviewer(
  input: Readonly<{
    database: SqlClient;
    reviewerId: string;
    caseId: string;
    root: string;
  }>,
): Promise<Readonly<{ checked: number; missing: number; integrityFailures: number }>> {
  const references = await listOriginalReferencesForReviewer(
    input.database,
    input.reviewerId,
    input.caseId,
  );
  let missing = 0;
  let integrityFailures = 0;
  for (const reference of references) {
    try {
      const bytes = await readOriginal(input.root, input.caseId, reference);
      if (bytes === undefined) missing += 1;
    } catch (error) {
      if (isMissingOriginal(error)) missing += 1;
      else if (
        error instanceof Error &&
        error.message === 'Stored original failed its integrity check'
      )
        integrityFailures += 1;
      else throw new Error('original_reconciliation_failed', { cause: error });
    }
  }
  return { checked: references.length, missing, integrityFailures };
}

export async function reconcileAllOriginalReferencesForReviewer(
  input: Readonly<{
    database: SqlClient;
    reviewerId: string;
    root: string;
  }>,
): Promise<Readonly<{ checked: number; missing: number; integrityFailures: number }>> {
  const cases = await listCasesForReviewer(input.database, input.reviewerId);
  const totals = { checked: 0, missing: 0, integrityFailures: 0 };
  for (const record of cases) {
    const result = await reconcileOriginalReferencesForReviewer({
      database: input.database,
      reviewerId: input.reviewerId,
      caseId: record.caseId,
      root: input.root,
    });
    totals.checked += result.checked;
    totals.missing += result.missing;
    totals.integrityFailures += result.integrityFailures;
  }
  return totals;
}

export async function recoverStaleOriginalUploads(
  input: OriginalUploadRecoveryInput,
): Promise<number> {
  const attempts = await listRecoverableOriginalUploads(
    input.database,
    input.olderThan,
    input.limit,
  );
  let recovered = 0;
  for (const attempt of attempts) {
    const claimed = await failOriginalUpload(
      input.database,
      attempt.reviewerId,
      attempt.caseId,
      attempt.documentVersionId,
    );
    if (!claimed) continue;
    try {
      await discardOriginal(input.root, attempt);
    } catch (error) {
      if (!isMissingOriginal(error))
        throw new Error('original_upload_recovery_failed', { cause: error });
    }
    recovered += 1;
  }
  return recovered;
}
