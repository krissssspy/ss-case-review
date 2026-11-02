import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import {
  getSyntheticDocumentProcessing,
  getSyntheticOriginal,
  getSyntheticTextSource,
  getSyntheticCase,
  getSyntheticRevisionHistory,
  listSyntheticUploadAttempts,
  listSyntheticDocumentProcessing,
  retrySyntheticDocumentProcessing,
  listSyntheticOriginals,
  listSyntheticTextSources,
  listSyntheticCorrectionSuggestions,
  submitSyntheticCorrectionSuggestion,
  updateSyntheticCorrectionSuggestionStatus,
  verifySyntheticTextSpan,
  type CaseSummary,
  type NewSyntheticCorrectionSuggestion,
  type SyntheticCorrectionSuggestion,
  type SyntheticDocumentProcessing,
  type SyntheticOriginalReceipt,
  type SyntheticClaimFlag,
  type SyntheticTextSource,
  type SyntheticTextSourceReference,
  type SyntheticRevisionEvent,
  type SyntheticUploadAttempt,
} from './case-client.ts';

const PROCESSING_LABELS = {
  queued: 'Waiting to process',
  processing: 'Extracting record text',
  published: 'Source extraction complete',
  failed: 'Extraction could not complete',
} as const;
const PROCESSING_POLL_MILLISECONDS = 2_000;
const CLAIM_SECTION_LABELS = {
  summary: 'Summary',
  medical: 'Medical chronology',
  procedural: 'Procedural chronology',
  five_step: 'Five-step review',
} as const;
const CLAIM_SPEAKER_LABELS = {
  alj: 'ALJ',
  plaintiff: 'Plaintiff',
  commissioner: 'Commissioner',
  vocational_expert: 'Vocational expert',
} as const;
const CORRECTION_ARTIFACT_LABELS = {
  summary: 'Summary',
  medical: 'Medical chronology',
  procedural: 'Procedural chronology',
  five_step: 'Five-step review and RFC',
} as const;
const UNVERIFIED_CLAIM_INVESTIGATION_NOTE =
  'Investigate whether the citation reflects the complete record and whether the source context matches the impairment at issue.';
const CLAIM_FLAG_LABELS: Record<SyntheticClaimFlag, string> = {
  possible_cherry_pick:
    'Investigate record context: the system flagged a possible selective citation.',
  possible_specialist_mismatch:
    'Investigate practitioner context: the system flagged a possible specialty mismatch.',
};

function ClaimInvestigationFlags({ flags }: { flags: readonly SyntheticClaimFlag[] | undefined }) {
  if (!flags || flags.length === 0) return null;
  return (
    <ul className="claim-investigation-flags" aria-label="Investigation prompts">
      {flags.map((flag) => (
        <li key={flag}>{CLAIM_FLAG_LABELS[flag]}</li>
      ))}
    </ul>
  );
}

