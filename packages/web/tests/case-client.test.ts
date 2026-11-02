import { afterEach, expect, test, vi } from 'vitest';
import {
  createSyntheticCase,
  getSyntheticDocumentProcessing,
  retrySyntheticDocumentProcessing,
  getSyntheticOriginal,
  getSyntheticUploadCapability,
  getSyntheticCase,
  getSyntheticTextSource,
  verifySyntheticTextSpan,
  listSyntheticCases,
  listSyntheticOriginals,
  listSyntheticTextSources,
  listSyntheticDocumentProcessing,
  uploadSyntheticOriginal,
  submitSyntheticCorrectionSuggestion,
  listSyntheticCorrectionSuggestions,
  updateSyntheticCorrectionSuggestionStatus,
  getSyntheticRevisionHistory,
  listSyntheticUploadAttempts,
} from '../src/case-client.ts';

afterEach(() => vi.unstubAllGlobals());

test('submits and lists validated revision-scoped correction suggestions', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const suggestion = {
    correctionId: '00000000-0000-4000-8000-000000000041',
    caseId,
    recordRevision: 1,
    artifact: 'medical' as const,
    entryKey: '2024-01-12|North Clinic|follow-up',
    proposedText: 'The provider recorded an improved range of motion.',
    rationale: 'The source page uses the phrase improved range of motion.',
    status: 'pending' as const,
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ suggestion }) })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ suggestions: [suggestion] }),
    });
  vi.stubGlobal('fetch', fetch);

  await expect(
    submitSyntheticCorrectionSuggestion(caseId, {
      artifact: suggestion.artifact,
      entryKey: suggestion.entryKey,
      proposedText: suggestion.proposedText,
      rationale: suggestion.rationale,
    }),
  ).resolves.toEqual(suggestion);
  await expect(listSyntheticCorrectionSuggestions(caseId)).resolves.toEqual([suggestion]);
  expect(fetch).toHaveBeenNthCalledWith(
    1,
    `/api/v1/cases/${caseId}/correction-suggestions`,
    expect.objectContaining({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-record-review-client': 'synthetic-workspace',
      },
      cache: 'no-store',
      redirect: 'error',
    }),
  );
  expect(fetch).toHaveBeenNthCalledWith(2, `/api/v1/cases/${caseId}/correction-suggestions`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });

  const invalidSuggestionPayloads = [
    null,
    {},
    { suggestion: { ...suggestion, correctionId: 'not-a-uuid' } },
    { suggestion: { ...suggestion, caseId: '00000000-0000-4000-8000-000000000003' } },
    { suggestion: { ...suggestion, recordRevision: 0 } },
    { suggestion: { ...suggestion, artifact: 1 } },
    { suggestion: { ...suggestion, artifact: 'unknown' } },
    { suggestion: { ...suggestion, entryKey: 1 } },
    { suggestion: { ...suggestion, entryKey: '' } },
    { suggestion: { ...suggestion, entryKey: 'x'.repeat(257) } },
    { suggestion: { ...suggestion, entryKey: '   ' } },
    { suggestion: { ...suggestion, proposedText: 1 } },
    { suggestion: { ...suggestion, proposedText: '' } },
    { suggestion: { ...suggestion, proposedText: 'x'.repeat(4001) } },
    { suggestion: { ...suggestion, proposedText: '   ' } },
    { suggestion: { ...suggestion, rationale: 1 } },
    { suggestion: { ...suggestion, rationale: '' } },
    { suggestion: { ...suggestion, rationale: '   ' } },
    { suggestion: { ...suggestion, rationale: 'x'.repeat(4001) } },
    { suggestion: { ...suggestion, status: 1 } },
    { suggestion: { ...suggestion, status: 'unknown' } },
  ];
  fetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ suggestion }) });
  await expect(submitSyntheticCorrectionSuggestion(caseId, suggestion)).rejects.toThrow(
    'correction_suggestion_unavailable',
  );
  for (const payload of invalidSuggestionPayloads) {
    fetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => payload });
    await expect(submitSyntheticCorrectionSuggestion(caseId, suggestion)).rejects.toThrow(
      'correction_suggestion_unavailable',
    );
  }
  fetch.mockResolvedValueOnce({
    ok: false,
    status: 503,
    json: async () => ({ suggestions: [suggestion] }),
  });
  await expect(listSyntheticCorrectionSuggestions(caseId)).rejects.toThrow(
    'correction_suggestions_unavailable',
  );
  fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ suggestions: null }) });
  await expect(listSyntheticCorrectionSuggestions(caseId)).rejects.toThrow(
    'correction_suggestions_unavailable',
  );
  fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => null });
  await expect(listSyntheticCorrectionSuggestions(caseId)).rejects.toThrow(
    'correction_suggestions_unavailable',
  );
  fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ suggestions: [suggestion, { ...suggestion, status: 'unknown' }] }),
  });
  await expect(listSyntheticCorrectionSuggestions(caseId)).rejects.toThrow(
    'correction_suggestions_unavailable',
  );
});

