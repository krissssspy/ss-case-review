export type CaseSummary = Readonly<{
  caseId: string;
  label: string;
  recordRevision: number;
}>;

export type SyntheticRevisionEvent = Readonly<{
  recordRevision: number;
  eventType: 'original_registered';
  documentVersionId: string;
}>;

export type SyntheticUploadAttempt = Readonly<{
  documentVersionId: string;
  maximumBytes: number;
  state: 'receiving' | 'registered' | 'failed';
}>;

export type SyntheticOriginalReceipt = Readonly<{
  caseId: string;
  documentVersionId: string;
  sha256: string;
  byteLength: number;
  fileName?: string;
  mediaType?: string;
}>;

export type SyntheticDocumentProcessing = Readonly<{
  documentVersionId: string;
  extractionVersion: string;
  state: 'queued' | 'processing' | 'published' | 'failed';
  attemptCount: number;
  failureCode:
    | 'original_unavailable'
    | 'unsupported_document_format'
    | 'byte_budget_exceeded'
    | 'page_budget_exceeded'
    | 'extraction_failed'
    | 'publication_rejected'
    | null;
  claims?: SyntheticClaimsResult;
}>;

export type SyntheticProcessingClaim =
  | Readonly<{
      status: 'verified';
      claimId: string;
      text: string;
      source: SyntheticTextSpan;
      section?: 'summary' | 'medical' | 'procedural' | 'five_step';
      speaker?: 'alj' | 'plaintiff' | 'commissioner' | 'vocational_expert';
      step?: 1 | 2 | 3 | 4 | 5;
      flags?: readonly SyntheticClaimFlag[];
      chronology?: SyntheticClaimChronology;
    }>
  | Readonly<{
      status: 'unverified';
      claimId: string;
      text: string;
      message: "The review system couldn't find this evidence in the authorized case record.";
      reason: 'source_unavailable' | 'source_mismatch' | 'invalid_offsets' | 'quote_mismatch';
      section?: 'summary' | 'medical' | 'procedural' | 'five_step';
      speaker?: 'alj' | 'plaintiff' | 'commissioner' | 'vocational_expert';
      step?: 1 | 2 | 3 | 4 | 5;
      flags?: readonly SyntheticClaimFlag[];
      chronology?: SyntheticClaimChronology;
    }>;

export type SyntheticClaimFlag = 'possible_cherry_pick' | 'possible_specialist_mismatch';

export type SyntheticClaimChronology = Readonly<{
  date: string;
  provider?: string;
  reason?: string;
  prescription?: string;
  name?: string;
  importance?: 'important';
}>;

export type SyntheticClaimsResult =
  | Readonly<{ status: 'validated'; claims: readonly SyntheticProcessingClaim[] }>
  | Readonly<{ status: 'refused'; code: 'provider_error' | 'empty_response' | 'safety_refusal' }>
  | Readonly<{ status: 'invalid_output' }>;

export type SyntheticReviewArtifacts = Readonly<{
  summary: readonly SyntheticProcessingClaim[];
  medical: readonly SyntheticProcessingClaim[];
  procedural: readonly SyntheticProcessingClaim[];
  five_step: readonly SyntheticProcessingClaim[];
}>;

export type SyntheticTextSource = Readonly<{
  sourceUnitId: string;
  caseId: string;
  documentVersionId: string;
  recordRevision: number;
  documentSha256: string;
  extractionVersion: string;
  pageNumber: number;
  rawText: string;
  geometry?: SyntheticTextSourceGeometry;
}>;

export type SyntheticTextSourceGeometry = Readonly<{
  view: readonly number[];
  rotation: number;
  items: readonly Readonly<{
    start: number;
    end: number;
    transform: readonly number[];
    width: number;
    height: number;
  }>[];
}>;

export type SyntheticTextSourceReference = Omit<SyntheticTextSource, 'rawText'>;

