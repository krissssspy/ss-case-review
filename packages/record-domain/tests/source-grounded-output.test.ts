import { expect, test } from 'vitest';
import { validateGeneratedClaim, type GeneratedClaim } from '../src/source-grounded-output.ts';

const source = {
  caseId: 'case-a',
  recordRevision: 1,
  documentVersionId: 'document-version-a',
  documentSha256: 'a'.repeat(64),
  extractionVersion: 'extraction-v1',
  sourceUnitId: 'source-unit-a',
  rawText: 'The claimant can sit for six hours in an eight-hour workday.',
};

test('verifies a generated claim only when its quotation matches the authorized source', () => {
  const claim: GeneratedClaim = {
    claimId: 'claim-a',
    text: 'The RFC includes six hours of sitting.',
    source: {
      recordRevision: 1,
      documentVersionId: 'document-version-a',
      documentSha256: 'a'.repeat(64),
      extractionVersion: 'extraction-v1',
      sourceUnitId: 'source-unit-a',
      start: 13,
      end: 60,
      quote: 'can sit for six hours in an eight-hour workday.',
    },
  };

  expect(validateGeneratedClaim('case-a', [source], claim)).toEqual({
    status: 'verified',
    claimId: 'claim-a',
    text: claim.text,
    source: { caseId: 'case-a', ...claim.source },
  });
});

test('flags a claim for investigation when the quotation cannot be matched', () => {
  const claim: GeneratedClaim = {
    claimId: 'claim-unmatched',
    text: 'The record supports a different limitation.',
    source: {
      recordRevision: 1,
      documentVersionId: 'document-version-a',
      documentSha256: 'a'.repeat(64),
      extractionVersion: 'extraction-v1',
      sourceUnitId: 'source-unit-a',
      start: 13,
      end: 60,
      quote: 'The record does not contain this sentence.',
    },
  };

  expect(validateGeneratedClaim('case-a', [source], claim)).toEqual({
    status: 'unverified',
    claimId: 'claim-unmatched',
    text: claim.text,
    message: "The review system couldn't find this evidence in the authorized case record.",
    reason: 'quote_mismatch',
  });
});

test('selects the source unit named by the claim instead of the first available page', () => {
  const claim: GeneratedClaim = {
    claimId: 'claim-specific-source',
    text: 'The RFC includes six hours of sitting.',
    source: {
      recordRevision: 1,
      documentVersionId: 'document-version-a',
      documentSha256: 'a'.repeat(64),
      extractionVersion: 'extraction-v1',
      sourceUnitId: 'source-unit-a',
      start: 13,
      end: 60,
      quote: 'can sit for six hours in an eight-hour workday.',
    },
  };
  const otherSource = { ...source, sourceUnitId: 'source-unit-b', documentSha256: 'b'.repeat(64) };

  expect(validateGeneratedClaim('case-a', [otherSource, source], claim).status).toBe('verified');
});

test('preserves approved artifact context on verified and unverified claims', () => {
  const verified = validateGeneratedClaim('case-a', [source], {
    claimId: 'claim-context',
    text: 'The ALJ assessed sedentary work.',
    section: 'five_step',
    speaker: 'alj',
    flags: ['possible_cherry_pick'],
    source: {
      recordRevision: 1,
      documentVersionId: 'document-version-a',
      documentSha256: 'a'.repeat(64),
      extractionVersion: 'extraction-v1',
      sourceUnitId: 'source-unit-a',
      start: 0,
      end: 20,
      quote: source.rawText.slice(0, 20),
    },
  });
  expect(verified).toMatchObject({
    status: 'verified',
    section: 'five_step',
    speaker: 'alj',
    flags: ['possible_cherry_pick'],
  });

  const unverified = validateGeneratedClaim('case-a', [source], {
    claimId: 'claim-context-unverified',
    text: 'The Commissioner disputes the limitation.',
    section: 'summary',
    speaker: 'commissioner',
    step: 2,
    flags: ['possible_specialist_mismatch'],
    chronology: { date: '2024-03-12', name: 'Appeals Council denial' },
    source: {
      recordRevision: 1,
      documentVersionId: 'document-version-a',
      documentSha256: 'a'.repeat(64),
      extractionVersion: 'extraction-v1',
      sourceUnitId: 'source-unit-a',
      start: 0,
      end: 3,
      quote: 'No such quote.',
    },
  });
  expect(unverified).toMatchObject({
    status: 'unverified',
    section: 'summary',
    speaker: 'commissioner',
    step: 2,
    flags: ['possible_specialist_mismatch'],
    chronology: { date: '2024-03-12', name: 'Appeals Council denial' },
  });
});

test('preserves an explicit five-step evaluation number on grounded claims', () => {
  const result = validateGeneratedClaim('case-a', [source], {
    claimId: 'step-three-claim',
    text: 'The impairment does not meet a listed impairment.',
    section: 'five_step',
    speaker: 'alj',
    step: 3,
    source: {
      recordRevision: 1,
      documentVersionId: 'document-version-a',
      documentSha256: 'a'.repeat(64),
      extractionVersion: 'extraction-v1',
      sourceUnitId: 'source-unit-a',
      start: 0,
      end: 20,
      quote: source.rawText.slice(0, 20),
    },
  });

  expect(result).toMatchObject({ status: 'verified', section: 'five_step', step: 3 });
});

test('preserves validated chronology metadata on a grounded claim', () => {
  const result = validateGeneratedClaim('case-a', [source], {
    claimId: 'medical-chronology-1',
    text: 'The claimant attended a follow-up visit.',
    section: 'medical',
    chronology: {
      date: '2024-03-12',
      provider: 'Dr. Rivera',
      reason: 'Follow-up evaluation',
      prescription: 'Continue physical therapy',
      importance: 'important',
    },
    source: {
      recordRevision: 1,
      documentVersionId: 'document-version-a',
      documentSha256: 'a'.repeat(64),
      extractionVersion: 'extraction-v1',
      sourceUnitId: 'source-unit-a',
      start: 0,
      end: 10,
      quote: source.rawText.slice(0, 10),
    },
  });

  expect(result).toMatchObject({
    status: 'verified',
    chronology: {
      date: '2024-03-12',
      provider: 'Dr. Rivera',
      reason: 'Follow-up evaluation',
      prescription: 'Continue physical therapy',
      importance: 'important',
    },
  });
});