test('updates a correction suggestion status through the reviewer client', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const correctionId = '00000000-0000-4000-8000-000000000041';
  const suggestion = {
    correctionId,
    caseId,
    recordRevision: 1,
    artifact: 'summary' as const,
    entryKey: 'summary-entry',
    proposedText: 'Use the exact source wording.',
    rationale: 'The source confirms the correction.',
    status: 'accepted' as const,
  };
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ suggestion }),
  });
  vi.stubGlobal('fetch', fetch);

  await expect(
    updateSyntheticCorrectionSuggestionStatus(caseId, correctionId, 'accepted'),
  ).resolves.toEqual(suggestion);
  expect(fetch).toHaveBeenCalledWith(
    `/api/v1/cases/${caseId}/correction-suggestions/${correctionId}`,
    {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-record-review-client': 'synthetic-workspace',
      },
      body: JSON.stringify({ status: 'accepted' }),
      cache: 'no-store',
      redirect: 'error',
    },
  );
});

test('rejects unavailable or malformed correction status responses', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const correctionId = '00000000-0000-4000-8000-000000000041';
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);

  const errorJson = vi.fn(async () => ({}));
  fetch.mockResolvedValueOnce({ ok: false, status: 404, json: errorJson });
  await expect(
    updateSyntheticCorrectionSuggestionStatus(caseId, correctionId, 'rejected'),
  ).rejects.toThrow('correction_suggestion_unavailable');
  expect(errorJson).not.toHaveBeenCalled();

  fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => null });
  await expect(
    updateSyntheticCorrectionSuggestionStatus(caseId, correctionId, 'rejected'),
  ).rejects.toThrow('correction_suggestion_unavailable');

  fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      suggestion: {
        correctionId,
        caseId: '00000000-0000-4000-8000-000000000003',
        recordRevision: 1,
        artifact: 'summary',
        entryKey: 'summary-entry',
        proposedText: 'Use the exact source wording.',
        rationale: 'The source confirms the correction.',
        status: 'rejected',
      },
    }),
  });
  await expect(
    updateSyntheticCorrectionSuggestionStatus(caseId, correctionId, 'rejected'),
  ).rejects.toThrow('correction_suggestion_unavailable');
});

test('loads and validates one document processing status without trusting malformed responses', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const documentVersionId = '00000000-0000-4000-8000-000000000021';
  const processing = {
    documentVersionId,
    extractionVersion: 'pdfjs-native-v1',
    state: 'queued',
    attemptCount: 0,
    failureCode: null,
  } as const;
  const validStatuses = [
    processing,
    { ...processing, extractionVersion: 'x'.repeat(128), state: 'processing', attemptCount: 1 },
    { ...processing, state: 'published', attemptCount: 1 },
    {
      ...processing,
      state: 'published',
      attemptCount: 1,
      claims: {
        status: 'validated',
        claims: [
          {
            status: 'verified',
            claimId: 'claim-a',
            text: 'The record supports the stated limitation.',
            section: 'five_step',
            speaker: 'alj',
            step: 3,
            flags: ['possible_cherry_pick', 'possible_specialist_mismatch'],
            source: {
              caseId,
              recordRevision: 1,
              documentVersionId,
              documentSha256: 'a'.repeat(64),
              extractionVersion: 'pdfjs-native-v1',
              sourceUnitId: '00000000-0000-4000-8000-000000000031',
              start: 0,
              end: 4,
              quote: 'The ',
            },
          },
        ],
      },
    },
    { ...processing, state: 'published', claims: { status: 'validated', claims: [] } },
    { ...processing, state: 'published', claims: { status: 'refused', code: 'provider_error' } },
    { ...processing, state: 'published', claims: { status: 'invalid_output' } },
    {
      ...processing,
      state: 'published',
      claims: {
        status: 'validated',
        claims: [
          {
            status: 'unverified',
            claimId: 'claim-unverified',
            text: 'The record could not be matched.',
            message: "The review system couldn't find this evidence in the authorized case record.",
            reason: 'quote_mismatch',
          },
        ],
      },
    },
    ...[
      'original_unavailable',
      'unsupported_document_format',
      'byte_budget_exceeded',
      'page_budget_exceeded',
      'extraction_failed',
      'publication_rejected',
    ].map((failureCode) => ({ ...processing, state: 'failed', attemptCount: 1, failureCode })),
  ];
  const invalidPayloads = [
    null,
    {},
    { processing: null },
    { processing: { ...processing, documentVersionId: 'not-a-uuid' } },
    {
      processing: {
        ...processing,
        documentVersionId: '00000000-0000-4000-8000-000000000022',
      },
    },
    {
      processing: {
        ...processing,
        state: 'published',
        claims: {
          status: 'validated',
          claims: [
            {
              status: 'verified',
              claimId: 'claim-bad-flags',
              text: 'Unsupported investigation flags.',
              flags: [],
              source: {
                caseId,
                recordRevision: 1,
                documentVersionId,
                documentSha256: 'a'.repeat(64),
                extractionVersion: 'pdfjs-native-v1',
                sourceUnitId: '00000000-0000-4000-8000-000000000031',
                start: 0,
                end: 4,
                quote: 'The ',
              },
            },
          ],
        },
      },
    },
    { processing: { ...processing, extractionVersion: '' } },
    { processing: { ...processing, extractionVersion: null } },
    { processing: { ...processing, extractionVersion: 'x'.repeat(129) } },
    { processing: { ...processing, state: 'unknown' } },
    {
      processing: { ...processing, claims: { status: 'validated', claims: [{ claimId: 'bad' }] } },
    },
    { processing: { ...processing, attemptCount: -1 } },
    { processing: { ...processing, attemptCount: 1.5 } },
    { processing: { ...processing, failureCode: 'unknown_failure' } },
    { processing: { ...processing, claims: null } },
    { processing: { ...processing, claims: { status: 'refused', code: 'unknown' } } },
    {
      processing: {
        ...processing,
        claims: {
          status: 'validated',
          claims: [
            {
              status: 'verified',
              claimId: 'claim-bad-section',
              text: 'Unsupported section.',
              section: 'unknown',
              source: {
                caseId,
                recordRevision: 1,
                documentVersionId,
                documentSha256: 'a'.repeat(64),
                extractionVersion: 'pdfjs-native-v1',
                sourceUnitId: '00000000-0000-4000-8000-000000000031',
                start: 0,
                end: 4,
                quote: 'The ',
              },
            },
          ],
        },
      },
    },
    {
      processing: {
        ...processing,
        claims: {
          status: 'validated',
          claims: [
            {
              status: 'verified',
              claimId: 'claim-bad-step',
              text: 'Unsupported evaluation step.',
              section: 'five_step',
              step: 6,
              source: {
                caseId,
                recordRevision: 1,
                documentVersionId: documentVersionId,
                documentSha256: 'a'.repeat(64),
                extractionVersion: 'pdfjs-native-v1',
                sourceUnitId: '00000000-0000-4000-8000-000000000031',
                start: 0,
                end: 4,
                quote: 'The ',
              },
            },
          ],
        },
      },
    },
  ];
  const errorJson = vi.fn();
  const fetch = vi.fn();
  for (const validStatus of validStatuses)
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ processing: validStatus }),
    });
  fetch
    .mockResolvedValueOnce({ ok: false, status: 404, json: errorJson })
    .mockResolvedValueOnce({ ok: false, status: 503, json: errorJson });
  for (const payload of invalidPayloads)
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload });
  vi.stubGlobal('fetch', fetch);

  for (const validStatus of validStatuses)
    await expect(getSyntheticDocumentProcessing(caseId, documentVersionId)).resolves.toEqual(
      validStatus,
    );
  await expect(getSyntheticDocumentProcessing(caseId, documentVersionId)).resolves.toBeUndefined();
  await expect(getSyntheticDocumentProcessing(caseId, documentVersionId)).rejects.toThrow(
    'document_processing_unavailable',
  );
  expect(errorJson).not.toHaveBeenCalled();
  for (let index = 0; index < invalidPayloads.length; index += 1)
    await expect(getSyntheticDocumentProcessing(caseId, documentVersionId)).rejects.toThrow(
      'document_processing_unavailable',
    );
  expect(fetch).toHaveBeenNthCalledWith(
    1,
    `/api/v1/cases/${caseId}/document-processing/${documentVersionId}`,
    {
      headers: { 'x-record-review-client': 'synthetic-workspace' },
      cache: 'no-store',
      redirect: 'error',
    },
  );
  expect(fetch).toHaveBeenCalledTimes(validStatuses.length + 2 + invalidPayloads.length);
});