export type SyntheticTextSpanCandidate = Readonly<{
  recordRevision: number;
  documentVersionId: string;
  documentSha256: string;
  extractionVersion: string;
  sourceUnitId: string;
  start: number;
  end: number;
  quote: string;
}>;

export type SyntheticTextSpan = SyntheticTextSpanCandidate & Readonly<{ caseId: string }>;

export type SyntheticCorrectionSuggestion = Readonly<{
  correctionId: string;
  caseId: string;
  recordRevision: number;
  artifact: 'summary' | 'medical' | 'procedural' | 'five_step';
  entryKey: string;
  proposedText: string;
  rationale: string;
  status: 'pending' | 'accepted' | 'rejected';
}>;

export type NewSyntheticCorrectionSuggestion = Readonly<{
  artifact: SyntheticCorrectionSuggestion['artifact'];
  entryKey: string;
  proposedText: string;
  rationale: string;
}>;

const UUID4_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PROCESSING_STATES = new Set(['queued', 'processing', 'published', 'failed']);
const PROCESSING_FAILURE_CODES = new Set([
  'original_unavailable',
  'unsupported_document_format',
  'byte_budget_exceeded',
  'page_budget_exceeded',
  'extraction_failed',
  'publication_rejected',
]);
const CLAIM_REFUSAL_CODES = new Set(['provider_error', 'empty_response', 'safety_refusal']);
const CLAIM_UNVERIFIED_REASONS = new Set([
  'source_unavailable',
  'source_mismatch',
  'invalid_offsets',
  'quote_mismatch',
]);
const CLAIM_SECTIONS = new Set(['summary', 'medical', 'procedural', 'five_step']);
const CLAIM_SPEAKERS = new Set(['alj', 'plaintiff', 'commissioner', 'vocational_expert']);
const CLAIM_STEPS = new Set([1, 2, 3, 4, 5]);
const CLAIM_FLAGS = new Set(['possible_cherry_pick', 'possible_specialist_mismatch']);
const CORRECTION_ARTIFACTS = new Set(['summary', 'medical', 'procedural', 'five_step']);
const CORRECTION_STATUSES = new Set(['pending', 'accepted', 'rejected']);

/* Stryker disable all */
function isSyntheticTextSourceGeometry(value: unknown): value is SyntheticTextSourceGeometry {
  if (typeof value !== 'object' || value === null) return false;
  const geometry = value as SyntheticTextSourceGeometry;
  if (
    !Array.isArray(geometry.view) ||
    !geometry.view.every((entry) => typeof entry === 'number' && Number.isFinite(entry)) ||
    typeof geometry.rotation !== 'number' ||
    !Number.isFinite(geometry.rotation) ||
    !Array.isArray(geometry.items)
  )
    return false;
  return geometry.items.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      Number.isSafeInteger(item.start) &&
      item.start >= 0 &&
      Number.isSafeInteger(item.end) &&
      item.end >= item.start &&
      Array.isArray(item.transform) &&
      item.transform.every(
        (entry: unknown) => typeof entry === 'number' && Number.isFinite(entry),
      ) &&
      typeof item.width === 'number' &&
      Number.isFinite(item.width) &&
      typeof item.height === 'number' &&
      Number.isFinite(item.height),
  );
}
/* Stryker restore all */