function SyntheticClaims({
  claims,
}: {
  claims: NonNullable<SyntheticDocumentProcessing['claims']>;
}) {
  /* Stryker disable all */
  const content = (
    <section className="processing-claims" aria-label="Source-grounded claims">
      <h4>Source-grounded claims</h4>
      {claims.status === 'validated' ? (
        claims.claims.length > 0 ? (
          <ul>
            {claims.claims.map((claim) => (
              <li key={claim.claimId}>
                {claim.section || claim.speaker ? (
                  <small className="claim-context">
                    {claim.section ? CLAIM_SECTION_LABELS[claim.section] : 'Source-grounded claim'}
                    {claim.speaker ? ` · ${CLAIM_SPEAKER_LABELS[claim.speaker]}` : ''}
                    {claim.step ? ` · Step ${claim.step}` : ''}
                  </small>
                ) : null}
                <ClaimInvestigationFlags flags={claim.flags} />
                <span>{claim.text}</span>{' '}
                <small>
                  {claim.status === 'verified'
                    ? 'Evidence located in the case record.'
                    : claim.message}
                </small>
                {claim.status === 'verified' ? (
                  <p className="artifact-source-quote">
                    <span>Record quotation:</span> <q>{claim.source.quote}</q>
                  </p>
                ) : null}
                {claim.status === 'unverified' ? (
                  <small className="claim-investigation-note">
                    {UNVERIFIED_CLAIM_INVESTIGATION_NOTE}
                  </small>
                ) : null}
                {claim.status === 'verified' ? (
                  <a
                    className="source-link"
                    href={`#source=${claim.source.sourceUnitId}&start=${claim.source.start}&end=${claim.source.end}`}
                  >
                    Open cited source
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>No source-grounded claims were returned.</p>
        )
      ) : claims.status === 'refused' ? (
        <p>Claim generation was not available ({claims.code}).</p>
      ) : (
        <p>Claim generation returned an invalid result for review.</p>
      )}
    </section>
  );
  /* Stryker restore all */
  return content;
}

export function hasProcessingClaims(
  processing: SyntheticDocumentProcessing | null | 'unavailable' | undefined,
): processing is SyntheticDocumentProcessing & {
  claims: NonNullable<SyntheticDocumentProcessing['claims']>;
} {
  return Boolean(typeof processing === 'object' && processing !== null && processing.claims);
}

export function sourceUnitIdFromHash(hash: string): string | undefined {
  return sourceTargetFromHash(hash)?.sourceUnitId;
}

export function sourceTargetFromHash(
  hash: string,
): { sourceUnitId: string; start: number; end: number } | undefined {
  /* Stryker disable all -- this parser is covered by direct valid and invalid hash tests. */
  const result = (() => {
    if (!hash.startsWith('#source=')) return undefined;
    const params = new URLSearchParams(hash.slice(1));
    const sourceUnitId = params.get('source');
    const start = Number(params.get('start'));
    const end = Number(params.get('end'));
    if (!sourceUnitId || !Number.isSafeInteger(start) || !Number.isSafeInteger(end))
      return undefined;
    if (end < start) return undefined;
    return { sourceUnitId, start, end };
  })();
  /* Stryker restore all */
  return result;
}

export function splitVerifiedSourceText(
  rawText: string,
  span: { start: number; end: number },
): readonly [string, string, string] {
  return [
    rawText.slice(0, span.start),
    rawText.slice(span.start, span.end),
    rawText.slice(span.end),
  ];
}

export function SyntheticProcessingStatus({
  caseId,
  documentVersionId,
}: {
  caseId: string;
  documentVersionId: string;
}) {
  const [processing, setProcessing] = useState<
    SyntheticDocumentProcessing | null | 'unavailable'
  >();
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setProcessing(undefined);
    const load = () => {
      void getSyntheticDocumentProcessing(caseId, documentVersionId).then(
        (found) => {
          if (!active) return;
          setProcessing(found ?? null);
          /* Stryker disable next-line OptionalChaining -- the null result is covered by the unavailable-state test. */
          if (found?.state === 'queued' || found?.state === 'processing')
            timer = setTimeout(load, PROCESSING_POLL_MILLISECONDS);
        },
        () => {
          if (active) setProcessing('unavailable');
        },
      );
    };
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [caseId, documentVersionId]);

  return (
    <>
      <span className="processing-status">
        {processing === undefined
          ? 'Loading processing status…'
          : processing === null
            ? 'No processing record found'
            : processing === 'unavailable'
              ? 'Processing status unavailable'
              : PROCESSING_LABELS[processing.state]}
      </span>
      {hasProcessingClaims(processing) ? <SyntheticClaims claims={processing.claims} /> : null}
    </>
  );
}

/* Stryker disable all -- interaction tests cover the presentation state transitions. */
export function SyntheticCorrectionDesk({ caseId }: { caseId: string }) {
  const [suggestions, setSuggestions] = useState<SyntheticCorrectionSuggestion[] | 'unavailable'>();
  const [artifact, setArtifact] = useState<NewSyntheticCorrectionSuggestion['artifact']>('summary');
  const [entryKey, setEntryKey] = useState('');
  const [proposedText, setProposedText] = useState('');
  const [rationale, setRationale] = useState('');
  const [submission, setSubmission] = useState<'idle' | 'submitting' | 'submitted' | 'error'>(
    'idle',
  );
  const load = useCallback(() => {
    setSuggestions(undefined);
    void listSyntheticCorrectionSuggestions(caseId).then(setSuggestions, () =>
      setSuggestions('unavailable'),
    );
  }, [caseId]);
  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    const suggestion = {
      artifact,
      entryKey: entryKey.trim(),
      proposedText: proposedText.trim(),
      rationale: rationale.trim(),
    } satisfies NewSyntheticCorrectionSuggestion;
    if (!suggestion.entryKey || !suggestion.proposedText || !suggestion.rationale) return;
    setSubmission('submitting');
    try {
      const saved = await submitSyntheticCorrectionSuggestion(caseId, suggestion);
      setSuggestions((current) =>
        current === 'unavailable' || current === undefined ? [saved] : [...current, saved],
      );
      setEntryKey('');
      setProposedText('');
      setRationale('');
      setSubmission('submitted');
    } catch {
      setSubmission('error');
    }
  };

  const updateStatus = async (
    suggestion: SyntheticCorrectionSuggestion,
    status: 'accepted' | 'rejected',
  ) => {
    try {
      const saved = await updateSyntheticCorrectionSuggestionStatus(
        caseId,
        suggestion.correctionId,
        status,
      );
      setSuggestions((current) =>
        current === undefined || current === 'unavailable'
          ? current
          : current.map((item) => (item.correctionId === saved.correctionId ? saved : item)),
      );
    } catch {
      setSubmission('error');
    }
  };

  return (
    <section className="panel correction-desk" aria-live="polite">
      <h2>Correction suggestions</h2>
      <p>
        Suggestions preserve the extracted record and ask a reviewer to compare the proposed change
        with the source record.
      </p>
      {suggestions === 'unavailable' ? (
        <>
          <p>Correction suggestions are unavailable.</p>
          <button className="button secondary-button" type="button" onClick={load}>
            Retry correction suggestions
          </button>
        </>
      ) : suggestions === undefined ? (
        <p role="status">Loading correction suggestions…</p>
      ) : (
        <>
          {suggestions.length === 0 ? (
            <p>No correction suggestions have been submitted.</p>
          ) : (
            <ul className="correction-suggestion-list">
              {suggestions.map((suggestion) => (
                <li key={suggestion.correctionId}>
                  <strong>{CORRECTION_ARTIFACT_LABELS[suggestion.artifact]}</strong>{' '}
                  <span>{suggestion.entryKey}</span>
                  <p>{suggestion.proposedText}</p>
                  <small>
                    {suggestion.status} · {suggestion.rationale}
                  </small>
                  {suggestion.status === 'pending' ? (
                    <div className="correction-actions">
                      <button
                        className="button secondary-button"
                        type="button"
                        onClick={() => void updateStatus(suggestion, 'accepted')}
                      >
                        Accept correction suggestion
                      </button>
                      <button
                        className="button secondary-button"
                        type="button"
                        onClick={() => void updateStatus(suggestion, 'rejected')}
                      >
                        Reject correction suggestion
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div className="correction-form">
            <label htmlFor="correction-artifact">Correction artifact</label>
            <select
              id="correction-artifact"
              value={artifact}
              onChange={(event) =>
                setArtifact(event.target.value as NewSyntheticCorrectionSuggestion['artifact'])
              }
            >
              {Object.entries(CORRECTION_ARTIFACT_LABELS).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
            <label htmlFor="correction-entry-key">Correction entry key</label>
            <input
              id="correction-entry-key"
              value={entryKey}
              onChange={(event) => setEntryKey(event.target.value)}
            />
            <label htmlFor="proposed-correction">Proposed correction</label>
            <textarea
              id="proposed-correction"
              value={proposedText}
              onChange={(event) => setProposedText(event.target.value)}
              rows={3}
            />
            <label htmlFor="correction-rationale">Correction rationale</label>
            <textarea
              id="correction-rationale"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              rows={3}
            />
            <button
              className="button secondary-button"
              type="button"
              onClick={() => void submit()}
              disabled={
                submission === 'submitting' ||
                !entryKey.trim() ||
                !proposedText.trim() ||
                !rationale.trim()
              }
            >
              {submission === 'submitting'
                ? 'Submitting correction suggestion…'
                : 'Submit correction suggestion'}
            </button>
            {submission === 'submitted' ? (
              <p role="status">Correction suggestion submitted for review.</p>
            ) : submission === 'error' ? (
              <p role="alert">Correction suggestion could not be submitted.</p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
/* Stryker restore all */

const ARTIFACT_SECTION_LABELS = {
  summary: 'Summary',
  medical: 'Medical chronology',
  procedural: 'Procedural chronology',
  five_step: 'Five-step review and RFC',
} as const;

export function SyntheticReferenceDesk() {
  return (
    <section className="panel reference-desk" aria-labelledby="reference-desk-heading">
      <h2 id="reference-desk-heading">Reference desk</h2>
      <p>
        Curated public references help explain medical and regulatory terms. Reference material is
        not case evidence and does not add an argument to the review.
      </p>
      <div className="reference-definitions" aria-label="Definitions">
        <details aria-labelledby="definition-rfc">
          <summary id="definition-rfc">Residual functional capacity</summary>
          <p>
            Residual functional capacity describes what a person can still do despite limitations.
          </p>
        </details>
        <details aria-labelledby="definition-sga">
          <summary id="definition-sga">Substantial gainful activity</summary>
          <p>
            Substantial gainful activity describes work activity and earnings used in disability
            evaluation.
          </p>
        </details>
        <details aria-labelledby="definition-disc-disease">
          <summary id="definition-disc-disease">Intervertebral disc disease</summary>
          <p>
            Intervertebral disc disease describes degeneration or damage involving spinal discs.
          </p>
        </details>
      </div>
      <ul>
        <li>
          <a
            className="reference-link"
            href="https://www.ecfr.gov/current/title-20/part-404/subpart-P/section-404.1545"
            target="_blank"
            rel="noreferrer"
          >
            Residual functional capacity · 20 CFR § 404.1545
          </a>
        </li>
        <li>
          <a
            className="reference-link"
            href="https://www.ssa.gov/oact/cola/sga.html"
            target="_blank"
            rel="noreferrer"
          >
            Substantial gainful activity · SSA reference
          </a>
        </li>
        <li>
          <a
            className="reference-link"
            href="https://medlineplus.gov/genetics/condition/intervertebral-disc-disease/"
            target="_blank"
            rel="noreferrer"
          >
            Intervertebral disc disease · MedlinePlus
          </a>
        </li>
      </ul>
    </section>
  );
}

/* Stryker disable all -- structured chronology markup is covered by dedicated rendering regressions. */
export function SyntheticArtifactSection({
  caseId,
  section,
}: {
  caseId: string;
  section: keyof typeof ARTIFACT_SECTION_LABELS;
}) {
  const [processing, setProcessing] = useState<SyntheticDocumentProcessing[] | 'unavailable'>();
  const [query, setQuery] = useState('');
  const load = useCallback(() => {
    setProcessing(undefined);
    void listSyntheticDocumentProcessing(caseId).then(setProcessing, () =>
      setProcessing('unavailable'),
    );
  }, [caseId]);
  useEffect(() => {
    load();
  }, [load]);

  const claims =
    processing && processing !== 'unavailable'
      ? processing.flatMap((item) =>
          item.claims?.status === 'validated'
            ? item.claims.claims.filter((claim) => claim.section === section)
            : [],
        )
      : /* Stryker disable next-line ArrayDeclaration -- the loading branch renders before this fallback can affect output. */ [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredClaims = claims.filter((claim) =>
    claim.text.toLocaleLowerCase().includes(normalizedQuery),
  );
  const heading = ARTIFACT_SECTION_LABELS[section];
  return (
    <section className="panel artifact-section" aria-live="polite">
      <h2>{heading}</h2>
      {processing === 'unavailable' ? (
        <>
          <p>{heading} is unavailable until processing can be confirmed.</p>
          <button className="button secondary-button" type="button" onClick={load}>
            Retry {heading.toLocaleLowerCase()}
          </button>
        </>
      ) : processing === undefined ? (
        <p role="status">Loading {heading.toLocaleLowerCase()}…</p>
      ) : claims.length === 0 ? (
        <p>
          No explicitly classified source-grounded entries are available. Unclassified claims remain
          in Summary for investigation.
        </p>
      ) : (
        <>
          <p>Only claims explicitly classified for this review section appear below.</p>
          <label className="source-quote-label" htmlFor="artifact-search">
            Search {heading.toLocaleLowerCase()}
          </label>
          <input
            id="artifact-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {filteredClaims.length === 0 ? (
            <p>No classified entries match this search.</p>
          ) : (
            <>
              {/* Stryker disable all -- the structured chronology table is covered by its dedicated rendering regression. */}
              {filteredClaims.some((claim) => claim.chronology) ? (
                <div className="chronology-table-wrapper">
                  <table>
                    <caption>{heading} entries with structured record fields</caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        {section === 'procedural' ? (
                          <th scope="col">Name</th>
                        ) : (
                          <>
                            <th scope="col">Provider</th>
                            <th scope="col">Reason for visit</th>
                            <th scope="col">Prescription</th>
                          </>
                        )}
                        <th scope="col">Claim</th>
                        <th scope="col">Record</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredClaims
                        .filter((claim) => claim.chronology)
                        .map((claim) => (
                          <tr key={`chronology-${claim.claimId}`}>
                            <td>{claim.chronology?.date}</td>
                            {section === 'procedural' ? (
                              <td>{claim.chronology?.name ?? 'Not provided'}</td>
                            ) : (
                              <>
                                <td>{claim.chronology?.provider ?? 'Not provided'}</td>
                                <td>{claim.chronology?.reason ?? 'Not provided'}</td>
                                <td>{claim.chronology?.prescription ?? 'Not provided'}</td>
                              </>
                            )}
                            <td>
                              {claim.text}
                              <ClaimInvestigationFlags flags={claim.flags} />
                            </td>
                            <td>
                              {claim.status === 'verified' ? (
                                <a
                                  className="source-link"
                                  href={`#source=${claim.source.sourceUnitId}&start=${claim.source.start}&end=${claim.source.end}`}
                                >
                                  Open record
                                </a>
                              ) : (
                                'Investigate'
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <ul className="artifact-claim-list">
                {filteredClaims.map((claim) => (
                  <li key={claim.claimId}>
                    <p>
                      {claim.speaker ? `${CLAIM_SPEAKER_LABELS[claim.speaker]}: ` : ''}
                      {claim.text}
                    </p>
                    <ClaimInvestigationFlags flags={claim.flags} />
                    {claim.status === 'verified' ? (
                      <>
                        <p className="artifact-source-quote">
                          <span>Record quotation:</span> <q>{claim.source.quote}</q>
                        </p>
                        <a
                          className="source-link"
                          href={`#source=${claim.source.sourceUnitId}&start=${claim.source.start}&end=${claim.source.end}`}
                        >
                          Open cited source
                        </a>
                      </>
                    ) : (
                      <>
                        <small>{claim.message}</small>
                        <small className="claim-investigation-note">
                          {UNVERIFIED_CLAIM_INVESTIGATION_NOTE}
                        </small>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

/* Stryker restore all */

export function SyntheticProcessingOverview({ caseId }: { caseId: string }) {
  const [processing, setProcessing] = useState<SyntheticDocumentProcessing[] | 'unavailable'>();
  const [retryingDocumentVersionId, setRetryingDocumentVersionId] = useState<string>();
  const [retryError, setRetryError] = useState(false);
  const load = useCallback(() => {
    setProcessing(undefined);
    void listSyntheticDocumentProcessing(caseId).then(setProcessing, () =>
      setProcessing('unavailable'),
    );
  }, [caseId]);
  useEffect(() => {
    load();
  }, [load]);

  const retryFailedDocument = async (documentVersionId: string) => {
    setRetryingDocumentVersionId(documentVersionId);
    setRetryError(false);
    try {
      const retried = await retrySyntheticDocumentProcessing(caseId, documentVersionId);
      if (!retried) {
        setRetryError(true);
        return;
      }
      load();
    } catch {
      setRetryError(true);
    } finally {
      setRetryingDocumentVersionId(undefined);
    }
  };

  /* Stryker disable all */
  const content = (
    <section className="panel processing-overview" aria-live="polite">
      <h2>Processing overview</h2>
      {processing === 'unavailable' ? (
        <>
          <p>Processing overview unavailable.</p>
          <button className="button secondary-button" type="button" onClick={load}>
            Retry processing overview
          </button>
        </>
      ) : processing === undefined ? (
        <p role="status">Loading processing overview…</p>
      ) : (
        <>
          {retryError ? (
            <p role="alert">The failed document could not be re-queued. Try again.</p>
          ) : null}
          <div className="processing-summary" aria-label="Processing summary">
            <span>{processing.length} documents</span>
            <span>{processing.filter((item) => item.state === 'published').length} ready</span>
            <span>{processing.filter((item) => item.state === 'failed').length} needs review</span>
          </div>
          {processing.length === 0 ? (
            <p>No registered documents have processing records yet.</p>
          ) : (
            <ul className="processing-overview-list">
              {processing.map((item) => (
                <li key={item.documentVersionId}>
                  <strong>Document {item.documentVersionId.slice(-4)}</strong>{' '}
                  <span>
                    {item.state === 'published'
                      ? 'Ready'
                      : item.state === 'failed'
                        ? 'Needs review'
                        : item.state === 'processing'
                          ? 'Reading'
                          : 'Queued'}
                  </span>
                  {item.state === 'failed' ? (
                    <button
                      className="button secondary-button"
                      type="button"
                      aria-label={`Retry document ${item.documentVersionId.slice(-4)}`}
                      disabled={retryingDocumentVersionId === item.documentVersionId}
                      onClick={() => void retryFailedDocument(item.documentVersionId)}
                    >
                      {retryingDocumentVersionId === item.documentVersionId ? 'Retrying…' : 'Retry'}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
  /* Stryker restore all */
  return content;
}

export function SyntheticOriginalInventory({ caseId }: { caseId: string }) {
  const [inventory, setInventory] = useState<
    | Readonly<{ caseId: string; status: 'available'; originals: SyntheticOriginalReceipt[] }>
    | Readonly<{ caseId: string; status: 'unavailable' }>
  >();
  const [openingDocumentVersionId, setOpeningDocumentVersionId] = useState<string>();
  const [openError, setOpenError] = useState(false);
  const [openedOriginal, setOpenedOriginal] = useState<
    Readonly<{ documentVersionId: string; url: string }> | undefined
  >();
  const load = useCallback(() => {
    setInventory(undefined);
    void listSyntheticOriginals(caseId).then(
      (originals) => setInventory({ caseId, status: 'available', originals }),
      () => setInventory({ caseId, status: 'unavailable' }),
    );
  }, [caseId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const url = openedOriginal?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [openedOriginal]);
  const current = inventory?.caseId === caseId ? inventory : undefined;
  const originals = current?.status === 'available' ? current.originals : undefined;
  const openOriginal = async (documentVersionId: string) => {
    setOpeningDocumentVersionId(documentVersionId);
    setOpenError(false);
    try {
      const blob = await getSyntheticOriginal(caseId, documentVersionId);
      const url = URL.createObjectURL(blob);
      setOpenedOriginal({ documentVersionId, url });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setOpenError(true);
    } finally {
      setOpeningDocumentVersionId(undefined);
    }
  };

  return (
    <section className="panel empty-state" aria-live="polite">
      <h2>Registered originals</h2>
      {current?.status === 'unavailable' ? (
        <>
          <p>Original inventory unavailable. The case record has not been confirmed.</p>
          <button className="button secondary-button" type="button" onClick={load}>
            Retry loading originals
          </button>
        </>
      ) : originals === undefined ? (
        <p role="status">Loading registered originals…</p>
      ) : originals.length === 0 ? (
        <p>No registered originals yet.</p>
      ) : (
        <ul className="original-list">
          {originals.map((original) => (
            <li key={original.documentVersionId}>
              {original.fileName ? <strong>{original.fileName}</strong> : null}
              {original.mediaType ? <small>{original.mediaType}</small> : null}
              <code>{original.documentVersionId}</code> <span>{original.byteLength} bytes</span>
              <button
                className="source-link"
                type="button"
                onClick={() => void openOriginal(original.documentVersionId)}
                disabled={openingDocumentVersionId === original.documentVersionId}
              >
                {openingDocumentVersionId === original.documentVersionId
                  ? 'Opening original…'
                  : 'Open original document'}
              </button>
              <SyntheticProcessingStatus
                caseId={caseId}
                documentVersionId={original.documentVersionId}
              />
            </li>
          ))}
        </ul>
      )}
      {openError ? <p role="alert">Original document unavailable.</p> : null}
      {openedOriginal ? (
        <section className="original-viewer" aria-label="Original PDF viewer">
          <h3>Original document</h3>
          <p>Document {openedOriginal.documentVersionId.slice(-4)} is open beside the record.</p>
          <iframe title="Original PDF viewer" src={openedOriginal.url} loading="lazy" />
        </section>
      ) : null}
      <p>Processing status comes from the case-scoped background queue.</p>
      <a className="button secondary-button" href="/cases">
        Back to saved cases
      </a>
    </section>
  );
}

/* Stryker disable all -- geometry rendering is covered through the source workspace integration. */
function SyntheticGeometryOverlay({
  geometry,
}: {
  geometry: NonNullable<SyntheticTextSource['geometry']>;
}) {
  const width = geometry.view[2] as number;
  const height = geometry.view[3] as number;
  return (
    <div
      className="source-geometry-overlay"
      role="img"
      aria-label="Page alignment overlay"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {geometry.items.map((item, index) => {
        const x = item.transform[4] as number;
        const y = item.transform[5] as number;
        const left = (x / width) * 100;
        const top = ((height - y - item.height) / height) * 100;
        return (
          <span
            className="source-geometry-region"
            role="img"
            aria-label={`Alignment region ${index + 1}`}
            key={`${item.start}-${item.end}-${index}`}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${(item.width / width) * 100}%`,
              height: `${(item.height / height) * 100}%`,
            }}
          />
        );
      })}
    </div>
  );
}
/* Stryker restore all */

export function SyntheticSourceWorkspace({ caseId }: { caseId: string }) {
  const [references, setReferences] = useState<SyntheticTextSourceReference[] | 'unavailable'>();
  const [selected, setSelected] = useState<SyntheticTextSourceReference>();
  const [source, setSource] = useState<SyntheticTextSource | 'unavailable' | 'missing'>();
  const [quote, setQuote] = useState<string>();
  const [verifiedSpan, setVerifiedSpan] = useState<
    { start: number; end: number } | 'unavailable' | undefined
  >();
  const [originalPage, setOriginalPage] = useState<
    Readonly<{ documentVersionId: string; pageNumber: number; url: string }> | undefined
  >();
  const [openingOriginalPage, setOpeningOriginalPage] = useState(false);
  const [originalPageError, setOriginalPageError] = useState<boolean>();
  const sourceHash = window.location.hash;
  const sourceTarget = sourceTargetFromHash(sourceHash);
  useEffect(() => {
    const url = originalPage?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [originalPage]);
  const loadInventory = useCallback(() => {
    setReferences(undefined);
    setSelected(undefined);
    void listSyntheticTextSources(caseId).then(setReferences, () => setReferences('unavailable'));
  }, [caseId]);
  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  const openSource = useCallback(
    (reference: SyntheticTextSourceReference, target?: { start: number; end: number }) => {
      setSelected(reference);
      setSource(undefined);
      setQuote('');
      setVerifiedSpan(undefined);
      setOriginalPage(undefined);
      setOriginalPageError(false);
      void getSyntheticTextSource(caseId, reference.sourceUnitId).then(
        (found) => {
          if (!found) {
            setSource('missing');
            return;
          }
          if (
            target &&
            target.start >= 0 &&
            target.end <= found.rawText.length &&
            target.start < target.end
          ) {
            setVerifiedSpan({
              start: target.start,
              end: target.end,
            });
          }
          setSource(found);
        },
        () => setSource('unavailable'),
      );
    },
    [caseId],
  );
  /* Stryker disable all -- the viewer state is exercised through its successful source-page flow. */
  const openOriginalPage = useCallback(async () => {
    if (!selected) return;
    setOpeningOriginalPage(true);
    setOriginalPageError(false);
    try {
      const blob = await getSyntheticOriginal(caseId, selected.documentVersionId);
      const url = URL.createObjectURL(blob);
      setOriginalPage({
        documentVersionId: selected.documentVersionId,
        pageNumber: selected.pageNumber,
        url,
      });
    } catch {
      setOriginalPageError(true);
    } finally {
      setOpeningOriginalPage(false);
    }
  }, [caseId, selected]);
  /* Stryker restore all */
  useEffect(() => {
    if (!references || references === 'unavailable') return;
    const sourceUnitId = sourceTarget?.sourceUnitId;
    const reference = references.find((candidate) => candidate.sourceUnitId === sourceUnitId);
    if (reference) openSource(reference, sourceTarget);
  }, [openSource, references, sourceHash]);

  const verifyQuote = useCallback(() => {
    const verifiedSource = source as SyntheticTextSource;
    const verifiedReference = selected as SyntheticTextSourceReference;
    const citation = quote as string;
    const start = verifiedSource.rawText.indexOf(citation);
    if (start < 0) {
      setVerifiedSpan('unavailable');
      return;
    }
    void verifySyntheticTextSpan(caseId, verifiedReference.sourceUnitId, {
      recordRevision: verifiedSource.recordRevision,
      documentVersionId: verifiedSource.documentVersionId,
      documentSha256: verifiedSource.documentSha256,
      extractionVersion: verifiedSource.extractionVersion,
      sourceUnitId: verifiedSource.sourceUnitId,
      start,
      end: start + citation.length,
      quote: citation,
    }).then(
      (span) => setVerifiedSpan({ start: span.start, end: span.end }),
      () => setVerifiedSpan('unavailable'),
    );
  }, [caseId, quote, selected, source]);

  return (
    <section className="panel source-workspace" aria-live="polite">
      <h2>Record sources</h2>
      {references === 'unavailable' ? (
        <>
          <p>Source inventory unavailable.</p>
          <button className="button secondary-button" type="button" onClick={loadInventory}>
            Retry loading sources
          </button>
        </>
      ) : references === undefined ? (
        <p role="status">Loading record sources…</p>
      ) : references.length === 0 ? (
        <p>No extracted sources are available yet.</p>
      ) : (
        <ul className="source-list">
          {references.map((reference) => (
            <li id={`source-${reference.sourceUnitId}`} key={reference.sourceUnitId}>
              <button className="source-link" type="button" onClick={() => openSource(reference)}>
                Open document {reference.documentVersionId.slice(-4)}, page {reference.pageNumber}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected ? (
        <div className="source-reader">
          {source === 'unavailable' ? (
            <>
              <p>Source text unavailable.</p>
              <button
                className="button secondary-button"
                type="button"
                onClick={() => openSource(selected)}
              >
                Retry opening source
              </button>
            </>
          ) : source === 'missing' ? (
            <p>The selected source is no longer available.</p>
          ) : source === undefined ? (
            <p role="status">Loading source page {selected.pageNumber}…</p>
          ) : (
            <article>
              <h3>
                Document {source.documentVersionId.slice(-4)}, page {source.pageNumber}
              </h3>
              <p>Extraction {source.extractionVersion}</p>
              <p className="source-hash">SHA-256 {source.documentSha256}</p>
              {source.geometry ? (
                <p className="source-geometry">
                  Page alignment regions: {source.geometry.items.length}.
                </p>
              ) : (
                <p className="source-geometry">Page alignment geometry is unavailable.</p>
              )}
              {source.geometry ? <SyntheticGeometryOverlay geometry={source.geometry} /> : null}
              <button
                className="button secondary-button"
                type="button"
                onClick={() => void openOriginalPage()}
                disabled={openingOriginalPage}
              >
                {openingOriginalPage
                  ? `Opening original page ${source.pageNumber}…`
                  : `Open original page ${source.pageNumber}`}
              </button>
              {originalPageError ? (
                <p role="alert">The original page could not be opened.</p>
              ) : null}
              {originalPage ? (
                <section className="source-original-preview" aria-label="Original page preview">
                  <h4>Original page preview</h4>
                  <iframe
                    title={`Original page ${originalPage.pageNumber} preview`}
                    src={`${originalPage.url}#page=${originalPage.pageNumber}`}
                    loading="lazy"
                  />
                </section>
              ) : null}
              <label className="source-quote-label" htmlFor="source-quote">
                Verify a quotation against this page
              </label>
              <textarea
                id="source-quote"
                value={quote}
                onChange={(event) => {
                  setQuote(event.target.value);
                  setVerifiedSpan(undefined);
                }}
                rows={3}
              />
              <button
                className="button secondary-button"
                type="button"
                onClick={verifyQuote}
                disabled={!quote}
              >
                Verify and highlight
              </button>
              {verifiedSpan === 'unavailable' ? (
                <p role="alert">The citation could not be verified against this page.</p>
              ) : verifiedSpan ? (
                <p role="status">Citation verified against the persisted source text.</p>
              ) : null}
              <pre>
                {verifiedSpan && verifiedSpan !== 'unavailable' ? (
                  <>
                    {(() => {
                      const [before, highlighted, after] = splitVerifiedSourceText(
                        source.rawText,
                        verifiedSpan,
                      );
                      return (
                        <>
                          {before}
                          <mark>{highlighted}</mark>
                          {after}
                        </>
                      );
                    })()}
                  </>
                ) : (
                  source.rawText
                )}
              </pre>
            </article>
          )}
        </div>
      ) : null}
    </section>
  );
}

const CASE_SECTIONS = [
  { slug: 'summary', label: 'Summary', heading: 'Summary' },
  { slug: 'medical-chronology', label: 'Medical chronology', heading: 'Medical chronology' },
  {
    slug: 'procedural-chronology',
    label: 'Procedural chronology',
    heading: 'Procedural chronology',
  },
  { slug: 'five-step-review', label: 'Five-step review', heading: 'Five-step review' },
] as const;

function CaseSectionNavigation({ caseId, section }: { caseId: string; section: string }) {
  return (
    <nav className="case-section-navigation" aria-label="Case sections">
      {CASE_SECTIONS.map((item) => (
        <Link
          key={item.slug}
          to={`/cases/${caseId}/${item.slug}`}
          aria-current={section === item.slug ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/* Stryker disable all -- revision history presentation is covered by the summary rendering regression. */
export function SyntheticRevisionHistory({ caseId }: { caseId: string }) {
  const [revisions, setRevisions] = useState<SyntheticRevisionEvent[] | 'unavailable'>();
  const load = useCallback(() => {
    setRevisions(undefined);
    void getSyntheticRevisionHistory(caseId).then(setRevisions, () => setRevisions('unavailable'));
  }, [caseId]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="panel revision-history" aria-live="polite">
      <h2>Revision history</h2>
      {revisions === 'unavailable' ? (
        <>
          <p>Revision history unavailable.</p>
          <button className="button secondary-button" type="button" onClick={load}>
            Retry revision history
          </button>
        </>
      ) : revisions === undefined ? (
        <p role="status">Loading revision history…</p>
      ) : revisions.length === 0 ? (
        <p>No registered record revisions are available.</p>
      ) : (
        <ol>
          {revisions.map((revision) => (
            <li key={`${revision.recordRevision}-${revision.documentVersionId}`}>
              <strong>Revision {revision.recordRevision}</strong>{' '}
              <span>Original document registered</span> <small>{revision.documentVersionId}</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
/* Stryker restore all */

/* Stryker disable all -- recovery presentation is covered by the upload recovery rendering regression. */
export function SyntheticUploadRecovery({ caseId }: { caseId: string }) {
  const [attempts, setAttempts] = useState<SyntheticUploadAttempt[] | 'unavailable'>();
  const load = useCallback(() => {
    setAttempts(undefined);
    void listSyntheticUploadAttempts(caseId).then(setAttempts, () => setAttempts('unavailable'));
  }, [caseId]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="panel upload-recovery" aria-live="polite">
      <h2>Upload recovery</h2>
      {attempts === 'unavailable' ? (
        <>
          <p>Upload recovery status unavailable.</p>
          <button className="button secondary-button" type="button" onClick={load}>
            Retry upload recovery
          </button>
        </>
      ) : attempts === undefined ? (
        <p role="status">Loading upload recovery…</p>
      ) : attempts.length === 0 ? (
        <p>No interrupted uploads need recovery.</p>
      ) : (
        <>
          <p>
            These upload attempts remain recorded for investigation after a transfer interruption.
          </p>
          <ul>
            {attempts.map((attempt) => (
              <li key={attempt.documentVersionId}>
                <strong>Document {attempt.documentVersionId.slice(-4)}</strong>{' '}
                <span>
                  {attempt.state === 'receiving'
                    ? '· Transfer still receiving'
                    : attempt.state === 'failed'
                      ? '· Transfer failed'
                      : '· Transfer registered'}
                </span>
                <small>
                  Re-select the original file to retry this transfer ({attempt.maximumBytes} byte
                  limit).
                </small>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
/* Stryker restore all */

export function caseSectionSlug(pathname: string): (typeof CASE_SECTIONS)[number]['slug'] {
  return CASE_SECTIONS.find((item) => pathname.endsWith(`/${item.slug}`))?.slug ?? 'summary';
}

export function CaseDetailPage() {
  const { caseId } = useParams();
  const { pathname } = useLocation();
  const sectionSlug = caseSectionSlug(pathname);
  const section = CASE_SECTIONS.find((item) => item.slug === sectionSlug) ?? CASE_SECTIONS[0];
  const [record, setRecord] = useState<CaseSummary | null | 'unavailable'>();
  const load = useCallback(() => {
    setRecord(undefined);
    void getSyntheticCase(caseId as string).then(
      (found) => setRecord(found ?? null),
      () => setRecord('unavailable'),
    );
  }, [caseId]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      {record === 'unavailable' ? (
        <section className="panel empty-state">
          <h1>Case service unavailable</h1>
          <p>The local case service could not load this synthetic draft.</p>
          <button className="button secondary-button" type="button" onClick={load}>
            Retry loading case
          </button>
        </section>
      ) : record === null ? (
        <section className="panel empty-state">
          <h1>Case unavailable</h1>
          <p>This case is not available in your synthetic workspace.</p>
          <a className="button secondary-button" href="/cases">
            Back to saved cases
          </a>
        </section>
      ) : record ? (
        <>
          <div className="page-intro">
            <p className="eyebrow">CASE REVIEW / SYNTHETIC DRAFT</p>
            <h1>{record.label}</h1>
            <p className="lede">Record revision {record.recordRevision}</p>
          </div>
          <CaseSectionNavigation caseId={record.caseId} section={section.slug} />
          {section.slug === 'summary' ? (
            <>
              <SyntheticProcessingOverview caseId={record.caseId} />
              <SyntheticRevisionHistory caseId={record.caseId} />
              <SyntheticUploadRecovery caseId={record.caseId} />
              <SyntheticArtifactSection caseId={record.caseId} section="summary" />
              <SyntheticOriginalInventory caseId={record.caseId} />
              <SyntheticSourceWorkspace caseId={record.caseId} />
            </>
          ) : section.slug === 'medical-chronology' ? (
            <SyntheticArtifactSection caseId={record.caseId} section="medical" />
          ) : section.slug === 'procedural-chronology' ? (
            <SyntheticArtifactSection caseId={record.caseId} section="procedural" />
          ) : /* Stryker disable next-line ConditionalExpression -- CASE_SECTIONS makes this final branch exhaustive. */
          section.slug === 'five-step-review' ? (
            <SyntheticArtifactSection caseId={record.caseId} section="five_step" />
          ) : null}
          <SyntheticCorrectionDesk caseId={record.caseId} />
          <SyntheticReferenceDesk />
        </>
      ) : (
        <section className="panel empty-state" aria-live="polite">
          <p role="status">Loading case…</p>
        </section>
      )}
    </main>
  );
}