test('loads and validates processing records for a case', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const processing = {
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    extractionVersion: 'pdfjs-native-v1',
    state: 'queued',
    attemptCount: 0,
    failureCode: null,
  } as const;
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ processing: [processing] })));
  vi.stubGlobal('fetch', fetch);
  await expect(listSyntheticDocumentProcessing(caseId)).resolves.toEqual([processing]);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/v1/cases/${caseId}/document-processing`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  for (const body of [
    null,
    {},
    { processing: null },
    { processing: [processing, { bad: true }] },
  ]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(listSyntheticDocumentProcessing(caseId)).rejects.toThrow(
      'document_processing_unavailable',
    );
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  await expect(listSyntheticDocumentProcessing(caseId)).rejects.toThrow(
    'document_processing_unavailable',
  );
});

test('requeues one failed processing record through the guarded client route', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const documentVersionId = '00000000-0000-4000-8000-000000000021';
  const processing = {
    documentVersionId,
    extractionVersion: 'pdfjs-native-v1',
    state: 'queued',
    attemptCount: 2,
    failureCode: null,
  } as const;
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ processing }),
  });
  vi.stubGlobal('fetch', fetch);

  await expect(retrySyntheticDocumentProcessing(caseId, documentVersionId)).resolves.toEqual(
    processing,
  );
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    `/api/v1/cases/${caseId}/document-processing/${documentVersionId}/retry`,
    {
      method: 'POST',
      headers: { 'x-record-review-client': 'synthetic-workspace' },
      cache: 'no-store',
      redirect: 'error',
    },
  );

  fetch.mockResolvedValueOnce({ ok: false, status: 404 });
  await expect(
    retrySyntheticDocumentProcessing(caseId, documentVersionId),
  ).resolves.toBeUndefined();
  fetch.mockResolvedValueOnce({ ok: false, status: 503 });
  await expect(retrySyntheticDocumentProcessing(caseId, documentVersionId)).rejects.toThrow(
    'document_processing_retry_unavailable',
  );
  fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => null });
  await expect(retrySyntheticDocumentProcessing(caseId, documentVersionId)).rejects.toThrow(
    'document_processing_retry_unavailable',
  );
  fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ processing: { ...processing, documentVersionId: 'not-a-uuid' } }),
  });
  await expect(retrySyntheticDocumentProcessing(caseId, documentVersionId)).rejects.toThrow(
    'document_processing_retry_unavailable',
  );
});

test('requests one reviewer-scoped draft through the same-origin API', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const saved = { caseId, label: 'Synthetic saved draft', recordRevision: 1 };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ case: saved }) });
  vi.stubGlobal('fetch', fetch);
  expect(await getSyntheticCase(caseId)).toEqual(saved);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/v1/cases/${caseId}`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
});