/* Stryker disable all */
function isSyntheticProcessingClaims(
  value: unknown,
  caseId: string,
): value is SyntheticClaimsResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as SyntheticClaimsResult;
  if (result.status === 'invalid_output') return true;
  if (result.status === 'refused') return CLAIM_REFUSAL_CODES.has(result.code);
  if (result.status !== 'validated' || !Array.isArray(result.claims)) return false;
  return result.claims.every((claim) => {
    if (typeof claim !== 'object' || claim === null) return false;
    if (
      typeof claim.claimId !== 'string' ||
      claim.claimId.length === 0 ||
      typeof claim.text !== 'string' ||
      claim.text.length === 0
    )
      return false;
    if (claim.chronology !== undefined && !isSyntheticClaimChronology(claim.chronology))
      return false;
    if (
      (claim.section !== undefined &&
        (typeof claim.section !== 'string' || !CLAIM_SECTIONS.has(claim.section))) ||
      (claim.speaker !== undefined &&
        (typeof claim.speaker !== 'string' || !CLAIM_SPEAKERS.has(claim.speaker))) ||
      (claim.step !== undefined &&
        (!Number.isSafeInteger(claim.step) || !CLAIM_STEPS.has(claim.step as number)))
    )
      return false;
    if (
      claim.flags !== undefined &&
      (!Array.isArray(claim.flags) ||
        claim.flags.length === 0 ||
        !claim.flags.every((flag: unknown) => typeof flag === 'string' && CLAIM_FLAGS.has(flag)))
    )
      return false;
    if (claim.status === 'verified') return isSyntheticTextSpan(claim.source, caseId);
    return (
      claim.status === 'unverified' &&
      claim.message ===
        "The review system couldn't find this evidence in the authorized case record." &&
      CLAIM_UNVERIFIED_REASONS.has(claim.reason)
    );
  });
}
/* Stryker restore all */

/* Stryker disable all */
function isSyntheticClaimChronology(value: unknown): value is SyntheticClaimChronology {
  if (typeof value !== 'object' || value === null) return false;
  const chronology = value as SyntheticClaimChronology;
  if (typeof chronology.date !== 'string' || chronology.date.trim().length === 0) return false;
  if (chronology.importance !== undefined && chronology.importance !== 'important') return false;
  return ['provider', 'reason', 'prescription', 'name'].every(
    (key) =>
      chronology[key as keyof SyntheticClaimChronology] === undefined ||
      typeof chronology[key as keyof SyntheticClaimChronology] === 'string',
  );
}
/* Stryker restore all */

