import type { SqlClient } from '@record-review/case-repository/cases';
import type { TextSourceUnit } from '@record-review/case-repository/source-units';
import {
  claimDocumentProcessing,
  completeDocumentProcessing,
  failDocumentProcessing,
  type DocumentProcessingFailureCode,
} from '@record-review/case-repository/document-processing-attempts';
import { processStoredOriginalForReviewer } from './original-processing.ts';
import type { ValidatedClaimsResult } from './source-grounded-generation.ts';

export type ClaimGenerator = (
  caseId: string,
  sources: readonly TextSourceUnit[],
) => Promise<ValidatedClaimsResult>;

type ProcessingResult =
  | Readonly<{
      status: 'published';
      sourceUnitIds: string[];
      gaps: ReadonlyArray<Readonly<{ pageNumber: number; reason: 'page_extraction_failed' }>>;
      claims?: ValidatedClaimsResult;
    }>
  | Readonly<{ status: 'original_unavailable' | 'publication_rejected' }>;

type OriginalProcessor = (
  input: Readonly<{
    database: SqlClient;
    reviewerId: string;
    caseId: string;
    documentVersionId: string;
    root: string;
    maximumBytes: number;
    maximumPages: number;
    extractionVersion: string;
    createSourceUnitId: () => string;
    generateClaims?: ClaimGenerator;
  }>,
) => Promise<ProcessingResult>;

type WorkerInput = Readonly<{
  database: SqlClient;
  root: string;
  now: Date;
  leaseExpiresAt: Date;
  leaseToken: string;
  createSourceUnitId: () => string;
  processOriginal?: OriginalProcessor;
  generateClaims?: ClaimGenerator;
}>;

type WorkerOutcome =
  | Readonly<{
      status: 'published';
      sourceUnitIds: string[];
      gaps: Extract<ProcessingResult, { status: 'published' }>['gaps'];
      claims?: ValidatedClaimsResult;
    }>
  | Readonly<{ status: 'failed'; failureCode: DocumentProcessingFailureCode }>;

function normalizeFailure(error: unknown): DocumentProcessingFailureCode {
  const message = String(error);
  if (message === 'Error: original_byte_budget_exceeded') return 'byte_budget_exceeded';
  if (message === 'Error: unsupported_document_format') return 'unsupported_document_format';
  if (message === 'Error: invalid_pdf_page_budget' || message === 'Error: pdf_page_budget_exceeded')
    return 'page_budget_exceeded';
  return 'extraction_failed';
}

export async function runNextDocumentProcessing(input: WorkerInput) {
  const claim = await claimDocumentProcessing(input.database, {
    now: input.now,
    leaseExpiresAt: input.leaseExpiresAt,
    leaseToken: input.leaseToken,
  });
  if (!claim) return { status: 'idle' as const };

  let outcome: WorkerOutcome;
  try {
    const result = await (input.processOriginal ?? processStoredOriginalForReviewer)({
      database: input.database,
      reviewerId: claim.reviewerId,
      caseId: claim.caseId,
      documentVersionId: claim.documentVersionId,
      root: input.root,
      maximumBytes: claim.maximumBytes,
      maximumPages: claim.maximumPages,
      extractionVersion: claim.extractionVersion,
      createSourceUnitId: input.createSourceUnitId,
      ...(input.generateClaims ? { generateClaims: input.generateClaims } : {}),
    });
    outcome =
      result.status === 'published'
        ? {
            status: 'published',
            sourceUnitIds: result.sourceUnitIds,
            gaps: result.gaps,
            ...(result.claims ? { claims: result.claims } : {}),
          }
        : { status: 'failed', failureCode: result.status };
  } catch (error) {
    outcome = { status: 'failed', failureCode: normalizeFailure(error) };
  }

  const identity = {
    caseId: claim.caseId,
    documentVersionId: claim.documentVersionId,
    extractionVersion: claim.extractionVersion,
    leaseToken: claim.leaseToken,
  };
  const finalized =
    outcome.status === 'published'
      ? await completeDocumentProcessing(input.database, {
          ...identity,
          ...(outcome.claims ? { claims: outcome.claims } : {}),
        })
      : await failDocumentProcessing(input.database, {
          ...identity,
          failureCode: outcome.failureCode,
        });
  if (!finalized)
    return {
      status: 'lease_lost' as const,
      caseId: claim.caseId,
      documentVersionId: claim.documentVersionId,
    };
  return {
    ...outcome,
    caseId: claim.caseId,
    documentVersionId: claim.documentVersionId,
  };
}