test('loads and validates one case-scoped text source before browser display', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const sourceUnitId = '00000000-0000-4000-8000-000000000031';
  const source = {
    sourceUnitId,
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    recordRevision: 1,
    documentSha256: 'a'.repeat(64),
    extractionVersion: 'x'.repeat(128),
    pageNumber: 1,
    rawText: 'Synthetic source A😀B\nLiteral quotation',
    geometry: {
      view: [0, 0, 612, 792],
      rotation: 0,
      items: [{ start: 0, end: 3, transform: [1, 0, 0, 1, 72, 720], width: 18, height: 12 }],
    },
  };
  const shortVersionSource = { ...source, extractionVersion: 'x' };
  const errorJson = vi.fn();
  const invalidPayloads = [
    null,
    {},
    { source: null },
    { source: { ...source, sourceUnitId: 'not-a-uuid' } },
    {
      source: { ...source, sourceUnitId: '00000000-0000-4000-8000-000000000032' },
    },
    { source: { ...source, sourceUnitId: `x${source.sourceUnitId}` } },
    { source: { ...source, sourceUnitId: `${source.sourceUnitId}x` } },
    { source: { ...source, caseId: '00000000-0000-4000-8000-000000000099' } },
    { source: { ...source, documentVersionId: 'not-a-uuid' } },
    { source: { ...source, documentVersionId: `x${source.documentVersionId}` } },
    { source: { ...source, documentVersionId: `${source.documentVersionId}x` } },
    { source: { ...source, recordRevision: 0 } },
    { source: { ...source, recordRevision: 1.5 } },
    { source: { ...source, recordRevision: Number.MAX_SAFE_INTEGER + 1 } },
    { source: { ...source, documentSha256: 'not-a-hash' } },
    { source: { ...source, documentSha256: `x${source.documentSha256}` } },
    { source: { ...source, documentSha256: `${source.documentSha256}x` } },
    { source: { ...source, extractionVersion: '' } },
    { source: { ...source, extractionVersion: '   ' } },
    { source: { ...source, extractionVersion: null } },
    { source: { ...source, extractionVersion: 'x'.repeat(129) } },
    { source: { ...source, pageNumber: 0 } },
    { source: { ...source, pageNumber: 1.5 } },
    { source: { ...source, pageNumber: Number.MAX_SAFE_INTEGER + 1 } },
    { source: { ...source, geometry: { view: ['not-a-number'] } } },
    { source: { ...source, rawText: null } },
  ];
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ source }) })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ source: shortVersionSource }),
    })
    .mockResolvedValueOnce({ ok: false, status: 404, json: errorJson })
    .mockResolvedValueOnce({ ok: false, status: 503, json: errorJson });
  for (const payload of invalidPayloads)
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload });
  vi.stubGlobal('fetch', fetch);

  expect(await getSyntheticTextSource(caseId, sourceUnitId)).toEqual(source);
  expect(await getSyntheticTextSource(caseId, sourceUnitId)).toEqual(shortVersionSource);
  await expect(
    getSyntheticTextSource(caseId, '00000000-0000-4000-8000-000000000032'),
  ).resolves.toBeUndefined();
  await expect(getSyntheticTextSource(caseId, sourceUnitId)).rejects.toThrow(
    'text_source_unavailable',
  );
  expect(errorJson).not.toHaveBeenCalled();
  for (let index = 0; index < invalidPayloads.length; index += 1)
    await expect(getSyntheticTextSource(caseId, sourceUnitId)).rejects.toThrow(
      'text_source_unavailable',
    );
  expect(fetch).toHaveBeenNthCalledWith(1, `/api/v1/cases/${caseId}/text-sources/${sourceUnitId}`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  expect(fetch).toHaveBeenCalledTimes(4 + invalidPayloads.length);
});