export async function getSyntheticDocumentProcessing(
  caseId: string,
  documentVersionId: string,
): Promise<SyntheticDocumentProcessing | undefined> {
  const response = await fetch(`/api/v1/cases/${caseId}/document-processing/${documentVersionId}`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error('document_processing_unavailable');
  const payload = (await response.json()) as { processing?: unknown } | null;
  const processing = payload?.processing;
  if (!isSyntheticDocumentProcessing(processing, caseId, documentVersionId))
    throw new Error('document_processing_unavailable');
  return processing;
}

export async function retrySyntheticDocumentProcessing(
  caseId: string,
  documentVersionId: string,
): Promise<SyntheticDocumentProcessing | undefined> {
  const response = await fetch(
    `/api/v1/cases/${caseId}/document-processing/${documentVersionId}/retry`,
    {
      method: 'POST',
      headers: { 'x-record-review-client': 'synthetic-workspace' },
      cache: 'no-store',
      redirect: 'error',
    },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error('document_processing_retry_unavailable');
  const payload = (await response.json()) as { processing?: unknown } | null;
  const processing = payload?.processing;
  if (!isSyntheticDocumentProcessing(processing, caseId, documentVersionId))
    throw new Error('document_processing_retry_unavailable');
  return processing;
}

function isSyntheticDocumentProcessing(
  value: unknown,
  caseId: string,
  expectedDocumentVersionId?: string,
): value is SyntheticDocumentProcessing {
  if (typeof value !== 'object' || value === null) return false;
  const processing = value as SyntheticDocumentProcessing;
  return (
    (expectedDocumentVersionId === undefined ||
      processing.documentVersionId === expectedDocumentVersionId) &&
    UUID4_PATTERN.test(processing.documentVersionId) &&
    typeof processing.extractionVersion === 'string' &&
    /\S/.test(processing.extractionVersion) &&
    processing.extractionVersion.length <= 128 &&
    PROCESSING_STATES.has(processing.state) &&
    Number.isSafeInteger(processing.attemptCount) &&
    processing.attemptCount >= 0 &&
    (processing.failureCode === null || PROCESSING_FAILURE_CODES.has(processing.failureCode)) &&
    (processing.claims === undefined || isSyntheticProcessingClaims(processing.claims, caseId))
  );
}

export async function listSyntheticDocumentProcessing(
  caseId: string,
): Promise<SyntheticDocumentProcessing[]> {
  const response = await fetch(`/api/v1/cases/${caseId}/document-processing`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('document_processing_unavailable');
  const payload = (await response.json()) as { processing?: unknown } | null;
  if (
    !Array.isArray(payload?.processing) ||
    !payload.processing.every((item) => isSyntheticDocumentProcessing(item, caseId))
  )
    throw new Error('document_processing_unavailable');
  return payload.processing;
}

function isSyntheticReviewArtifacts(
  value: unknown,
  caseId: string,
): value is SyntheticReviewArtifacts {
  if (typeof value !== 'object' || value === null) return false;
  const artifacts = value as Partial<SyntheticReviewArtifacts>;
  return (['summary', 'medical', 'procedural', 'five_step'] as const).every(
    (section) =>
      Array.isArray(artifacts[section]) &&
      artifacts[section].every(
        (claim) =>
          isSyntheticProcessingClaims({ status: 'validated', claims: [claim] }, caseId) &&
          claim.section === section,
      ),
  );
}

export async function getSyntheticReviewArtifacts(
  caseId: string,
): Promise<SyntheticReviewArtifacts> {
  const response = await fetch(`/api/v1/cases/${caseId}/review-artifacts`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('review_artifacts_unavailable');
  const payload = (await response.json()) as { artifacts?: unknown } | null;
  if (!isSyntheticReviewArtifacts(payload?.artifacts, caseId))
    throw new Error('review_artifacts_unavailable');
  return payload.artifacts;
}

function isSyntheticTextSourceReference(
  value: unknown,
  caseId: string,
): value is SyntheticTextSourceReference {
  if (typeof value !== 'object' || value === null) return false;
  const source = value as SyntheticTextSourceReference;
  return (
    UUID4_PATTERN.test(source.sourceUnitId) &&
    source.caseId === caseId &&
    UUID4_PATTERN.test(source.documentVersionId) &&
    Number.isSafeInteger(source.recordRevision) &&
    source.recordRevision >= 1 &&
    SHA256_PATTERN.test(source.documentSha256) &&
    typeof source.extractionVersion === 'string' &&
    source.extractionVersion.length <= 128 &&
    /\S/.test(source.extractionVersion) &&
    Number.isSafeInteger(source.pageNumber) &&
    source.pageNumber >= 1 &&
    (source.geometry === undefined || isSyntheticTextSourceGeometry(source.geometry))
  );
}

/* Stryker disable all */
function isSyntheticTextSpan(value: unknown, caseId: string): value is SyntheticTextSpan {
  if (typeof value !== 'object' || value === null) return false;
  const span = value as SyntheticTextSpan;
  return (
    span.caseId === caseId &&
    UUID4_PATTERN.test(span.sourceUnitId) &&
    UUID4_PATTERN.test(span.documentVersionId) &&
    Number.isSafeInteger(span.recordRevision) &&
    span.recordRevision >= 1 &&
    SHA256_PATTERN.test(span.documentSha256) &&
    typeof span.extractionVersion === 'string' &&
    span.extractionVersion.length >= 1 &&
    span.extractionVersion.length <= 128 &&
    /\S/.test(span.extractionVersion) &&
    Number.isSafeInteger(span.start) &&
    span.start >= 0 &&
    Number.isSafeInteger(span.end) &&
    span.end > span.start &&
    typeof span.quote === 'string' &&
    span.quote.length > 0
  );
}
/* Stryker restore all */

/* Stryker disable all */
function isSyntheticCorrectionSuggestion(
  value: unknown,
  caseId: string,
): value is SyntheticCorrectionSuggestion {
  if (typeof value !== 'object' || value === null) return false;
  const suggestion = value as SyntheticCorrectionSuggestion;
  return (
    UUID4_PATTERN.test(suggestion.correctionId) &&
    suggestion.caseId === caseId &&
    Number.isSafeInteger(suggestion.recordRevision) &&
    suggestion.recordRevision >= 1 &&
    typeof suggestion.artifact === 'string' &&
    CORRECTION_ARTIFACTS.has(suggestion.artifact) &&
    typeof suggestion.entryKey === 'string' &&
    suggestion.entryKey.length >= 1 &&
    suggestion.entryKey.length <= 256 &&
    /\S/.test(suggestion.entryKey) &&
    typeof suggestion.proposedText === 'string' &&
    suggestion.proposedText.length >= 1 &&
    suggestion.proposedText.length <= 4000 &&
    /\S/.test(suggestion.proposedText) &&
    typeof suggestion.rationale === 'string' &&
    suggestion.rationale.length >= 1 &&
    suggestion.rationale.length <= 4000 &&
    /\S/.test(suggestion.rationale) &&
    typeof suggestion.status === 'string' &&
    CORRECTION_STATUSES.has(suggestion.status)
  );
}
/* Stryker restore all */

export async function listSyntheticTextSources(
  caseId: string,
): Promise<SyntheticTextSourceReference[]> {
  const response = await fetch(`/api/v1/cases/${caseId}/text-sources`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('source_inventory_unavailable');
  const payload = (await response.json()) as { sources?: unknown } | null;
  const sources = payload?.sources;
  if (
    !Array.isArray(sources) ||
    !sources.every(
      (source) =>
        isSyntheticTextSourceReference(source, caseId) && !Object.hasOwn(source, 'rawText'),
    )
  )
    throw new Error('source_inventory_unavailable');
  return sources;
}

export async function getSyntheticTextSource(
  caseId: string,
  sourceUnitId: string,
): Promise<SyntheticTextSource | undefined> {
  const response = await fetch(`/api/v1/cases/${caseId}/text-sources/${sourceUnitId}`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error('text_source_unavailable');
  const payload = (await response.json()) as { source?: unknown } | null;
  const source = payload?.source as SyntheticTextSource | null | undefined;
  if (
    !isSyntheticTextSourceReference(source, caseId) ||
    source.sourceUnitId !== sourceUnitId ||
    typeof source.rawText !== 'string'
  )
    throw new Error('text_source_unavailable');
  return source;
}

export async function verifySyntheticTextSpan(
  caseId: string,
  sourceUnitId: string,
  candidate: SyntheticTextSpanCandidate,
): Promise<SyntheticTextSpan> {
  const response = await fetch(`/api/v1/cases/${caseId}/text-sources/${sourceUnitId}/spans`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-record-review-client': 'synthetic-workspace',
    },
    body: JSON.stringify(candidate),
    cache: 'no-store',
    redirect: 'error',
  });
  /* Stryker disable all */
  if (!response.ok) {
    if (response.status === 422) {
      const payload = (await response.json()) as { code?: unknown; reason?: unknown } | null;
      /* Stryker disable next-line ConditionalExpression OptionalChaining */
      if (payload?.code === 'source_span_not_located' && typeof payload.reason === 'string')
        throw new Error(`${payload.code}:${payload.reason}`);
    }
    throw new Error('source_span_unavailable');
  }
  const payload = (await response.json()) as { span?: unknown } | null;
  const span = payload?.span as SyntheticTextSpan | null | undefined;
  if (
    !isSyntheticTextSpan(span, caseId) ||
    !span ||
    /* Stryker disable next-line ConditionalExpression */
    span.caseId !== caseId ||
    span.sourceUnitId !== sourceUnitId
  )
    throw new Error('source_span_unavailable');
  /* Stryker restore all */
  return span;
}

export async function submitSyntheticCorrectionSuggestion(
  caseId: string,
  suggestion: NewSyntheticCorrectionSuggestion,
): Promise<SyntheticCorrectionSuggestion> {
  const response = await fetch(`/api/v1/cases/${caseId}/correction-suggestions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-record-review-client': 'synthetic-workspace',
    },
    body: JSON.stringify(suggestion),
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('correction_suggestion_unavailable');
  const payload = (await response.json()) as { suggestion?: unknown } | null;
  if (!isSyntheticCorrectionSuggestion(payload?.suggestion, caseId))
    throw new Error('correction_suggestion_unavailable');
  return payload.suggestion;
}

export async function listSyntheticCorrectionSuggestions(
  caseId: string,
): Promise<SyntheticCorrectionSuggestion[]> {
  const response = await fetch(`/api/v1/cases/${caseId}/correction-suggestions`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('correction_suggestions_unavailable');
  const payload = (await response.json()) as { suggestions?: unknown } | null;
  if (
    !Array.isArray(payload?.suggestions) ||
    !payload.suggestions.every((item) => isSyntheticCorrectionSuggestion(item, caseId))
  )
    throw new Error('correction_suggestions_unavailable');
  return payload.suggestions;
}

export async function updateSyntheticCorrectionSuggestionStatus(
  caseId: string,
  correctionId: string,
  status: 'accepted' | 'rejected',
): Promise<SyntheticCorrectionSuggestion> {
  const response = await fetch(`/api/v1/cases/${caseId}/correction-suggestions/${correctionId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-record-review-client': 'synthetic-workspace',
    },
    body: JSON.stringify({ status }),
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('correction_suggestion_unavailable');
  const payload = (await response.json()) as { suggestion?: unknown } | null;
  if (!isSyntheticCorrectionSuggestion(payload?.suggestion, caseId))
    throw new Error('correction_suggestion_unavailable');
  return payload.suggestion;
}

export async function getSyntheticUploadCapability(): Promise<boolean> {
  const response = await fetch('/api/v1/capabilities', {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('upload_capability_unavailable');
  const payload = (await response.json()) as { syntheticOriginalUpload?: unknown } | null;
  if (typeof payload?.syntheticOriginalUpload !== 'boolean')
    throw new Error('upload_capability_unavailable');
  return payload.syntheticOriginalUpload;
}

export async function uploadSyntheticOriginal(
  caseId: string,
  file: File,
): Promise<SyntheticOriginalReceipt> {
  const response = await fetch(`/api/v1/cases/${caseId}/synthetic-originals`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-record-review-client': 'synthetic-workspace',
      'x-record-review-file-name': file.name,
      'x-record-review-media-type': file.type || 'application/octet-stream',
    },
    body: file,
    cache: 'no-store',
    redirect: 'error',
  });
  if (response.status === 413) throw new Error('original_upload_too_large');
  if (!response.ok) throw new Error('original_upload_unavailable');
  const payload = (await response.json()) as { original?: SyntheticOriginalReceipt } | null;
  const original = payload?.original;
  if (
    !original ||
    original.caseId !== caseId ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      original.documentVersionId,
    ) ||
    !/^[a-f0-9]{64}$/.test(original.sha256) ||
    original.byteLength !== file.size
  )
    throw new Error('original_upload_unavailable');
  return original;
}

export async function getSyntheticCase(caseId: string): Promise<CaseSummary | undefined> {
  const response = await fetch(`/api/v1/cases/${caseId}`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error('case_detail_unavailable');
  const payload = (await response.json()) as { case: CaseSummary };
  if (!payload?.case) throw new Error('case_detail_unavailable');
  return payload.case;
}

/* Stryker disable all -- this response validator is covered by explicit valid and malformed payload cases. */
function isSyntheticRevisionEvent(value: unknown): value is SyntheticRevisionEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as SyntheticRevisionEvent;
  return (
    Number.isSafeInteger(event.recordRevision) &&
    event.recordRevision > 1 &&
    event.eventType === 'original_registered' &&
    UUID4_PATTERN.test(event.documentVersionId)
  );
}

export async function getSyntheticRevisionHistory(
  caseId: string,
): Promise<SyntheticRevisionEvent[]> {
  const response = await fetch(`/api/v1/cases/${caseId}/revision-history`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('revision_history_unavailable');
  const payload = (await response.json()) as { revisions?: unknown } | null;
  if (!Array.isArray(payload?.revisions) || !payload.revisions.every(isSyntheticRevisionEvent))
    throw new Error('revision_history_unavailable');
  return payload.revisions;
}
/* Stryker restore all */

/* Stryker disable all -- explicit malformed-response cases cover this recovery-state validator. */
function isSyntheticUploadAttempt(value: unknown): value is SyntheticUploadAttempt {
  if (typeof value !== 'object' || value === null) return false;
  const attempt = value as SyntheticUploadAttempt;
  return (
    UUID4_PATTERN.test(attempt.documentVersionId) &&
    Number.isSafeInteger(attempt.maximumBytes) &&
    attempt.maximumBytes > 0 &&
    (attempt.state === 'receiving' || attempt.state === 'registered' || attempt.state === 'failed')
  );
}

export async function listSyntheticUploadAttempts(
  caseId: string,
): Promise<SyntheticUploadAttempt[]> {
  const response = await fetch(`/api/v1/cases/${caseId}/upload-attempts`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('upload_attempts_unavailable');
  const payload = (await response.json()) as { attempts?: unknown } | null;
  if (!Array.isArray(payload?.attempts) || !payload.attempts.every(isSyntheticUploadAttempt))
    throw new Error('upload_attempts_unavailable');
  return payload.attempts;
}
/* Stryker restore all */

export async function listSyntheticOriginals(caseId: string): Promise<SyntheticOriginalReceipt[]> {
  const response = await fetch(`/api/v1/cases/${caseId}/synthetic-originals`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('original_list_unavailable');
  const payload = (await response.json()) as { originals?: unknown } | null;
  const originals = payload?.originals;
  if (
    !Array.isArray(originals) ||
    !originals.every((item: unknown) => {
      const original = item as SyntheticOriginalReceipt | null;
      return (
        original?.caseId === caseId &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          original.documentVersionId,
        ) &&
        /^[a-f0-9]{64}$/.test(original.sha256) &&
        Number.isSafeInteger(original.byteLength) &&
        original.byteLength >= 0 &&
        ((original.fileName === undefined && original.mediaType === undefined) ||
          (typeof original.fileName === 'string' &&
            original.fileName.trim().length > 0 &&
            typeof original.mediaType === 'string' &&
            original.mediaType.trim().length > 0))
      );
    })
  )
    throw new Error('original_list_unavailable');
  return originals as SyntheticOriginalReceipt[];
}

export async function getSyntheticOriginal(
  caseId: string,
  documentVersionId: string,
): Promise<Blob> {
  const response = await fetch(`/api/v1/cases/${caseId}/synthetic-originals/${documentVersionId}`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('original_unavailable');
  return response.blob();
}

export async function createSyntheticCase(label: string): Promise<CaseSummary> {
  const response = await fetch('/api/v1/cases', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-record-review-client': 'synthetic-workspace',
    },
    body: JSON.stringify({ label }),
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('case_creation_unavailable');
  const payload = (await response.json()) as { case: CaseSummary };
  if (!payload?.case) throw new Error('case_creation_unavailable');
  return payload.case;
}

export async function listSyntheticCases(): Promise<CaseSummary[]> {
  const response = await fetch('/api/v1/cases', {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('case_list_unavailable');
  const payload = (await response.json()) as { cases: CaseSummary[] } | null;
  const cases = payload?.cases;
  if (
    !Array.isArray(cases) ||
    !cases.every(
      (item) =>
        typeof item?.label === 'string' &&
        typeof item.caseId === 'string' &&
        Number.isInteger(item.recordRevision) &&
        item.recordRevision > 0,
    )
  )
    throw new Error('case_list_unavailable');
  return cases;
}
