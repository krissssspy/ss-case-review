// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Link, MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { App } from '../src/app.tsx';
import {
  SyntheticOriginalInventory,
  SyntheticProcessingStatus,
  SyntheticProcessingOverview,
  SyntheticArtifactSection,
  SyntheticReferenceDesk,
  SyntheticSourceWorkspace,
  SyntheticCorrectionDesk,
  SyntheticRevisionHistory,
  SyntheticUploadRecovery,
  deduplicateProcessingClaims,
  hasProcessingClaims,
  caseSectionSlug,
  sourceUnitIdFromHash,
  splitVerifiedSourceText,
} from '../src/case-detail-page.tsx';
import {
  getSyntheticDocumentProcessing,
  retrySyntheticDocumentProcessing,
  listSyntheticDocumentProcessing,
  getSyntheticOriginal,
  getSyntheticTextSource,
  getSyntheticCase,
  listSyntheticOriginals,
  listSyntheticTextSources,
  verifySyntheticTextSpan,
  listSyntheticCorrectionSuggestions,
  submitSyntheticCorrectionSuggestion,
  updateSyntheticCorrectionSuggestionStatus,
  getSyntheticRevisionHistory,
  listSyntheticUploadAttempts,
  type CaseSummary,
  type SyntheticDocumentProcessing,
  type SyntheticOriginalReceipt,
  type SyntheticTextSource,
  type SyntheticTextSourceReference,
  type SyntheticCorrectionSuggestion,
} from '../src/case-client.ts';