test('verifies a source span through the guarded citation endpoint', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const sourceUnitId = '00000000-0000-4000-8000-000000000031';
  const candidate = {
    recordRevision: 1,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    documentSha256: 'a'.repeat(64),
    extractionVersion: 'pdfjs-native-v1',
    sourceUnitId,
    start: 4,
    end: 18,
    quote: 'verified quotation',
  };
  const span = { caseId, ...candidate };
  const invalidSpans = [
    null,
    'invalid',
    { ...span, caseId: '00000000-0000-4000-8000-000000000099' },
    { ...span, sourceUnitId: '00000000-0000-4000-8000-000000000032' },
    { ...span, documentVersionId: 'not-a-uuid' },
    { ...span, recordRevision: 0 },
    { ...span, documentSha256: 'not-a-hash' },
    { ...span, extractionVersion: '' },
    { ...span, extractionVersion: ' '.repeat(129) },
    { ...span, start: -1 },
    { ...span, start: 1.5 },
    { ...span, end: 4 },
    { ...span, end: 18.5 },
    { ...span, quote: '' },
  ];
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ span }) })
    .mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ code: 'source_span_not_located', reason: 'quote_mismatch' }),
    })
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ span: null }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ span: {} }) })
    .mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ code: 'source_span_not_located', reason: 42 }),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({}),
    });
  for (const invalidSpan of invalidSpans)
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ span: invalidSpan }),
    });
  vi.stubGlobal('fetch', fetch);
  await expect(verifySyntheticTextSpan(caseId, sourceUnitId, candidate)).resolves.toEqual(span);
  await expect(verifySyntheticTextSpan(caseId, sourceUnitId, candidate)).rejects.toThrow(
    'source_span_not_located:quote_mismatch',
  );
  await expect(verifySyntheticTextSpan(caseId, sourceUnitId, candidate)).rejects.toThrow(
    'source_span_unavailable',
  );
  await expect(verifySyntheticTextSpan(caseId, sourceUnitId, candidate)).rejects.toThrow(
    'source_span_unavailable',
  );
  await expect(verifySyntheticTextSpan(caseId, sourceUnitId, candidate)).rejects.toThrow(
    'source_span_unavailable',
  );
  await expect(verifySyntheticTextSpan(caseId, sourceUnitId, candidate)).rejects.toThrow(
    'source_span_unavailable',
  );
  for (let index = 0; index < invalidSpans.length; index += 1)
    await expect(verifySyntheticTextSpan(caseId, sourceUnitId, candidate)).rejects.toThrow(
      'source_span_unavailable',
    );
  expect(fetch).toHaveBeenNthCalledWith(
    1,
    `/api/v1/cases/${caseId}/text-sources/${sourceUnitId}/spans`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-record-review-client': 'synthetic-workspace',
      },
      body: JSON.stringify(candidate),
      cache: 'no-store',
      redirect: 'error',
    },
  );
});

test('lists validated case-scoped text source metadata without accepting page text', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const source = {
    sourceUnitId: '00000000-0000-4000-8000-000000000031',
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    recordRevision: 1,
    documentSha256: 'a'.repeat(64),
    extractionVersion: 'x',
    pageNumber: 1,
  };
  const boundarySource = {
    ...source,
    sourceUnitId: '00000000-0000-4000-8000-000000000032',
    extractionVersion: 'x'.repeat(128),
    pageNumber: 2,
  };
  const invalidPayloads = [
    null,
    {},
    { sources: null },
    { sources: [null] },
    { sources: [source, { ...source, sourceUnitId: 'not-a-uuid' }] },
    { sources: [{ ...source, sourceUnitId: 'not-a-uuid' }] },
    { sources: [{ ...source, sourceUnitId: `x${source.sourceUnitId}` }] },
    { sources: [{ ...source, sourceUnitId: `${source.sourceUnitId}x` }] },
    { sources: [{ ...source, caseId: '00000000-0000-4000-8000-000000000099' }] },
    { sources: [{ ...source, documentVersionId: 'not-a-uuid' }] },
    { sources: [{ ...source, documentVersionId: `x${source.documentVersionId}` }] },
    { sources: [{ ...source, documentVersionId: `${source.documentVersionId}x` }] },
    { sources: [{ ...source, recordRevision: 0 }] },
    { sources: [{ ...source, recordRevision: 1.5 }] },
    { sources: [{ ...source, recordRevision: Number.MAX_SAFE_INTEGER + 1 }] },
    { sources: [{ ...source, documentSha256: 'not-a-hash' }] },
    { sources: [{ ...source, documentSha256: `x${source.documentSha256}` }] },
    { sources: [{ ...source, documentSha256: `${source.documentSha256}x` }] },
    { sources: [{ ...source, extractionVersion: '' }] },
    { sources: [{ ...source, extractionVersion: '   ' }] },
    { sources: [{ ...source, extractionVersion: null }] },
    { sources: [{ ...source, extractionVersion: 'x'.repeat(129) }] },
    { sources: [{ ...source, pageNumber: 0 }] },
    { sources: [{ ...source, pageNumber: 1.5 }] },
    { sources: [{ ...source, pageNumber: Number.MAX_SAFE_INTEGER + 1 }] },
    { sources: [{ ...source, rawText: 'Unexpected page text' }] },
  ];
  const errorJson = vi.fn();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ sources: [source, boundarySource] }),
    })
    .mockResolvedValueOnce({ ok: false, status: 404, json: errorJson });
  for (const payload of invalidPayloads)
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload });
  vi.stubGlobal('fetch', fetch);

  expect(await listSyntheticTextSources(caseId)).toEqual([source, boundarySource]);
  await expect(listSyntheticTextSources(caseId)).rejects.toThrow('source_inventory_unavailable');
  expect(errorJson).not.toHaveBeenCalled();
  for (let index = 0; index < invalidPayloads.length; index += 1)
    await expect(listSyntheticTextSources(caseId)).rejects.toThrow('source_inventory_unavailable');
  expect(fetch).toHaveBeenNthCalledWith(1, `/api/v1/cases/${caseId}/text-sources`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  expect(fetch).toHaveBeenCalledTimes(2 + invalidPayloads.length);
});

