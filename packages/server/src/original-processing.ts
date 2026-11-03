import {
  findCaseForReviewer,
  findOriginalReference,
  type SqlClient,
} from '@record-review/case-repository/cases';
import {
  insertTextSourcesForReviewer,
  listTextSourceUnitsForReviewer,
  type TextSourceGeometry,
  type TextSourceUnit,
} from '@record-review/case-repository/source-units';
import { findOriginalDocumentMetadata } from '@record-review/case-repository/original-document-metadata';
import { extractDocxBytes } from '@record-review/document-processing/docx';
import { extractPdfBytes } from '@record-review/document-processing/pdf';
import { detectDocumentSignature } from '@record-review/record-domain/document-signature';
import { readOriginal } from '@record-review/record-storage/originals';
import type { ValidatedClaimsResult } from './source-grounded-generation.ts';

type ExtractedPage = Readonly<{
  status: 'extracted';
  pageNumber: number;
  rawText: string;
  geometry?: TextSourceGeometry;
}>;
type PageGap = Readonly<{
  status: 'unavailable';
  pageNumber: number;
  reason: 'page_extraction_failed';
}>;

type ProcessingInput = Readonly<{
  database: SqlClient;
  reviewerId: string;
  caseId: string;
  documentVersionId: string;
  root: string;
  maximumBytes: number;
  maximumPages: number;
  extractionVersion: string;
  format?: 'pdf';
  extractPages: (
    bytes: Uint8Array,
    maximumPages: number,
  ) => Promise<readonly (ExtractedPage | PageGap)[]>;
  createSourceUnitId: () => string;
  generateClaims?: (
    caseId: string,
    sources: readonly TextSourceUnit[],
  ) => Promise<ValidatedClaimsResult>;
}>;

type StoredProcessingInput = Omit<ProcessingInput, 'extractPages' | 'format'> &
  Readonly<{
    extractDocxPages?: ProcessingInput['extractPages'];
  }>;

export function processStoredPdfOriginalForReviewer(input: StoredProcessingInput) {
  return processPdfOriginalForReviewer({
    ...input,
    extractPages: (bytes, maximumPages) => extractPdfBytes(bytes, input.maximumBytes, maximumPages),
  });
}

export async function processStoredOriginalForReviewer(input: StoredProcessingInput) {
  const metadata = await findOriginalDocumentMetadata(
    input.database,
    input.reviewerId,
    input.caseId,
    input.documentVersionId,
  );
  const isDocx =
    metadata?.mediaType.toLowerCase() ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    metadata?.fileName.toLowerCase().endsWith('.docx');
  if (!isDocx) return processStoredPdfOriginalForReviewer(input);
  return processOriginalForReviewer({
    ...input,
    extractPages:
      input.extractDocxPages ??
      ((bytes, maximumPages) => extractDocxBytes(bytes, input.maximumBytes, maximumPages)),
  });
}

export async function processPdfOriginalForReviewer(input: ProcessingInput) {
  return processOriginalForReviewer({ ...input, format: 'pdf' });
}

async function processOriginalForReviewer(input: ProcessingInput) {
  const record = await findCaseForReviewer(input.database, input.reviewerId, input.caseId);
  if (!record) return { status: 'original_unavailable' as const };
  const reference = await findOriginalReference(
    input.database,
    input.reviewerId,
    input.caseId,
    input.documentVersionId,
  );
  if (!reference) return { status: 'original_unavailable' as const };
  if (reference.byteLength > input.maximumBytes) throw new Error('original_byte_budget_exceeded');
  const bytes = (await readOriginal(input.root, input.caseId, reference)) as Buffer;
  if (input.format === 'pdf' && detectDocumentSignature(bytes) !== 'pdf')
    throw new Error('unsupported_document_format');
  const pages = await input.extractPages(bytes, input.maximumPages);
  const sources: TextSourceUnit[] = pages
    .filter((page): page is ExtractedPage => page.status === 'extracted')
    .map((page) => ({
      sourceUnitId: input.createSourceUnitId(),
      caseId: input.caseId,
      documentVersionId: input.documentVersionId,
      recordRevision: record.recordRevision,
      documentSha256: reference.sha256,
      extractionVersion: input.extractionVersion,
      pageNumber: page.pageNumber,
      rawText: page.rawText,
      geometry: page.geometry ?? { view: [], rotation: 0, items: [] },
    }));
  const claims = input.generateClaims
    ? await input.generateClaims(
        input.caseId,
        (
          await listTextSourceUnitsForReviewer(input.database, input.reviewerId, input.caseId)
        ).concat(sources),
      )
    : undefined;
  const published = await insertTextSourcesForReviewer(input.database, input.reviewerId, sources);
  if (published.length !== sources.length) return { status: 'publication_rejected' as const };
  return {
    status: 'published' as const,
    sourceUnitIds: published.map((source) => source.sourceUnitId),
    gaps: pages
      .filter((page): page is PageGap => page.status === 'unavailable')
      .map(({ pageNumber, reason }) => ({ pageNumber, reason })),
    ...(claims ? { claims } : {}),
  };
}