vi.mock('../src/case-client.ts', () => ({
  getSyntheticCase: vi.fn(),
  getSyntheticDocumentProcessing: vi.fn(),
  retrySyntheticDocumentProcessing: vi.fn(),
  listSyntheticDocumentProcessing: vi.fn(),
  getSyntheticOriginal: vi.fn(),
  getSyntheticTextSource: vi.fn(),
  listSyntheticOriginals: vi.fn(),
  listSyntheticTextSources: vi.fn(),
  listSyntheticCases: vi.fn(),
  createSyntheticCase: vi.fn(),
  verifySyntheticTextSpan: vi.fn(),
  listSyntheticCorrectionSuggestions: vi.fn(),
  submitSyntheticCorrectionSuggestion: vi.fn(),
  updateSyntheticCorrectionSuggestionStatus: vi.fn(),
  getSyntheticRevisionHistory: vi.fn(),
  listSyntheticUploadAttempts: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(listSyntheticOriginals).mockResolvedValue([]);
  vi.mocked(listSyntheticTextSources).mockResolvedValue([]);
  vi.mocked(getSyntheticDocumentProcessing).mockResolvedValue(undefined);
  vi.mocked(retrySyntheticDocumentProcessing).mockResolvedValue(undefined);
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValue([]);
  vi.mocked(verifySyntheticTextSpan).mockImplementation(
    async (_caseId, _sourceUnitId, candidate) => ({
      caseId: _caseId,
      ...candidate,
    }),
  );
  vi.mocked(listSyntheticCorrectionSuggestions).mockResolvedValue([]);
  vi.mocked(getSyntheticRevisionHistory).mockResolvedValue([]);
  vi.mocked(listSyntheticUploadAttempts).mockResolvedValue([]);
  vi.mocked(submitSyntheticCorrectionSuggestion).mockImplementation(
    async (_caseId, suggestion) => ({
      correctionId: '00000000-0000-4000-8000-000000000041',
      caseId: _caseId,
      recordRevision: 1,
      status: 'pending',
      ...suggestion,
    }),
  );
  vi.mocked(updateSyntheticCorrectionSuggestionStatus).mockImplementation(
    async (_caseId, _correctionId, status) => ({
      correctionId: _correctionId,
      caseId: _caseId,
      recordRevision: 1,
      artifact: 'medical',
      entryKey: '2020-08-03',
      proposedText: 'Confirm the imaging date against the report header.',
      rationale: 'The chronology date may not match the source header.',
      status,
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

test('provides curated reference links without presenting them as case evidence', () => {
  render(<SyntheticReferenceDesk />);

  expect(screen.getByRole('heading', { name: 'Reference desk' })).toBeVisible();
  expect(screen.getByText(/Reference material is not case evidence/i)).toBeVisible();
  expect(screen.getByRole('link', { name: /Residual functional capacity/i })).toHaveAttribute(
    'href',
    'https://www.ecfr.gov/current/title-20/part-404/subpart-P/section-404.1545',
  );
  expect(screen.getByRole('link', { name: /Substantial gainful activity/i })).toHaveAttribute(
    'href',
    'https://www.ssa.gov/oact/cola/sga.html',
  );
});

test('provides expandable definitions separately from case evidence', async () => {
  const user = userEvent.setup();
  render(<SyntheticReferenceDesk />);

  await user.click(screen.getByText('Residual functional capacity', { selector: 'summary' }));
  expect(screen.getByText(/what a person can still do despite limitations/i)).toBeVisible();
  expect(screen.getByText('Substantial gainful activity', { selector: 'summary' })).toBeVisible();
  expect(screen.getByText('Intervertebral disc disease', { selector: 'summary' })).toBeVisible();
});

test('submits a correction suggestion and displays the pending revision-scoped item', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const existing: SyntheticCorrectionSuggestion = {
    correctionId: '00000000-0000-4000-8000-000000000041',
    caseId,
    recordRevision: 1,
    artifact: 'medical',
    entryKey: '2020-08-03',
    proposedText: 'Confirm the imaging date against the report header.',
    rationale: 'The chronology date may not match the source header.',
    status: 'pending',
  };
  vi.mocked(listSyntheticCorrectionSuggestions).mockResolvedValueOnce([existing]);
  const user = userEvent.setup();
  render(<SyntheticCorrectionDesk caseId={caseId} />);

  expect(
    await screen.findByText('Confirm the imaging date against the report header.'),
  ).toBeVisible();
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Correction artifact' }),
    'medical',
  );
  await user.type(screen.getByRole('textbox', { name: 'Correction entry key' }), '2020-08-04');
  await user.type(
    screen.getByRole('textbox', { name: 'Proposed correction' }),
    'Use the signed report date.',
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Correction rationale' }),
    'The source header controls the date.',
  );
  await user.click(screen.getByRole('button', { name: 'Submit correction suggestion' }));

  expect(submitSyntheticCorrectionSuggestion).toHaveBeenCalledWith(caseId, {
    artifact: 'medical',
    entryKey: '2020-08-04',
    proposedText: 'Use the signed report date.',
    rationale: 'The source header controls the date.',
  });
  expect(await screen.findByText('Correction suggestion submitted for review.')).toBeVisible();
});

test('accepts and rejects pending correction suggestions from the correction desk', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const existing: SyntheticCorrectionSuggestion = {
    correctionId: '00000000-0000-4000-8000-000000000041',
    caseId,
    recordRevision: 1,
    artifact: 'medical',
    entryKey: '2020-08-03',
    proposedText: 'Confirm the imaging date against the report header.',
    rationale: 'The chronology date may not match the source header.',
    status: 'pending',
  };
  vi.mocked(listSyntheticCorrectionSuggestions).mockResolvedValueOnce([existing]);
  const user = userEvent.setup();
  render(<SyntheticCorrectionDesk caseId={caseId} />);

  expect(await screen.findByText(existing.proposedText)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Accept correction suggestion' }));
  expect(updateSyntheticCorrectionSuggestionStatus).toHaveBeenCalledWith(
    caseId,
    existing.correctionId,
    'accepted',
  );
  expect(await screen.findByText(/accepted ·/i)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Reject correction suggestion' })).toBeNull();
});

test('reports correction review failures without changing the pending item', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const existing: SyntheticCorrectionSuggestion = {
    correctionId: '00000000-0000-4000-8000-000000000041',
    caseId,
    recordRevision: 1,
    artifact: 'medical',
    entryKey: '2020-08-03',
    proposedText: 'Confirm the imaging date against the report header.',
    rationale: 'The chronology date may not match the source header.',
    status: 'pending',
  };
  vi.mocked(listSyntheticCorrectionSuggestions).mockResolvedValueOnce([existing]);
  vi.mocked(updateSyntheticCorrectionSuggestionStatus).mockRejectedValueOnce(
    new Error('correction_suggestion_unavailable'),
  );
  const user = userEvent.setup();
  render(<SyntheticCorrectionDesk caseId={caseId} />);

  await screen.findByText(existing.proposedText);
  await user.click(screen.getByRole('button', { name: 'Accept correction suggestion' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Correction suggestion could not be submitted.',
  );
  expect(screen.getByText(/pending ·/i)).toBeVisible();
});

test('opens saved synthetic case metadata and refreshes after case navigation', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const nextCaseId = '00000000-0000-4000-8000-000000000003';
  let resolveCase!: (value: CaseSummary) => void;
  vi.mocked(getSyntheticCase)
    .mockImplementationOnce(
      () =>
        new Promise<CaseSummary>((resolve) => {
          resolveCase = resolve;
        }),
    )
    .mockResolvedValueOnce({
      caseId: nextCaseId,
      label: 'Second synthetic draft',
      recordRevision: 1,
    });
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[`/cases/${caseId}`]}>
      <Link to={`/cases/${nextCaseId}`}>Next synthetic draft</Link>
      <App />
    </MemoryRouter>,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Loading case');
  expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
  resolveCase({ caseId, label: 'Synthetic saved draft', recordRevision: 1 });
  expect(await screen.findByRole('heading', { name: 'Synthetic saved draft' })).toBeVisible();
  expect(screen.getByText('Record revision 1')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Summary' })).toHaveAttribute(
    'href',
    `/cases/${caseId}/summary`,
  );
  expect(screen.getByRole('link', { name: 'Summary' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Medical chronology' })).not.toHaveAttribute(
    'aria-current',
  );
  expect(screen.getByRole('link', { name: 'Medical chronology' })).toHaveAttribute(
    'href',
    `/cases/${caseId}/medical-chronology`,
  );
  expect(screen.getByRole('link', { name: 'Procedural chronology' })).toHaveAttribute(
    'href',
    `/cases/${caseId}/procedural-chronology`,
  );
  expect(screen.getByRole('link', { name: 'Five-step review' })).toHaveAttribute(
    'href',
    `/cases/${caseId}/five-step-review`,
  );
  await user.click(screen.getByRole('link', { name: 'Medical chronology' }));
  expect(await screen.findByRole('heading', { name: 'Medical chronology' })).toBeVisible();
  await user.click(screen.getByRole('link', { name: 'Summary' }));
  expect(await screen.findByText('No registered originals yet.')).toBeVisible();
  expect(
    screen.getByText('Processing status comes from the case-scoped background queue.'),
  ).toBeVisible();
  expect(getSyntheticCase).toHaveBeenCalledExactlyOnceWith(caseId);
  await user.click(screen.getByRole('link', { name: 'Next synthetic draft' }));
  expect(await screen.findByRole('heading', { name: 'Second synthetic draft' })).toBeVisible();
  expect(await screen.findByText('No registered originals yet.')).toBeVisible();
  expect(getSyntheticCase).toHaveBeenNthCalledWith(2, nextCaseId);
  expect(listSyntheticOriginals).toHaveBeenNthCalledWith(3, nextCaseId);
  cleanup();
  const inventory = render(<SyntheticOriginalInventory caseId={caseId} />);
  expect(await screen.findByText('No registered originals yet.')).toBeVisible();
  inventory.rerender(<SyntheticOriginalInventory caseId={nextCaseId} />);
  expect(listSyntheticOriginals).toHaveBeenNthCalledWith(5, nextCaseId);
});

test('falls back to Summary for an unknown case section path', () => {
  expect(caseSectionSlug('/cases/00000000-0000-4000-8000-000000000002/unknown')).toBe('summary');
  expect(caseSectionSlug('/cases/00000000-0000-4000-8000-000000000002/five-step-review')).toBe(
    'five-step-review',
  );
});

test('renders each production artifact route through its source-grounded section component', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(getSyntheticCase).mockResolvedValue({
    caseId,
    label: 'Synthetic saved draft',
    recordRevision: 1,
  });
  for (const [path, heading] of [
    ['medical-chronology', 'Medical chronology'],
    ['procedural-chronology', 'Procedural chronology'],
    ['five-step-review', 'Five-step review and RFC'],
    ['unknown', 'Processing overview'],
  ] as const) {
    render(
      <MemoryRouter initialEntries={[`/cases/${caseId}/${path}`]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
    cleanup();
  }
});

test('renders the source-grounded summary artifact on the summary route', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(getSyntheticCase).mockResolvedValue({
    caseId,
    label: 'Synthetic saved draft',
    recordRevision: 1,
  });
  render(
    <MemoryRouter initialEntries={[`/cases/${caseId}/summary`]}>
      <App />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: 'Summary' })).toBeVisible();
  expect(
    await screen.findByText(/No explicitly classified source-grounded entries are available/),
  ).toBeVisible();
});

test('includes the correction desk on a saved case summary', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(getSyntheticCase).mockResolvedValue({
    caseId,
    label: 'Synthetic saved draft',
    recordRevision: 1,
  });
  render(
    <MemoryRouter initialEntries={[`/cases/${caseId}/summary`]}>
      <App />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: 'Correction suggestions' })).toBeVisible();
});

test('shows persisted source-grounded claims after processing publishes', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const documentVersionId = '00000000-0000-4000-8000-000000000021';
  vi.mocked(getSyntheticDocumentProcessing).mockResolvedValueOnce({
    documentVersionId,
    extractionVersion: 'pdfjs-native-v1',
    state: 'published',
    attemptCount: 1,
    failureCode: null,
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
        {
          status: 'verified',
          claimId: 'claim-without-step',
          text: 'The Commissioner disputes the limitation.',
          section: 'summary',
          speaker: 'commissioner',
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
  });
  render(<SyntheticProcessingStatus caseId={caseId} documentVersionId={documentVersionId} />);
  expect(await screen.findByText('Source extraction complete')).toBeVisible();
  expect(await screen.findByText('The record supports the stated limitation.')).toBeVisible();
  expect(screen.getByText('Five-step review · ALJ · Step 3')).toBeVisible();
  expect(
    screen.getByText(
      'Investigate record context: the system flagged a possible selective citation.',
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      'Investigate practitioner context: the system flagged a possible specialty mismatch.',
    ),
  ).toBeVisible();
  expect(screen.getAllByText('Record quotation:')).toHaveLength(2);
  expect(screen.getAllByText('The', { selector: 'q' })).toHaveLength(2);
  expect(screen.getAllByRole('link', { name: 'Open cited source' })).toHaveLength(2);
  expect(screen.getAllByRole('link', { name: 'Open cited source' })[0]).toHaveAttribute(
    'href',
    '#source=00000000-0000-4000-8000-000000000031&start=0&end=4',
  );
});

test('does not render an empty investigation prompt list', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const documentVersionId = '00000000-0000-4000-8000-000000000021';
  vi.mocked(getSyntheticDocumentProcessing).mockResolvedValueOnce({
    documentVersionId,
    extractionVersion: 'pdfjs-native-v1',
    state: 'published',
    attemptCount: 1,
    failureCode: null,
    claims: {
      status: 'validated',
      claims: [
        {
          status: 'verified',
          claimId: 'claim-without-flags',
          text: 'The record supports the stated limitation.',
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
  });
  render(<SyntheticProcessingStatus caseId={caseId} documentVersionId={documentVersionId} />);
  expect(await screen.findByText('The record supports the stated limitation.')).toBeVisible();
  expect(screen.queryByRole('list', { name: 'Investigation prompts' })).not.toBeInTheDocument();
});

test('summarizes processing readiness for every registered document', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([
    {
      documentVersionId: '00000000-0000-4000-8000-000000000021',
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
    },
    {
      documentVersionId: '00000000-0000-4000-8000-000000000022',
      extractionVersion: 'pdfjs-native-v1',
      state: 'failed',
      attemptCount: 2,
      failureCode: 'extraction_failed',
    },
    {
      documentVersionId: '00000000-0000-4000-8000-000000000023',
      extractionVersion: 'pdfjs-native-v1',
      state: 'processing',
      attemptCount: 1,
      failureCode: null,
    },
    {
      documentVersionId: '00000000-0000-4000-8000-000000000024',
      extractionVersion: 'pdfjs-native-v1',
      state: 'queued',
      attemptCount: 0,
      failureCode: null,
    },
  ]);
  render(<SyntheticProcessingOverview caseId={caseId} />);
  expect(await screen.findByRole('heading', { name: 'Processing overview' })).toBeVisible();
  expect(screen.getByText('4 documents')).toBeVisible();
  expect(screen.getByText('1 ready')).toBeVisible();
  expect(screen.getByText('1 needs review')).toBeVisible();
  expect(screen.getByText('Document 0022')).toBeVisible();
  expect(screen.getByText('Document 0023').closest('li')).toHaveTextContent('Reading');
  expect(screen.getByText('Document 0024').closest('li')).toHaveTextContent('Queued');
});

test('retries a failed document from the processing overview', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const failedDocument = {
    documentVersionId: '00000000-0000-4000-8000-000000000022',
    extractionVersion: 'pdfjs-native-v1',
    state: 'failed' as const,
    attemptCount: 2,
    failureCode: 'extraction_failed' as const,
  };
  let resolveRetry!: (value: SyntheticDocumentProcessing) => void;
  vi.mocked(listSyntheticDocumentProcessing)
    .mockResolvedValueOnce([failedDocument])
    .mockResolvedValueOnce([{ ...failedDocument, state: 'queued', failureCode: null }]);
  vi.mocked(retrySyntheticDocumentProcessing).mockImplementationOnce(
    () => new Promise((resolve) => (resolveRetry = resolve)),
  );

  const view = render(<SyntheticProcessingOverview caseId={caseId} />);
  expect(await screen.findByText('Document 0022')).toBeVisible();
  const user = userEvent.setup();
  const retryButton = screen.getByRole('button', { name: 'Retry document 0022' });
  expect(retryButton).not.toBeDisabled();
  expect(screen.queryByRole('alert')).toBeNull();
  await user.click(retryButton);
  expect(retryButton).toBeDisabled();
  expect(retryButton).toHaveTextContent('Retrying…');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(retrySyntheticDocumentProcessing).toHaveBeenCalledWith(
    caseId,
    failedDocument.documentVersionId,
  );
  await act(async () => {
    resolveRetry({ ...failedDocument, state: 'queued', failureCode: null });
  });
  expect(await screen.findByText('Queued')).toBeVisible();

  view.unmount();
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([failedDocument]);
  vi.mocked(retrySyntheticDocumentProcessing).mockResolvedValueOnce(undefined);
  render(<SyntheticProcessingOverview caseId={caseId} />);
  await screen.findByText('Document 0022');
  await user.click(screen.getByRole('button', { name: 'Retry document 0022' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be re-queued');
  expect(screen.getByRole('button', { name: 'Retry document 0022' })).not.toBeDisabled();

  cleanup();
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([failedDocument]);
  vi.mocked(retrySyntheticDocumentProcessing).mockRejectedValueOnce(new Error('offline'));
  render(<SyntheticProcessingOverview caseId={caseId} />);
  await screen.findByText('Document 0022');
  await user.click(screen.getByRole('button', { name: 'Retry document 0022' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be re-queued');
  expect(screen.getByRole('button', { name: 'Retry document 0022' })).not.toBeDisabled();
});

test('renders member-scoped revision history on the case summary', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(getSyntheticRevisionHistory).mockResolvedValueOnce([
    {
      recordRevision: 2,
      eventType: 'original_registered',
      documentVersionId: '00000000-0000-4000-8000-000000000043',
    },
  ]);

  render(<SyntheticRevisionHistory caseId={caseId} />);
  expect(await screen.findByRole('heading', { name: 'Revision history' })).toBeVisible();
  expect(screen.getByText('Revision 2')).toBeVisible();
  expect(screen.getByText('Original document registered')).toBeVisible();
  expect(screen.getByText(/000000000043/)).toBeVisible();
});

test('renders upload recovery state on the case summary', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(listSyntheticUploadAttempts).mockResolvedValueOnce([
    {
      documentVersionId: '00000000-0000-4000-8000-000000000044',
      maximumBytes: 512,
      state: 'receiving',
    },
    {
      documentVersionId: '00000000-0000-4000-8000-000000000045',
      maximumBytes: 512,
      state: 'failed',
    },
  ]);

  render(<SyntheticUploadRecovery caseId={caseId} />);
  expect(await screen.findByRole('heading', { name: 'Upload recovery' })).toBeVisible();
  expect(screen.getByText('Document 0044').closest('li')).toHaveTextContent(
    'Transfer still receiving',
  );
  expect(screen.getByText('Document 0045').closest('li')).toHaveTextContent('Transfer failed');
  expect(screen.getAllByText(/Re-select the original file/)).toHaveLength(2);
});

test('shows only explicitly classified source-grounded claims in an artifact section', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const documentVersionId = '00000000-0000-4000-8000-000000000021';
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([
    {
      documentVersionId,
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: {
        status: 'validated',
        claims: [
          {
            status: 'verified',
            claimId: 'medical-claim',
            text: 'The MRI shows multilevel degenerative changes.',
            section: 'medical',
            speaker: 'alj',
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
          {
            status: 'verified',
            claimId: 'unclassified-claim',
            text: 'This claim has no artifact section.',
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
    {
      documentVersionId: '00000000-0000-4000-8000-000000000022',
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: { status: 'refused', code: 'provider_error' },
    },
    {
      documentVersionId: '00000000-0000-4000-8000-000000000023',
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: { status: 'invalid_output' },
    },
  ]);
  render(<SyntheticArtifactSection caseId={caseId} section="medical" />);
  expect(await screen.findByRole('heading', { name: 'Medical chronology' })).toBeVisible();
  expect(screen.getByText(/The MRI shows multilevel degenerative changes\./)).toBeVisible();
  expect(screen.getByText(/ALJ:/)).toBeVisible();
  expect(screen.getByText('Record quotation:')).toBeVisible();
  expect(screen.getByText('The', { selector: 'q' })).toBeVisible();
  expect(screen.queryByText('This claim has no artifact section.')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open cited source' })).toHaveAttribute(
    'href',
    '#source=00000000-0000-4000-8000-000000000031&start=0&end=4',
  );
});

test('deduplicates repeated claim identities across published processing records', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const source = {
    caseId,
    recordRevision: 1,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    documentSha256: 'a'.repeat(64),
    extractionVersion: 'pdfjs-native-v1',
    sourceUnitId: '00000000-0000-4000-8000-000000000031',
    start: 0,
    end: 4,
    quote: 'The ',
  };
  const claim = {
    status: 'verified' as const,
    claimId: 'repeated-medical-claim',
    text: 'The MRI shows multilevel degenerative changes.',
    section: 'medical' as const,
    source,
  };
  const unverifiedClaim = {
    status: 'unverified' as const,
    claimId: claim.claimId,
    text: 'The same MRI finding was not located.',
    section: claim.section,
    message:
      "The review system couldn't find this evidence in the authorized case record." as const,
    reason: 'source_mismatch' as const,
  };
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([
    {
      documentVersionId: source.documentVersionId,
      extractionVersion: source.extractionVersion,
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: { status: 'validated', claims: [unverifiedClaim] },
    },
    {
      documentVersionId: '00000000-0000-4000-8000-000000000022',
      extractionVersion: source.extractionVersion,
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: {
        status: 'validated',
        claims: [{ ...claim, text: 'The same MRI finding was returned again.' }],
      },
    },
    {
      documentVersionId: '00000000-0000-4000-8000-000000000023',
      extractionVersion: source.extractionVersion,
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: {
        status: 'validated',
        claims: [{ ...unverifiedClaim, text: 'A late unverified duplicate appeared.' }],
      },
    },
    {
      documentVersionId: '00000000-0000-4000-8000-000000000024',
      extractionVersion: source.extractionVersion,
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: {
        status: 'validated',
        claims: [{ ...claim, text: 'A late verified duplicate appeared.' }],
      },
    },
  ]);

  render(<SyntheticArtifactSection caseId={caseId} section="medical" />);
  expect(await screen.findByText('The same MRI finding was returned again.')).toBeVisible();
  expect(screen.queryByText('The same MRI finding was not located.')).not.toBeInTheDocument();
  expect(screen.queryByText('A late unverified duplicate appeared.')).not.toBeInTheDocument();
  expect(screen.queryByText('A late verified duplicate appeared.')).not.toBeInTheDocument();
});

test('keeps the first unverified claim when no verified duplicate exists', () => {
  const first = {
    status: 'unverified' as const,
    claimId: 'unverified-duplicate',
    text: 'First unverified result',
    message:
      "The review system couldn't find this evidence in the authorized case record." as const,
    reason: 'source_mismatch' as const,
  };
  const second = { ...first, text: 'Second unverified result' };
  expect(deduplicateProcessingClaims([first, second])).toEqual([first]);
});

test('renders structured medical chronology fields with a source link', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const documentVersionId = '00000000-0000-4000-8000-000000000021';
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([
    {
      documentVersionId,
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: {
        status: 'validated',
        claims: [
          {
            status: 'verified',
            claimId: 'medical-chronology',
            text: 'The claimant attended a follow-up visit.',
            section: 'medical',
            flags: ['possible_specialist_mismatch'],
            chronology: {
              date: '2024-03-12',
              provider: 'Dr. Rivera',
              reason: 'Follow-up evaluation',
              prescription: 'Continue physical therapy',
              importance: 'important',
            },
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
          {
            status: 'verified',
            claimId: 'medical-freeform-chronology-test',
            text: 'The record discusses ongoing symptoms.',
            section: 'medical',
            chronology: { date: '2024-03-13' },
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
  ]);

  render(<SyntheticArtifactSection caseId={caseId} section="medical" />);
  expect(await screen.findByRole('table')).toBeVisible();
  expect(screen.getAllByRole('row')).toHaveLength(3);
  expect(screen.getByRole('cell', { name: '2024-03-12' })).toBeVisible();
  expect(screen.getByRole('cell', { name: '2024-03-12' }).closest('tr')).toHaveClass(
    'chronology-important',
  );
  expect(screen.getByRole('cell', { name: 'Dr. Rivera' })).toBeVisible();
  expect(
    within(screen.getByRole('table')).getByText(
      'Investigate practitioner context: the system flagged a possible specialty mismatch.',
    ),
  ).toBeVisible();
  expect(screen.getAllByRole('cell', { name: 'Not provided' })).toHaveLength(3);
  expect(screen.getAllByRole('link', { name: 'Open record' })[0]).toHaveAttribute(
    'href',
    '#source=00000000-0000-4000-8000-000000000031&start=0&end=4',
  );
});

test('explains empty and unverified artifact sections without inventing entries', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([
    {
      documentVersionId: '00000000-0000-4000-8000-000000000021',
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: {
        status: 'validated',
        claims: [
          {
            status: 'unverified',
            claimId: 'procedural-unverified',
            text: 'A procedural date needs investigation.',
            section: 'procedural',
            message: "The review system couldn't find this evidence in the authorized case record.",
            reason: 'quote_mismatch',
          },
        ],
      },
    },
  ]);
  render(<SyntheticArtifactSection caseId={caseId} section="procedural" />);
  expect(await screen.findByText('A procedural date needs investigation.')).toBeVisible();
  expect(
    screen.getByText(
      "The review system couldn't find this evidence in the authorized case record.",
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      'Investigate whether the citation reflects the complete record and whether the source context matches the impairment at issue.',
    ),
  ).toBeVisible();

  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([]);
  const view = render(<SyntheticArtifactSection caseId={caseId} section="five_step" />);
  expect(await screen.findByText(/No explicitly classified source-grounded entries/)).toBeVisible();
  view.unmount();
});

test('renders procedural chronology names and safe fallback values', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([
    {
      documentVersionId: '00000000-0000-4000-8000-000000000021',
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: {
        status: 'validated',
        claims: [
          {
            status: 'unverified',
            claimId: 'procedural-chronology',
            text: 'The Appeals Council denied review.',
            section: 'procedural',
            chronology: { date: '2024-04-01', name: 'Appeals Council denial' },
            message: "The review system couldn't find this evidence in the authorized case record.",
            reason: 'quote_mismatch',
          },
          {
            status: 'unverified',
            claimId: 'procedural-chronology-without-name',
            text: 'A procedural event needs review.',
            section: 'procedural',
            chronology: { date: '2024-04-02' },
            message: "The review system couldn't find this evidence in the authorized case record.",
            reason: 'quote_mismatch',
          },
        ],
      },
    },
  ]);

  render(<SyntheticArtifactSection caseId={caseId} section="procedural" />);
  expect(await screen.findByRole('table')).toBeVisible();
  expect(screen.getByRole('cell', { name: 'Appeals Council denial' })).toBeVisible();
  expect(screen.getByRole('cell', { name: 'Not provided' })).toBeVisible();
  expect(screen.getAllByRole('cell', { name: 'Investigate' })).toHaveLength(2);
});

test('groups five-step claims by their validated evaluation step', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([
    {
      documentVersionId: '00000000-0000-4000-8000-000000000021',
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: {
        status: 'validated',
        claims: [
          {
            status: 'unverified',
            claimId: 'five-step-one',
            text: 'Step one evidence needs investigation.',
            section: 'five_step',
            step: 1,
            message: "The review system couldn't find this evidence in the authorized case record.",
            reason: 'quote_mismatch',
          },
          {
            status: 'unverified',
            claimId: 'five-step-three',
            text: 'Step three evidence needs investigation.',
            section: 'five_step',
            step: 3,
            message: "The review system couldn't find this evidence in the authorized case record.",
            reason: 'quote_mismatch',
          },
        ],
      },
    },
  ]);

  render(<SyntheticArtifactSection caseId={caseId} section="five_step" />);
  expect(await screen.findByRole('heading', { name: 'Step 1' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Step 3' })).toBeVisible();
  expect(screen.getByText('Step one evidence needs investigation.')).toBeVisible();
  expect(screen.getByText('Step three evidence needs investigation.')).toBeVisible();
});

test('groups five-step claims by their validated speaker within a step', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([
    {
      documentVersionId: '00000000-0000-4000-8000-000000000021',
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: {
        status: 'validated',
        claims: [
          {
            status: 'unverified',
            claimId: 'five-step-alj',
            text: 'The ALJ argument needs investigation.',
            section: 'five_step',
            step: 1,
            speaker: 'alj',
            message: "The review system couldn't find this evidence in the authorized case record.",
            reason: 'quote_mismatch',
          },
          {
            status: 'unverified',
            claimId: 'five-step-plaintiff',
            text: 'The plaintiff argument needs investigation.',
            section: 'five_step',
            step: 1,
            speaker: 'plaintiff',
            message: "The review system couldn't find this evidence in the authorized case record.",
            reason: 'quote_mismatch',
          },
        ],
      },
    },
  ]);

  render(<SyntheticArtifactSection caseId={caseId} section="five_step" />);
  expect(await screen.findByRole('heading', { name: 'ALJ' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Plaintiff' })).toBeVisible();
});

test('filters classified artifact entries with a case-insensitive search', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([
    {
      documentVersionId: '00000000-0000-4000-8000-000000000021',
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: {
        status: 'validated',
        claims: [
          {
            status: 'unverified',
            claimId: 'medical-mri',
            text: 'The MRI showed degenerative changes.',
            section: 'medical',
            message: "The review system couldn't find this evidence in the authorized case record.",
            reason: 'quote_mismatch',
          },
          {
            status: 'unverified',
            claimId: 'medical-therapy',
            text: 'The claimant completed physical therapy.',
            section: 'medical',
            message: "The review system couldn't find this evidence in the authorized case record.",
            reason: 'quote_mismatch',
          },
        ],
      },
    },
  ]);
  const user = userEvent.setup();
  render(<SyntheticArtifactSection caseId={caseId} section="medical" />);
  expect(
    (await screen.findAllByText('The MRI showed degenerative changes.')).length,
  ).toBeGreaterThan(0);
  expect(screen.getByText('The claimant completed physical therapy.')).toBeVisible();
  await user.type(screen.getByLabelText('Search medical chronology'), '  mRi  ');
  expect(screen.getByText('The MRI showed degenerative changes.')).toBeVisible();
  expect(screen.queryByText('The claimant completed physical therapy.')).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText('Search medical chronology'));
  await user.type(screen.getByLabelText('Search medical chronology'), 'no match');
  expect(screen.getByText('No classified entries match this search.')).toBeVisible();
});

test('filters classified artifact entries by verification status', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([
    {
      documentVersionId: '00000000-0000-4000-8000-000000000021',
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: {
        status: 'validated',
        claims: [
          {
            status: 'verified',
            claimId: 'medical-verified',
            text: 'The MRI showed degenerative changes.',
            section: 'medical',
            source: {
              caseId,
              recordRevision: 1,
              documentVersionId: '00000000-0000-4000-8000-000000000021',
              documentSha256: 'a'.repeat(64),
              extractionVersion: 'pdfjs-native-v1',
              sourceUnitId: '00000000-0000-4000-8000-000000000031',
              start: 0,
              end: 32,
              quote: 'The MRI showed degenerative changes.',
            },
          },
          {
            status: 'unverified',
            claimId: 'medical-unverified',
            text: 'The claimant completed physical therapy.',
            section: 'medical',
            message: "The review system couldn't find this evidence in the authorized case record.",
            reason: 'quote_mismatch',
          },
        ],
      },
    },
  ]);
  const user = userEvent.setup();
  render(<SyntheticArtifactSection caseId={caseId} section="medical" />);
  expect(
    (await screen.findAllByText('The MRI showed degenerative changes.')).length,
  ).toBeGreaterThan(0);
  expect(screen.getByText('The claimant completed physical therapy.')).toBeVisible();
  await user.selectOptions(screen.getByLabelText('Filter medical chronology'), 'verified');
  expect(screen.getAllByText('The MRI showed degenerative changes.').length).toBeGreaterThan(0);
  expect(screen.queryByText('The claimant completed physical therapy.')).not.toBeInTheDocument();
});

test('filters classified artifact entries by validated speaker', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([
    {
      documentVersionId: '00000000-0000-4000-8000-000000000021',
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: {
        status: 'validated',
        claims: [
          {
            status: 'unverified',
            claimId: 'medical-alj',
            text: 'The ALJ medical argument needs investigation.',
            section: 'medical',
            speaker: 'alj',
            message: "The review system couldn't find this evidence in the authorized case record.",
            reason: 'quote_mismatch',
          },
          {
            status: 'unverified',
            claimId: 'medical-plaintiff',
            text: 'The plaintiff medical argument needs investigation.',
            section: 'medical',
            speaker: 'plaintiff',
            message: "The review system couldn't find this evidence in the authorized case record.",
            reason: 'quote_mismatch',
          },
        ],
      },
    },
  ]);
  const user = userEvent.setup();
  render(<SyntheticArtifactSection caseId={caseId} section="medical" />);
  expect(await screen.findByText(/The ALJ medical argument needs investigation/)).toBeVisible();
  expect(screen.getByText(/The plaintiff medical argument needs investigation/)).toBeVisible();
  await user.selectOptions(screen.getByLabelText('Filter speaker in medical chronology'), 'alj');
  expect(screen.getByText(/The ALJ medical argument needs investigation/)).toBeVisible();
  expect(
    screen.queryByText(/The plaintiff medical argument needs investigation/),
  ).not.toBeInTheDocument();
});

test('reports and retries an unavailable artifact section', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(listSyntheticDocumentProcessing).mockRejectedValueOnce(new Error('offline'));
  render(<SyntheticArtifactSection caseId={caseId} section="medical" />);
  expect(
    await screen.findByText('Medical chronology is unavailable until processing can be confirmed.'),
  ).toBeVisible();
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([]);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry medical chronology' }));
  expect(await screen.findByText(/No explicitly classified source-grounded entries/)).toBeVisible();
});

test('shows the loading state while an artifact section request is pending', () => {
  vi.mocked(listSyntheticDocumentProcessing).mockImplementationOnce(() => new Promise(() => {}));
  render(
    <SyntheticArtifactSection caseId="00000000-0000-4000-8000-000000000002" section="medical" />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Loading medical chronology…');
});

test('ignores processing records without validated claims', async () => {
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([
    {
      documentVersionId: '00000000-0000-4000-8000-000000000021',
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
    },
    {
      documentVersionId: '00000000-0000-4000-8000-000000000022',
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: { status: 'refused', code: 'provider_error' },
    },
    {
      documentVersionId: '00000000-0000-4000-8000-000000000023',
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: { status: 'invalid_output' },
    },
  ]);
  render(
    <SyntheticArtifactSection caseId="00000000-0000-4000-8000-000000000002" section="medical" />,
  );
  expect(await screen.findByText(/No explicitly classified source-grounded entries/)).toBeVisible();
});

test('clears an artifact section while loading a different case', async () => {
  vi.mocked(listSyntheticDocumentProcessing)
    .mockResolvedValueOnce([])
    .mockImplementationOnce(() => new Promise(() => {}));
  const view = render(
    <SyntheticArtifactSection caseId="00000000-0000-4000-8000-000000000002" section="medical" />,
  );
  expect(await screen.findByText(/No explicitly classified source-grounded entries/)).toBeVisible();
  view.rerender(
    <SyntheticArtifactSection caseId="00000000-0000-4000-8000-000000000003" section="medical" />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Loading medical chronology…');
});

test('reports and retries an unavailable processing overview', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  vi.mocked(listSyntheticDocumentProcessing).mockRejectedValueOnce(new Error('offline'));
  render(<SyntheticProcessingOverview caseId={caseId} />);
  expect(await screen.findByText('Processing overview unavailable.')).toBeVisible();
  vi.mocked(listSyntheticDocumentProcessing).mockResolvedValueOnce([]);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry processing overview' }));
  expect(
    await screen.findByText('No registered documents have processing records yet.'),
  ).toBeVisible();
});

test('shows loading while processing overview data is pending', () => {
  vi.mocked(listSyntheticDocumentProcessing).mockImplementationOnce(() => new Promise(() => {}));
  render(<SyntheticProcessingOverview caseId="00000000-0000-4000-8000-000000000002" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading processing overview');
});

test('reloads processing overview when the case changes', async () => {
  vi.mocked(listSyntheticDocumentProcessing)
    .mockResolvedValueOnce([])
    .mockImplementationOnce(() => new Promise(() => {}));
  const view = render(
    <SyntheticProcessingOverview caseId="00000000-0000-4000-8000-000000000002" />,
  );
  expect(
    await screen.findByText('No registered documents have processing records yet.'),
  ).toBeVisible();
  view.rerender(<SyntheticProcessingOverview caseId="00000000-0000-4000-8000-000000000003" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading processing overview');
  expect(listSyntheticDocumentProcessing).toHaveBeenLastCalledWith(
    '00000000-0000-4000-8000-000000000003',
  );
});

test('only renders claims for a published processing object', () => {
  expect(hasProcessingClaims('unavailable')).toBe(false);
  expect(hasProcessingClaims(null)).toBe(false);
  expect(hasProcessingClaims(undefined)).toBe(false);
  expect(
    hasProcessingClaims({
      documentVersionId: '00000000-0000-4000-8000-000000000010',
      extractionVersion: 'pdfjs-native-v1',
      state: 'published',
      attemptCount: 1,
      failureCode: null,
      claims: { status: 'validated', claims: [] },
    }),
  ).toBe(true);
});

test('describes empty, refused, invalid, and unverified claim results', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const documentVersionId = '00000000-0000-4000-8000-000000000021';
  const base = {
    documentVersionId,
    extractionVersion: 'pdfjs-native-v1',
    state: 'published' as const,
    attemptCount: 1,
    failureCode: null,
  };
  vi.mocked(getSyntheticDocumentProcessing).mockResolvedValueOnce({
    ...base,
    claims: { status: 'validated', claims: [] },
  });
  const empty = render(
    <SyntheticProcessingStatus caseId={caseId} documentVersionId={documentVersionId} />,
  );
  expect(await screen.findByText('No source-grounded claims were returned.')).toBeVisible();
  empty.unmount();

  vi.mocked(getSyntheticDocumentProcessing)
    .mockReset()
    .mockResolvedValueOnce({
      ...base,
      claims: { status: 'refused', code: 'provider_error' },
    });
  const refused = render(
    <SyntheticProcessingStatus caseId={caseId} documentVersionId={documentVersionId} />,
  );
  expect(await screen.findByText(/Claim generation was not available/)).toBeVisible();
  refused.unmount();

  vi.mocked(getSyntheticDocumentProcessing)
    .mockReset()
    .mockResolvedValueOnce({
      ...base,
      claims: { status: 'invalid_output' },
    });
  const invalid = render(
    <SyntheticProcessingStatus caseId={caseId} documentVersionId={documentVersionId} />,
  );
  expect(
    await screen.findByText('Claim generation returned an invalid result for review.'),
  ).toBeVisible();
  invalid.unmount();

  vi.mocked(getSyntheticDocumentProcessing)
    .mockReset()
    .mockResolvedValueOnce({
      ...base,
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
    });
  render(<SyntheticProcessingStatus caseId={caseId} documentVersionId={documentVersionId} />);
  expect(
    await screen.findByText(
      "The review system couldn't find this evidence in the authorized case record.",
    ),
  ).toBeVisible();
});

test('explains when a saved synthetic case is not available to this reviewer', async () => {
  const caseId = '00000000-0000-4000-8000-000000000099';
  vi.mocked(getSyntheticCase).mockResolvedValueOnce(undefined);
  render(
    <MemoryRouter initialEntries={[`/cases/${caseId}`]}>
      <App />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: 'Case unavailable' })).toBeVisible();
  expect(screen.getByText('This case is not available in your synthetic workspace.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Back to saved cases' })).toHaveAttribute(
    'href',
    '/cases',
  );
  expect(getSyntheticCase).toHaveBeenCalledExactlyOnceWith(caseId);
});

test('lists registered synthetic originals on the saved case page', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const documentVersionIds = [21, 22, 23, 24, 25, 26].map(
    (suffix) => `00000000-0000-4000-8000-0000000000${suffix}`,
  );
  vi.mocked(getSyntheticCase).mockResolvedValueOnce({
    caseId,
    label: 'Synthetic saved draft',
    recordRevision: 1,
  });
  vi.mocked(listSyntheticOriginals).mockResolvedValueOnce(
    documentVersionIds.map((documentVersionId, index) => ({
      caseId,
      documentVersionId,
      sha256: 'a'.repeat(64),
      byteLength: 12 + index,
      ...(index === 0 ? { fileName: '7-brief.pdf', mediaType: 'application/pdf' } : {}),
    })),
  );
  let resolveQueued!: (value: SyntheticDocumentProcessing) => void;
  vi.mocked(getSyntheticDocumentProcessing).mockImplementationOnce(
    () =>
      new Promise<SyntheticDocumentProcessing>((resolve) => {
        resolveQueued = resolve;
      }),
  );
  for (const [index, state] of ['processing', 'published', 'failed'].entries())
    vi.mocked(getSyntheticDocumentProcessing).mockResolvedValueOnce({
      documentVersionId: documentVersionIds[index + 1] as string,
      extractionVersion: 'pdfjs-native-v1',
      state: state as 'queued' | 'processing' | 'published' | 'failed',
      attemptCount: 1,
      failureCode: state === 'failed' ? 'extraction_failed' : null,
    });
  vi.mocked(getSyntheticDocumentProcessing)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('synthetic status outage'));
  render(
    <MemoryRouter initialEntries={[`/cases/${caseId}`]}>
      <App />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: 'Registered originals' })).toBeVisible();
  expect(await screen.findByText(documentVersionIds[0] as string)).toBeVisible();
  expect(screen.getByText('7-brief.pdf')).toBeVisible();
  expect(screen.getByText('application/pdf')).toBeVisible();
  expect(screen.getByText('12 bytes')).toBeVisible();
  expect(screen.getAllByText('Loading processing status…')[0]).toBeVisible();
  resolveQueued({
    documentVersionId: documentVersionIds[0] as string,
    extractionVersion: 'pdfjs-native-v1',
    state: 'queued',
    attemptCount: 0,
    failureCode: null,
  });
  expect(await screen.findByText('Waiting to process')).toBeVisible();
  expect(await screen.findByText('Extracting record text')).toBeVisible();
  expect(await screen.findByText('Source extraction complete')).toBeVisible();
  expect(await screen.findByText('Extraction could not complete')).toBeVisible();
  expect(await screen.findByText('No processing record found')).toBeVisible();
  expect(await screen.findByText('Processing status unavailable')).toBeVisible();
  expect(listSyntheticOriginals).toHaveBeenCalledExactlyOnceWith(caseId);
  for (const [index, documentVersionId] of documentVersionIds.entries())
    expect(getSyntheticDocumentProcessing).toHaveBeenNthCalledWith(
      index + 1,
      caseId,
      documentVersionId,
    );

  cleanup();
  vi.clearAllMocks();
  const nextCaseId = '00000000-0000-4000-8000-000000000003';
  const documentVersionId = documentVersionIds[0] as string;
  vi.mocked(getSyntheticDocumentProcessing).mockResolvedValueOnce({
    documentVersionId,
    extractionVersion: 'pdfjs-native-v1',
    state: 'published',
    attemptCount: 1,
    failureCode: null,
  });
  let resolveNextStatus!: (value: SyntheticDocumentProcessing) => void;
  vi.mocked(getSyntheticDocumentProcessing).mockImplementationOnce(
    () =>
      new Promise<SyntheticDocumentProcessing>((resolve) => {
        resolveNextStatus = resolve;
      }),
  );
  const status = render(
    <SyntheticProcessingStatus caseId={caseId} documentVersionId={documentVersionId} />,
  );
  expect(await screen.findByText('Source extraction complete')).toBeVisible();
  status.rerender(
    <SyntheticProcessingStatus caseId={nextCaseId} documentVersionId={documentVersionId} />,
  );
  expect(screen.getByText('Loading processing status…')).toBeVisible();
  resolveNextStatus({
    documentVersionId,
    extractionVersion: 'pdfjs-native-v1',
    state: 'queued',
    attemptCount: 0,
    failureCode: null,
  });
  expect(await screen.findByText('Waiting to process')).toBeVisible();
  expect(getSyntheticDocumentProcessing).toHaveBeenNthCalledWith(2, nextCaseId, documentVersionId);

  cleanup();
  vi.clearAllMocks();
  const original = {
    caseId,
    documentVersionId,
    sha256: 'a'.repeat(64),
    byteLength: 12,
  };
  let resolveStaleInventory!: (value: SyntheticOriginalReceipt[]) => void;
  let resolveNextInventory!: (value: SyntheticOriginalReceipt[]) => void;
  vi.mocked(listSyntheticOriginals)
    .mockImplementationOnce(
      () =>
        new Promise<SyntheticOriginalReceipt[]>((resolve) => {
          resolveStaleInventory = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<SyntheticOriginalReceipt[]>((resolve) => {
          resolveNextInventory = resolve;
        }),
    );
  const inventory = render(<SyntheticOriginalInventory caseId={caseId} />);
  inventory.rerender(<SyntheticOriginalInventory caseId={nextCaseId} />);
  await act(async () => resolveStaleInventory([original]));
  expect(screen.getByText('Loading registered originals…')).toBeVisible();
  expect(screen.queryByText(documentVersionId)).not.toBeInTheDocument();
  await act(async () => resolveNextInventory([]));
  expect(await screen.findByText('No registered originals yet.')).toBeVisible();
});

test('opens a registered original in a new document tab', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const documentVersionId = '00000000-0000-4000-8000-000000000021';
  vi.mocked(listSyntheticOriginals).mockResolvedValueOnce([
    { caseId, documentVersionId, sha256: 'a'.repeat(64), byteLength: 12 },
  ]);
  vi.mocked(getSyntheticOriginal).mockResolvedValueOnce(
    new Blob(['synthetic pdf bytes'], { type: 'application/pdf' }),
  );
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic');
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const user = userEvent.setup();
  render(<SyntheticOriginalInventory caseId={caseId} />);

  await user.click(await screen.findByRole('button', { name: 'Open original document' }));
  expect(getSyntheticOriginal).toHaveBeenCalledExactlyOnceWith(caseId, documentVersionId);
  expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(expect.any(Blob));
  expect(open).toHaveBeenCalledExactlyOnceWith('blob:synthetic', '_blank', 'noopener,noreferrer');
  expect(await screen.findByTitle('Original PDF viewer')).toHaveAttribute('src', 'blob:synthetic');
  expect(screen.getByText('Document 0021 is open beside the record.')).toBeVisible();
  createObjectURL.mockRestore();
  open.mockRestore();
});

test('releases an opened original object URL when the inventory unmounts', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const documentVersionId = '00000000-0000-4000-8000-000000000021';
  vi.mocked(listSyntheticOriginals).mockResolvedValueOnce([
    { caseId, documentVersionId, sha256: 'a'.repeat(64), byteLength: 12 },
  ]);
  vi.mocked(getSyntheticOriginal).mockResolvedValueOnce(
    new Blob(['synthetic pdf bytes'], { type: 'application/pdf' }),
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:releasable');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const user = userEvent.setup();
  const view = render(<SyntheticOriginalInventory caseId={caseId} />);

  await user.click(await screen.findByRole('button', { name: 'Open original document' }));
  view.unmount();

  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:releasable');
});

test('reports an unavailable original without opening a tab', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const documentVersionId = '00000000-0000-4000-8000-000000000021';
  vi.mocked(listSyntheticOriginals).mockResolvedValueOnce([
    { caseId, documentVersionId, sha256: 'a'.repeat(64), byteLength: 12 },
  ]);
  vi.mocked(getSyntheticOriginal).mockRejectedValueOnce(new Error('original_unavailable'));
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const user = userEvent.setup();
  render(<SyntheticOriginalInventory caseId={caseId} />);

  await user.click(await screen.findByRole('button', { name: 'Open original document' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Original document unavailable.');
  expect(open).not.toHaveBeenCalled();
  open.mockRestore();
});

test('shows opening progress and clears a previous original error after retry', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const documentVersionId = '00000000-0000-4000-8000-000000000021';
  vi.mocked(listSyntheticOriginals).mockResolvedValueOnce([
    { caseId, documentVersionId, sha256: 'a'.repeat(64), byteLength: 12 },
  ]);
  let resolveDocument!: (value: Blob) => void;
  vi.mocked(getSyntheticOriginal)
    .mockRejectedValueOnce(new Error('original_unavailable'))
    .mockImplementationOnce(
      () =>
        new Promise<Blob>((resolve) => {
          resolveDocument = resolve;
        }),
    );
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic');
  vi.spyOn(window, 'open').mockReturnValue(null);
  const user = userEvent.setup();
  render(<SyntheticOriginalInventory caseId={caseId} />);

  const button = await screen.findByRole('button', { name: 'Open original document' });
  await user.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('Original document unavailable.');
  await user.click(screen.getByRole('button', { name: 'Open original document' }));
  expect(screen.getByRole('button', { name: 'Opening original…' })).toBeDisabled();
  resolveDocument(new Blob(['retry bytes'], { type: 'application/pdf' }));
  expect(await screen.findByRole('button', { name: 'Open original document' })).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  createObjectURL.mockRestore();
});

test('polls active document processing until a terminal status arrives', async () => {
  vi.useFakeTimers();
  try {
    const caseId = '00000000-0000-4000-8000-000000000002';
    const documentVersionId = '00000000-0000-4000-8000-000000000021';
    vi.mocked(getSyntheticDocumentProcessing)
      .mockResolvedValueOnce({
        documentVersionId,
        extractionVersion: 'pdfjs-native-v1',
        state: 'queued',
        attemptCount: 0,
        failureCode: null,
      })
      .mockResolvedValueOnce({
        documentVersionId,
        extractionVersion: 'pdfjs-native-v1',
        state: 'processing',
        attemptCount: 1,
        failureCode: null,
      })
      .mockResolvedValueOnce({
        documentVersionId,
        extractionVersion: 'pdfjs-native-v1',
        state: 'published',
        attemptCount: 1,
        failureCode: null,
      });

    render(<SyntheticProcessingStatus caseId={caseId} documentVersionId={documentVersionId} />);
    await act(async () => undefined);
    expect(screen.getByText('Waiting to process')).toBeVisible();

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByText('Extracting record text')).toBeVisible();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByText('Source extraction complete')).toBeVisible();

    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(getSyntheticDocumentProcessing).toHaveBeenCalledTimes(3);
    expect(getSyntheticDocumentProcessing).toHaveBeenCalledWith(caseId, documentVersionId);

    cleanup();
    vi.mocked(getSyntheticDocumentProcessing).mockReset().mockResolvedValueOnce({
      documentVersionId,
      extractionVersion: 'pdfjs-native-v1',
      state: 'queued',
      attemptCount: 0,
      failureCode: null,
    });
    const queued = render(
      <SyntheticProcessingStatus caseId={caseId} documentVersionId={documentVersionId} />,
    );
    await act(async () => undefined);
    queued.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(getSyntheticDocumentProcessing).toHaveBeenCalledTimes(1);

    vi.mocked(getSyntheticDocumentProcessing).mockReset();
    let resolveStale!: (value: SyntheticDocumentProcessing) => void;
    vi.mocked(getSyntheticDocumentProcessing)
      .mockImplementationOnce(
        () =>
          new Promise<SyntheticDocumentProcessing>((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValueOnce({
        documentVersionId,
        extractionVersion: 'pdfjs-native-v1',
        state: 'published',
        attemptCount: 1,
        failureCode: null,
      });
    const status = render(
      <SyntheticProcessingStatus caseId={caseId} documentVersionId={documentVersionId} />,
    );
    const nextCaseId = '00000000-0000-4000-8000-000000000003';
    status.rerender(
      <SyntheticProcessingStatus caseId={nextCaseId} documentVersionId={documentVersionId} />,
    );
    await act(async () => undefined);
    expect(screen.getByText('Source extraction complete')).toBeVisible();
    await act(async () =>
      resolveStale({
        documentVersionId,
        extractionVersion: 'pdfjs-native-v1',
        state: 'queued',
        attemptCount: 0,
        failureCode: null,
      }),
    );
    expect(screen.getByText('Source extraction complete')).toBeVisible();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(getSyntheticDocumentProcessing).toHaveBeenCalledTimes(2);

    status.unmount();
    vi.mocked(getSyntheticDocumentProcessing).mockReset();
    let rejectStale!: (reason: Error) => void;
    vi.mocked(getSyntheticDocumentProcessing)
      .mockImplementationOnce(
        () =>
          new Promise<SyntheticDocumentProcessing>((_resolve, reject) => {
            rejectStale = reject;
          }),
      )
      .mockResolvedValueOnce({
        documentVersionId,
        extractionVersion: 'pdfjs-native-v1',
        state: 'published',
        attemptCount: 1,
        failureCode: null,
      });
    const rejected = render(
      <SyntheticProcessingStatus caseId={caseId} documentVersionId={documentVersionId} />,
    );
    rejected.rerender(
      <SyntheticProcessingStatus caseId={nextCaseId} documentVersionId={documentVersionId} />,
    );
    await act(async () => undefined);
    await act(async () => rejectStale(new Error('stale request failed')));
    expect(screen.getByText('Source extraction complete')).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});

test('retries source discovery and opens exact page text with its provenance', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const sourceUnitId = '00000000-0000-4000-8000-000000000031';
  const reference: SyntheticTextSourceReference = {
    sourceUnitId,
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    recordRevision: 1,
    documentSha256: 'a'.repeat(64),
    extractionVersion: 'synthetic-native-v1',
    pageNumber: 7,
  };
  const source: SyntheticTextSource = {
    ...reference,
    rawText: 'Exact synthetic page text\nwith preserved spacing.',
    geometry: {
      view: [0, 0, 612, 792],
      rotation: 0,
      items: [
        { start: 0, end: 5, transform: [1, 0, 0, 1, 72, 720], width: 30, height: 12 },
        { start: 6, end: 10, transform: [1, 0, 0, 1, 72, 700], width: 24, height: 12 },
      ],
    },
  };
  let resolveInventory!: (value: SyntheticTextSourceReference[]) => void;
  let resolveSource!: (value: SyntheticTextSource) => void;
  vi.mocked(getSyntheticCase).mockResolvedValueOnce({
    caseId,
    label: 'Synthetic source review',
    recordRevision: 1,
  });
  vi.mocked(listSyntheticTextSources)
    .mockRejectedValueOnce(new Error('synthetic inventory outage'))
    .mockImplementationOnce(
      () =>
        new Promise<SyntheticTextSourceReference[]>((resolve) => {
          resolveInventory = resolve;
        }),
    );
  vi.mocked(getSyntheticTextSource)
    .mockRejectedValueOnce(new Error('synthetic source outage'))
    .mockImplementationOnce(
      () =>
        new Promise<SyntheticTextSource>((resolve) => {
          resolveSource = resolve;
        }),
    )
    .mockResolvedValueOnce(undefined);
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[`/cases/${caseId}`]}>
      <App />
    </MemoryRouter>,
  );

  expect(await screen.findByText('Source inventory unavailable.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Retry loading sources' }));
  expect(screen.getByRole('status')).toHaveTextContent('Loading record sources');
  resolveInventory([reference]);
  await user.click(await screen.findByRole('button', { name: 'Open document 0021, page 7' }));
  expect(await screen.findByText('Source text unavailable.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Retry opening source' }));
  expect(screen.getByRole('status')).toHaveTextContent('Loading source page 7');
  resolveSource(source);

  expect(await screen.findByRole('heading', { name: 'Document 0021, page 7' })).toBeVisible();
  expect(
    screen.getByText(
      (_content, element) => element?.tagName === 'PRE' && element.textContent === source.rawText,
    ),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Verify and highlight' })).toBeDisabled();
  expect(screen.getByText('Extraction synthetic-native-v1')).toBeVisible();
  expect(
    screen.getByText((_content, element) => element?.textContent === 'Page alignment regions: 2.'),
  ).toBeVisible();
  expect(screen.getByRole('img', { name: 'Page alignment overlay' })).toBeVisible();
  expect(screen.getAllByRole('img', { name: /Alignment region/ })).toHaveLength(2);
  expect(screen.getByText(`SHA-256 ${source.documentSha256}`)).toBeVisible();
  await user.type(screen.getByLabelText('Verify a quotation against this page'), 'synthetic page');
  await user.click(screen.getByRole('button', { name: 'Verify and highlight' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Citation verified against the persisted source text',
  );
  expect(screen.getByText('synthetic page', { selector: 'mark' })).toBeVisible();
  expect(
    screen.getByText('synthetic page', { selector: 'mark' }).previousSibling,
  ).toHaveTextContent('Exact');
  expect(screen.getByText('synthetic page', { selector: 'mark' }).nextSibling).toHaveTextContent(
    'text with preserved spacing.',
  );
  expect(verifySyntheticTextSpan).toHaveBeenCalledWith(caseId, sourceUnitId, {
    recordRevision: source.recordRevision,
    documentVersionId: source.documentVersionId,
    documentSha256: source.documentSha256,
    extractionVersion: source.extractionVersion,
    sourceUnitId,
    start: source.rawText.indexOf('synthetic page'),
    end: source.rawText.indexOf('synthetic page') + 'synthetic page'.length,
    quote: 'synthetic page',
  });
  await user.clear(screen.getByLabelText('Verify a quotation against this page'));
  expect(screen.queryByText('synthetic page', { selector: 'mark' })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Verify a quotation against this page'), 'Exact');
  await user.click(screen.getByRole('button', { name: 'Verify and highlight' }));
  expect(screen.getByText('Exact', { selector: 'mark' })).toBeVisible();
  await user.clear(screen.getByLabelText('Verify a quotation against this page'));
  await user.type(screen.getByLabelText('Verify a quotation against this page'), 'not present');
  await user.click(screen.getByRole('button', { name: 'Verify and highlight' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The citation could not be verified against this page',
  );
  vi.mocked(verifySyntheticTextSpan).mockRejectedValueOnce(new Error('source unavailable'));
  await user.clear(screen.getByLabelText('Verify a quotation against this page'));
  await user.type(screen.getByLabelText('Verify a quotation against this page'), 'Exact');
  await user.click(screen.getByRole('button', { name: 'Verify and highlight' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The citation could not be verified against this page',
  );
  expect(
    screen.getByText(
      (_content, element) => element?.tagName === 'PRE' && element.textContent === source.rawText,
    ),
  ).toBeVisible();
  expect(listSyntheticTextSources).toHaveBeenCalledTimes(2);
  expect(getSyntheticTextSource).toHaveBeenNthCalledWith(1, caseId, sourceUnitId);
  expect(getSyntheticTextSource).toHaveBeenNthCalledWith(2, caseId, sourceUnitId);
  await user.click(screen.getByRole('button', { name: 'Open document 0021, page 7' }));
  expect(await screen.findByText('The selected source is no longer available.')).toBeVisible();
  expect(screen.queryByText('synthetic page', { selector: 'mark' })).not.toBeInTheDocument();
  expect(getSyntheticTextSource).toHaveBeenNthCalledWith(3, caseId, sourceUnitId);

  cleanup();
  vi.clearAllMocks();
  const nextCaseId = '00000000-0000-4000-8000-000000000003';
  const emptyCaseId = '00000000-0000-4000-8000-000000000004';
  const nextReference: SyntheticTextSourceReference = {
    ...reference,
    caseId: nextCaseId,
    sourceUnitId: '00000000-0000-4000-8000-000000000032',
    pageNumber: 8,
  };
  vi.mocked(listSyntheticTextSources)
    .mockResolvedValueOnce([reference])
    .mockResolvedValueOnce([nextReference])
    .mockResolvedValueOnce([]);
  vi.mocked(getSyntheticTextSource)
    .mockResolvedValueOnce(source)
    .mockResolvedValueOnce({ ...nextReference, rawText: 'Next case source text.' });
  const workspace = render(<SyntheticSourceWorkspace caseId={caseId} />);
  await user.click(await screen.findByRole('button', { name: 'Open document 0021, page 7' }));
  expect(await screen.findByRole('heading', { name: 'Document 0021, page 7' })).toBeVisible();

  workspace.rerender(<SyntheticSourceWorkspace caseId={nextCaseId} />);
  expect(await screen.findByRole('button', { name: 'Open document 0021, page 8' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Document 0021, page 7' })).not.toBeInTheDocument();
  expect(screen.queryByText('Loading source page 7')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Open document 0021, page 8' }));
  expect(await screen.findByRole('heading', { name: 'Document 0021, page 8' })).toBeVisible();
  expect(getSyntheticTextSource).toHaveBeenLastCalledWith(nextCaseId, nextReference.sourceUnitId);

  workspace.rerender(<SyntheticSourceWorkspace caseId={emptyCaseId} />);
  expect(await screen.findByText('No extracted sources are available yet.')).toBeVisible();
  expect(listSyntheticTextSources).toHaveBeenNthCalledWith(3, emptyCaseId);
});

test('opens a source targeted by a persisted claim link', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const sourceUnitId = '00000000-0000-4000-8000-000000000031';
  const reference: SyntheticTextSourceReference = {
    sourceUnitId,
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    recordRevision: 1,
    documentSha256: 'a'.repeat(64),
    extractionVersion: 'synthetic-native-v1',
    pageNumber: 7,
  };
  vi.mocked(listSyntheticTextSources).mockResolvedValueOnce([reference]);
  vi.mocked(getSyntheticTextSource).mockResolvedValueOnce({
    ...reference,
    rawText: 'Claim source text.',
  });
  window.history.replaceState({}, '', `#source=${sourceUnitId}&start=0&end=5`);
  render(<SyntheticSourceWorkspace caseId={caseId} />);
  expect(await screen.findByRole('heading', { name: 'Document 0021, page 7' })).toBeVisible();
  expect(getSyntheticTextSource).toHaveBeenCalledWith(caseId, sourceUnitId);
  expect(sourceUnitIdFromHash(`#source=${sourceUnitId}&start=0&end=5`)).toBe(sourceUnitId);
  expect(sourceUnitIdFromHash('#other')).toBeUndefined();
  expect(screen.getByRole('mark')).toHaveTextContent(/^Claim$/);
  expect(
    screen.getByRole('button', { name: 'Open document 0021, page 7' }).closest('li'),
  ).toHaveAttribute('id', `source-${sourceUnitId}`);
  window.history.replaceState({}, '', '/');
});

test('opens the selected source page in the original PDF viewer', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const sourceUnitId = '00000000-0000-4000-8000-000000000031';
  const reference: SyntheticTextSourceReference = {
    sourceUnitId,
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    recordRevision: 1,
    documentSha256: 'a'.repeat(64),
    extractionVersion: 'synthetic-native-v1',
    pageNumber: 7,
  };
  vi.mocked(listSyntheticTextSources).mockResolvedValueOnce([reference]);
  vi.mocked(getSyntheticTextSource)
    .mockResolvedValueOnce({
      ...reference,
      rawText: 'Source page text.',
    })
    .mockResolvedValueOnce({
      ...reference,
      rawText: 'Source page text.',
    });
  let resolveOriginal!: (value: Blob) => void;
  vi.mocked(getSyntheticOriginal).mockImplementationOnce(
    () =>
      new Promise<Blob>((resolve) => {
        resolveOriginal = resolve;
      }),
  );
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:source-page');
  const user = userEvent.setup();
  render(<SyntheticSourceWorkspace caseId={caseId} />);
  await user.click(await screen.findByRole('button', { name: 'Open document 0021, page 7' }));
  expect(await screen.findByRole('heading', { name: 'Document 0021, page 7' })).toBeVisible();
  const openOriginalButton = screen.getByRole('button', { name: 'Open original page 7' });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await user.click(openOriginalButton);
  expect(screen.getByRole('button', { name: 'Opening original page 7…' })).toBeDisabled();
  resolveOriginal(new Blob(['%PDF-1.7']));
  expect(await screen.findByTitle('Original page 7 preview')).toHaveAttribute(
    'src',
    'blob:source-page#page=7',
  );
  expect(getSyntheticOriginal).toHaveBeenCalledExactlyOnceWith(caseId, reference.documentVersionId);
  await user.click(screen.getByRole('button', { name: 'Open document 0021, page 7' }));
  expect(screen.queryByTitle('Original page 7 preview')).not.toBeInTheDocument();
  createObjectURL.mockRestore();
});

test('releases the source-page object URL when the workspace unmounts', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const sourceUnitId = '00000000-0000-4000-8000-000000000031';
  const reference: SyntheticTextSourceReference = {
    sourceUnitId,
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    recordRevision: 1,
    documentSha256: 'a'.repeat(64),
    extractionVersion: 'synthetic-native-v1',
    pageNumber: 7,
  };
  vi.mocked(listSyntheticTextSources).mockResolvedValueOnce([reference]);
  vi.mocked(getSyntheticTextSource).mockResolvedValueOnce({
    ...reference,
    rawText: 'Source page text.',
  });
  vi.mocked(getSyntheticOriginal).mockResolvedValueOnce(new Blob(['%PDF-1.7']));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:source-page-releasable');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const user = userEvent.setup();
  const view = render(<SyntheticSourceWorkspace caseId={caseId} />);

  await user.click(await screen.findByRole('button', { name: 'Open document 0021, page 7' }));
  await user.click(await screen.findByRole('button', { name: 'Open original page 7' }));
  expect(await screen.findByTitle('Original page 7 preview')).toBeVisible();
  view.unmount();

  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:source-page-releasable');
});

test('does not highlight a cited span outside the persisted source page', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const sourceUnitId = '00000000-0000-4000-8000-000000000031';
  const reference: SyntheticTextSourceReference = {
    sourceUnitId,
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    recordRevision: 1,
    documentSha256: 'a'.repeat(64),
    extractionVersion: 'synthetic-native-v1',
    pageNumber: 7,
  };
  vi.mocked(listSyntheticTextSources).mockResolvedValueOnce([reference]);
  vi.mocked(getSyntheticTextSource).mockResolvedValueOnce({ ...reference, rawText: 'Short text.' });
  window.history.replaceState({}, '', `#source=${sourceUnitId}&start=-1&end=5`);
  render(<SyntheticSourceWorkspace caseId={caseId} />);
  expect(await screen.findByRole('heading', { name: 'Document 0021, page 7' })).toBeVisible();
  expect(screen.queryByRole('mark')).not.toBeInTheDocument();
  cleanup();
  vi.mocked(listSyntheticTextSources).mockResolvedValueOnce([reference]);
  vi.mocked(getSyntheticTextSource).mockResolvedValueOnce({ ...reference, rawText: 'Short text.' });
  window.history.replaceState({}, '', `#source=${sourceUnitId}&start=0&end=999`);
  render(<SyntheticSourceWorkspace caseId={caseId} />);
  expect(await screen.findByRole('heading', { name: 'Document 0021, page 7' })).toBeVisible();
  expect(screen.queryByRole('mark')).not.toBeInTheDocument();
  cleanup();
  vi.mocked(listSyntheticTextSources).mockResolvedValueOnce([reference]);
  vi.mocked(getSyntheticTextSource).mockResolvedValueOnce({ ...reference, rawText: 'Short text.' });
  window.history.replaceState({}, '', `#source=${sourceUnitId}&start=5&end=5`);
  render(<SyntheticSourceWorkspace caseId={caseId} />);
  expect(await screen.findByRole('heading', { name: 'Document 0021, page 7' })).toBeVisible();
  expect(screen.queryByRole('mark')).not.toBeInTheDocument();
  window.history.replaceState({}, '', '/');
});

test('accepts a cited span that ends at the source boundary', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const sourceUnitId = '00000000-0000-4000-8000-000000000031';
  const reference: SyntheticTextSourceReference = {
    sourceUnitId,
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    recordRevision: 1,
    documentSha256: 'a'.repeat(64),
    extractionVersion: 'synthetic-native-v1',
    pageNumber: 7,
  };
  vi.mocked(listSyntheticTextSources).mockResolvedValueOnce([reference]);
  vi.mocked(getSyntheticTextSource).mockResolvedValueOnce({ ...reference, rawText: 'Boundary.' });
  window.history.replaceState({}, '', `#source=${sourceUnitId}&start=0&end=9`);
  render(<SyntheticSourceWorkspace caseId={caseId} />);
  expect(await screen.findByRole('heading', { name: 'Document 0021, page 7' })).toBeVisible();
  expect(screen.getByRole('mark')).toHaveTextContent('Boundary.');
  window.history.replaceState({}, '', '/');
});

test('splits only the verified source range for highlighting', () => {
  expect(splitVerifiedSourceText('before verified after', { start: 7, end: 15 })).toEqual([
    'before ',
    'verified',
    ' after',
  ]);
});

test('clears a prior highlight when reopening the same source', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  const sourceUnitId = '00000000-0000-4000-8000-000000000031';
  const reference: SyntheticTextSourceReference = {
    sourceUnitId,
    caseId,
    documentVersionId: '00000000-0000-4000-8000-000000000021',
    recordRevision: 1,
    documentSha256: 'a'.repeat(64),
    extractionVersion: 'synthetic-native-v1',
    pageNumber: 1,
  };
  const source: SyntheticTextSource = { ...reference, rawText: 'Exact source text.' };
  vi.mocked(listSyntheticTextSources).mockResolvedValue([reference]);
  vi.mocked(getSyntheticTextSource).mockResolvedValue(source);
  const user = userEvent.setup();
  render(<SyntheticSourceWorkspace caseId={caseId} />);
  await user.click(await screen.findByRole('button', { name: 'Open document 0021, page 1' }));
  await user.type(await screen.findByLabelText('Verify a quotation against this page'), 'Exact');
  await user.click(screen.getByRole('button', { name: 'Verify and highlight' }));
  expect(await screen.findByText('Exact', { selector: 'mark' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Open document 0021, page 1' }));
  expect(await screen.findByRole('heading', { name: 'Document 0021, page 1' })).toBeVisible();
  expect(screen.queryByText('Exact', { selector: 'mark' })).not.toBeInTheDocument();
});

test('retries a temporary case-detail failure without inventing case metadata', async () => {
  const caseId = '00000000-0000-4000-8000-000000000002';
  let resolveRetry!: (value: CaseSummary) => void;
  let resolveOriginals!: (value: SyntheticOriginalReceipt[]) => void;
  vi.mocked(getSyntheticCase)
    .mockRejectedValueOnce(new Error('synthetic service outage'))
    .mockImplementationOnce(
      () =>
        new Promise<CaseSummary>((resolve) => {
          resolveRetry = resolve;
        }),
    );
  const user = userEvent.setup();
  vi.mocked(listSyntheticOriginals)
    .mockRejectedValueOnce(new Error('inventory outage'))
    .mockImplementationOnce(
      () =>
        new Promise<SyntheticOriginalReceipt[]>((resolve) => {
          resolveOriginals = resolve;
        }),
    );
  render(
    <MemoryRouter initialEntries={[`/cases/${caseId}`]}>
      <App />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: 'Case service unavailable' })).toBeVisible();
  expect(screen.queryByText('Synthetic saved draft')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry loading case' }));
  expect(screen.getByRole('status')).toHaveTextContent('Loading case');
  resolveRetry({ caseId, label: 'Synthetic saved draft', recordRevision: 1 });
  expect(await screen.findByRole('heading', { name: 'Synthetic saved draft' })).toBeVisible();
  expect(getSyntheticCase).toHaveBeenCalledTimes(2);
  expect(await screen.findByText(/Original inventory unavailable/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Retry loading originals' }));
  expect(screen.getByRole('status')).toHaveTextContent('Loading registered originals');
  resolveOriginals([]);
  expect(await screen.findByText('No registered originals yet.')).toBeVisible();
  expect(listSyntheticOriginals).toHaveBeenCalledTimes(2);
});