test('opens one member-scoped synthetic original as a Blob', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const documentVersionId = '00000000-0000-4000-8000-000000000021';
  const document = new Blob(['synthetic pdf bytes'], { type: 'application/pdf' });
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => document });
  vi.stubGlobal('fetch', fetch);

  await expect(getSyntheticOriginal(caseId, documentVersionId)).resolves.toBe(document);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    `/api/v1/cases/${caseId}/synthetic-originals/${documentVersionId}`,
    {
      headers: { 'x-record-review-client': 'synthetic-workspace' },
      cache: 'no-store',
      redirect: 'error',
    },
  );
});

test('rejects an unavailable synthetic original without reading its error body', async () => {
  const json = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json }));
  await expect(
    getSyntheticOriginal(
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000021',
    ),
  ).rejects.toThrow('original_unavailable');
  expect(json).not.toHaveBeenCalled();
});

test('reads the guarded synthetic upload capability from the same-origin API', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ syntheticOriginalUpload: false }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ syntheticOriginalUpload: true }) });
  vi.stubGlobal('fetch', fetch);
  expect(await getSyntheticUploadCapability()).toBe(false);
  expect(await getSyntheticUploadCapability()).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenNthCalledWith(1, '/api/v1/capabilities', {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
  expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/capabilities', {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
});

test('rejects an unavailable synthetic upload capability without reading its error body', async () => {
  const json = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json }));
  await expect(getSyntheticUploadCapability()).rejects.toThrow('upload_capability_unavailable');
  expect(json).not.toHaveBeenCalled();
});

test('rejects a synthetic upload capability without a Boolean value', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => null })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ syntheticOriginalUpload: 'true' }) });
  vi.stubGlobal('fetch', fetch);
  await expect(getSyntheticUploadCapability()).rejects.toThrow('upload_capability_unavailable');
  await expect(getSyntheticUploadCapability()).rejects.toThrow('upload_capability_unavailable');
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('treats an inaccessible case as unavailable without reading its body', async () => {
  const json = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false, json }));
  await expect(getSyntheticCase('00000000-0000-4000-8000-000000000099')).resolves.toBeUndefined();
  expect(json).not.toHaveBeenCalled();
});

test('rejects a failed case-detail response without displaying its error body', async () => {
  const json = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 503, ok: false, json }));
  await expect(getSyntheticCase('00000000-0000-4000-8000-000000000002')).rejects.toThrow(
    'case_detail_unavailable',
  );
  expect(json).not.toHaveBeenCalled();
});

test('rejects a case-detail response without case metadata', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => null }));
  await expect(getSyntheticCase('00000000-0000-4000-8000-000000000002')).rejects.toThrow(
    'case_detail_unavailable',
  );
});

test('creates a synthetic draft through the guarded same-origin API', async () => {
  const created = {
    caseId: '00000000-0000-4000-8000-000000000002',
    label: 'Synthetic new draft',
    recordRevision: 1,
  };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ case: created }) });
  vi.stubGlobal('fetch', fetch);
  expect(await createSyntheticCase('Synthetic new draft')).toEqual(created);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/v1/cases', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-record-review-client': 'synthetic-workspace',
    },
    body: JSON.stringify({ label: 'Synthetic new draft' }),
    cache: 'no-store',
    redirect: 'error',
  });
});

test('rejects a failed draft creation without trusting an error body', async () => {
  const json = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json }));
  await expect(createSyntheticCase('Synthetic failed draft')).rejects.toThrow(
    'case_creation_unavailable',
  );
  expect(json).not.toHaveBeenCalled();
});

test('rejects a successful draft response without case metadata', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => null }));
  await expect(createSyntheticCase('Synthetic missing draft')).rejects.toThrow(
    'case_creation_unavailable',
  );
});

test('rejects a case row with a zero record revision', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cases: [
          {
            caseId: '00000000-0000-4000-8000-000000000001',
            label: 'Synthetic draft',
            recordRevision: 0,
          },
        ],
      }),
    }),
  );
  await expect(listSyntheticCases()).rejects.toThrow('case_list_unavailable');
});

test('rejects a case row with a nonnumeric record revision', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cases: [
          {
            caseId: '00000000-0000-4000-8000-000000000001',
            label: 'Synthetic draft',
            recordRevision: 'unknown',
          },
        ],
      }),
    }),
  );
  await expect(listSyntheticCases()).rejects.toThrow('case_list_unavailable');
});

test('rejects a case row without a usable case identity', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cases: [{ caseId: null, label: 'Synthetic draft', recordRevision: 1 }],
      }),
    }),
  );
  await expect(listSyntheticCases()).rejects.toThrow('case_list_unavailable');
});

test('rejects malformed case rows before the browser displays a list', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cases: [
          {
            caseId: '00000000-0000-4000-8000-000000000001',
            label: 'Synthetic draft',
            recordRevision: 1,
          },
          null,
        ],
      }),
    }),
  );
  await expect(listSyntheticCases()).rejects.toThrow('case_list_unavailable');
});

test('rejects a missing case list instead of treating it as an empty list', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => null }));
  await expect(listSyntheticCases()).rejects.toThrow('case_list_unavailable');
});

test('rejects an unsuccessful case response without reading its body', async () => {
  const json = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json }));
  await expect(listSyntheticCases()).rejects.toThrow('case_list_unavailable');
  expect(json).not.toHaveBeenCalled();
});

test('requests reviewer-scoped cases through the same-origin development route', async () => {
  const cases = [
    {
      caseId: '00000000-0000-4000-8000-000000000001',
      label: 'Synthetic draft',
      recordRevision: 1,
    },
  ];
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ cases }) });
  vi.stubGlobal('fetch', fetch);
  expect(await listSyntheticCases()).toEqual(cases);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/v1/cases', {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
});

test('requests a case-scoped synthetic original inventory and rejects failed responses', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const original = {
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    sha256: 'a'.repeat(64),
    byteLength: 0,
  };
  const json = vi.fn();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ originals: [original] }) })
    .mockResolvedValueOnce({ ok: false, status: 503, json });
  vi.stubGlobal('fetch', fetch);
  expect(await listSyntheticOriginals(caseId)).toEqual([original]);
  await expect(listSyntheticOriginals(caseId)).rejects.toThrow('original_list_unavailable');
  expect(json).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenNthCalledWith(1, `/api/v1/cases/${caseId}/synthetic-originals`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
});

test('preserves optional uploaded filename and media type in the original inventory', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const original = {
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    sha256: 'a'.repeat(64),
    byteLength: 12,
    fileName: '7-brief.pdf',
    mediaType: 'application/pdf',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ originals: [original] }) }),
  );
  await expect(listSyntheticOriginals(caseId)).resolves.toEqual([original]);
});

test('rejects malformed optional uploaded metadata before display', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const base = {
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    sha256: 'a'.repeat(64),
    byteLength: 12,
  };
  const invalidPayloads = [
    { ...base, fileName: '', mediaType: 'application/pdf' },
    { ...base, fileName: '7-brief.pdf' },
    { ...base, mediaType: 'application/pdf' },
    { ...base, fileName: 7, mediaType: 'application/pdf' },
    { ...base, fileName: '   ', mediaType: 'application/pdf' },
    { ...base, fileName: '7-brief.pdf', mediaType: 7 },
    { ...base, fileName: '7-brief.pdf', mediaType: '   ' },
  ];
  const fetch = vi.fn();
  for (const original of invalidPayloads)
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ originals: [original] }) });
  vi.stubGlobal('fetch', fetch);
  for (let index = 0; index < invalidPayloads.length; index += 1)
    await expect(listSyntheticOriginals(caseId)).rejects.toThrow('original_list_unavailable');
});

test('rejects malformed synthetic original inventory rows before display', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const original = {
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    sha256: 'a'.repeat(64),
    byteLength: 12,
  };
  const invalidPayloads = [
    null,
    {},
    { originals: null },
    { originals: {} },
    { originals: [null] },
    { originals: [{ ...original, caseId: '00000000-0000-4000-8000-000000000099' }] },
    { originals: [{ ...original, documentVersionId: 'not-a-uuid' }] },
    { originals: [{ ...original, documentVersionId: `x${original.documentVersionId}` }] },
    { originals: [{ ...original, documentVersionId: `${original.documentVersionId}x` }] },
    { originals: [{ ...original, sha256: 'not-a-hash' }] },
    { originals: [{ ...original, sha256: `x${original.sha256}` }] },
    { originals: [{ ...original, sha256: `${original.sha256}x` }] },
    { originals: [{ ...original, byteLength: -1 }] },
    { originals: [{ ...original, byteLength: 1.5 }] },
    { originals: [{ ...original, byteLength: Number.MAX_SAFE_INTEGER + 1 }] },
    { originals: [original, { ...original, sha256: 'b'.repeat(63) }] },
  ];
  const fetch = vi.fn();
  for (const payload of invalidPayloads)
    fetch.mockResolvedValueOnce({ ok: true, json: async () => payload });
  vi.stubGlobal('fetch', fetch);
  for (let index = 0; index < invalidPayloads.length; index += 1)
    await expect(listSyntheticOriginals(caseId)).rejects.toThrow('original_list_unavailable');
  expect(fetch).toHaveBeenCalledTimes(invalidPayloads.length);
});

test('streams one selected synthetic file to its saved case through the same-origin route', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const file = new File(['synthetic bytes'], 'synthetic.pdf', { type: 'application/pdf' });
  const original = {
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000003',
    sha256: '0123456789abcdef'.repeat(4),
    byteLength: 15,
  };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ original }) });
  vi.stubGlobal('fetch', fetch);
  expect(await uploadSyntheticOriginal(caseId, file)).toEqual(original);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/v1/cases/${caseId}/synthetic-originals`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-record-review-client': 'synthetic-workspace',
      'x-record-review-file-name': 'synthetic.pdf',
      'x-record-review-media-type': 'application/pdf',
    },
    body: file,
    cache: 'no-store',
    redirect: 'error',
  });

  const noTypeFile = new File(['synthetic bytes'], 'synthetic.bin');
  const noTypeOriginal = { ...original, byteLength: noTypeFile.size };
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ original: noTypeOriginal }) });
  expect(await uploadSyntheticOriginal(caseId, noTypeFile)).toEqual(noTypeOriginal);
  expect(fetch).toHaveBeenNthCalledWith(2, `/api/v1/cases/${caseId}/synthetic-originals`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-record-review-client': 'synthetic-workspace',
      'x-record-review-file-name': 'synthetic.bin',
      'x-record-review-media-type': 'application/octet-stream',
    },
    body: noTypeFile,
    cache: 'no-store',
    redirect: 'error',
  });
});

test('reports an oversized synthetic original without reading the server error body', async () => {
  const json = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 413, json }));
  await expect(
    uploadSyntheticOriginal(
      '00000000-0000-4000-8000-000000000002',
      new File(['synthetic bytes'], 'synthetic.pdf'),
    ),
  ).rejects.toThrow('original_upload_too_large');
  expect(json).not.toHaveBeenCalled();
});

test('rejects a failed synthetic original transfer without reading the error body', async () => {
  const json = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json }));
  await expect(
    uploadSyntheticOriginal(
      '00000000-0000-4000-8000-000000000002',
      new File(['synthetic bytes'], 'synthetic.pdf'),
    ),
  ).rejects.toThrow('original_upload_unavailable');
  expect(json).not.toHaveBeenCalled();
});

test('loads and validates member-scoped revision history', async () => {
  const caseId = '00000000-0000-4000-8000-000000000001';
  const documentVersionId = '00000000-0000-4000-8000-000000000043';
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          revisions: [{ recordRevision: 2, eventType: 'original_registered', documentVersionId }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );

  await expect(getSyntheticRevisionHistory(caseId)).resolves.toEqual([
    { recordRevision: 2, eventType: 'original_registered', documentVersionId },
  ]);
  expect(fetch).toHaveBeenCalledWith(`/api/v1/cases/${caseId}/revision-history`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
});

test('rejects unavailable and malformed revision history responses', async () => {
  const caseId = '00000000-0000-4000-8000-000000000001';
  const validEvent = {
    recordRevision: 2,
    eventType: 'original_registered',
    documentVersionId: '00000000-0000-4000-8000-000000000043',
  };
  const invalidPayloads = [
    { revisions: null },
    { revisions: {} },
    { revisions: [{ ...validEvent, recordRevision: 1 }] },
    { revisions: [{ ...validEvent, recordRevision: 1.5 }] },
    { revisions: [{ ...validEvent, eventType: 'unknown' }] },
    { revisions: [{ ...validEvent, documentVersionId: 'not-a-uuid' }] },
    { revisions: [validEvent, { ...validEvent, eventType: 'unknown' }] },
  ];
  for (const payload of invalidPayloads) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })),
    );
    await expect(getSyntheticRevisionHistory(caseId)).rejects.toThrow(
      'revision_history_unavailable',
    );
    vi.unstubAllGlobals();
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));
  await expect(getSyntheticRevisionHistory(caseId)).rejects.toThrow('revision_history_unavailable');
});

test('lists validated upload attempts for a case', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const attempt = {
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    maximumBytes: 512,
    state: 'receiving' as const,
  };
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ attempts: [attempt] }),
  });
  vi.stubGlobal('fetch', fetch);

  await expect(listSyntheticUploadAttempts(caseId)).resolves.toEqual([attempt]);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/v1/cases/${caseId}/upload-attempts`, {
    headers: { 'x-record-review-client': 'synthetic-workspace' },
    cache: 'no-store',
    redirect: 'error',
  });
});

test('rejects unavailable and malformed upload-attempt responses', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const validAttempt = {
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    maximumBytes: 512,
    state: 'receiving',
  };
  const invalidPayloads = [
    { attempts: null },
    { attempts: {} },
    { attempts: [{ ...validAttempt, documentVersionId: 'not-a-uuid' }] },
    { attempts: [{ ...validAttempt, maximumBytes: 0 }] },
    { attempts: [{ ...validAttempt, maximumBytes: 1.5 }] },
    { attempts: [{ ...validAttempt, state: 'unknown' }] },
    { attempts: [validAttempt, { ...validAttempt, state: 'unknown' }] },
  ];
  for (const payload of invalidPayloads) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    await expect(listSyntheticUploadAttempts(caseId)).rejects.toThrow(
      'upload_attempts_unavailable',
    );
    vi.unstubAllGlobals();
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));
  await expect(listSyntheticUploadAttempts(caseId)).rejects.toThrow('upload_attempts_unavailable');
});

test('rejects a synthetic transfer receipt that cannot identify the saved bytes', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const file = new File(['synthetic bytes'], 'synthetic.pdf');
  const valid = {
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000003',
    sha256: '0123456789abcdef'.repeat(4),
    byteLength: file.size,
  };
  const invalidPayloads = [
    null,
    { original: null },
    { original: { ...valid, caseId: '00000000-0000-4000-8000-000000000099' } },
    { original: { ...valid, documentVersionId: 'not-a-version' } },
    { original: { ...valid, documentVersionId: `x${valid.documentVersionId}` } },
    { original: { ...valid, documentVersionId: `${valid.documentVersionId}x` } },
    { original: { ...valid, sha256: 'not-a-digest' } },
    { original: { ...valid, sha256: `x${valid.sha256}` } },
    { original: { ...valid, sha256: `${valid.sha256}x` } },
    { original: { ...valid, byteLength: file.size + 1 } },
  ];
  const fetch = vi.fn();
  for (const payload of invalidPayloads) {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => payload });
  }
  vi.stubGlobal('fetch', fetch);
  for (let index = 0; index < invalidPayloads.length; index += 1) {
    await expect(uploadSyntheticOriginal(caseId, file)).rejects.toThrow(
      'original_upload_unavailable',
    );
  }
  expect(fetch).toHaveBeenCalledTimes(invalidPayloads.length);
});
