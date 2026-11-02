import { expect, test } from 'vitest';
import { generateValidatedClaims } from '../src/source-grounded-generation.ts';

const source = {
  caseId: 'case-a',
  recordRevision: 1,
  documentVersionId: 'document-version-a',
  documentSha256: 'a'.repeat(64),
  extractionVersion: 'extraction-v1',
  sourceUnitId: 'source-unit-a',
  rawText: 'The claimant can sit for six hours in an eight-hour workday.',
};

test('parses Gemini claims and validates every citation against authorized source text', async () => {
  const generate = async ({
    prompt,
    maxOutputTokens,
  }: {
    prompt: string;
    maxOutputTokens: number;
  }) => {
    expect(prompt).toContain('Return only a JSON array of claims');
    expect(prompt).toContain('chronology');
    expect(prompt).toContain('importance');
    expect(prompt).toContain('source-unit-a');
    expect(prompt).toContain(source.rawText);
    expect(maxOutputTokens).toBe(2_048);
    return {
      status: 'generated' as const,
      text: JSON.stringify([
        {
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
        },
      ]),
    };
  };

  await expect(
    generateValidatedClaims(generate, 'Summarize the RFC.', 'case-a', [source]),
  ).resolves.toEqual({
    status: 'validated',
    claims: [
      {
        status: 'verified',
        claimId: 'claim-a',
        text: 'The RFC includes six hours of sitting.',
        source: {
          caseId: 'case-a',
          recordRevision: 1,
          documentVersionId: 'document-version-a',
          documentSha256: 'a'.repeat(64),
          extractionVersion: 'extraction-v1',
          sourceUnitId: 'source-unit-a',
          start: 13,
          end: 60,
          quote: source.rawText.slice(13),
        },
      },
    ],
  });
});

test('preserves an approved artifact section and speaker on a verified claim', async () => {
  const generate = async () => ({
    status: 'generated' as const,
    text: JSON.stringify([
      {
        claimId: 'claim-rfc',
        text: 'The ALJ assessed sedentary work.',
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
      },
    ]),
  });

  await expect(
    generateValidatedClaims(generate, 'Compare the RFC.', 'case-a', [source]),
  ).resolves.toMatchObject({
    status: 'validated',
    claims: [{ section: 'five_step', speaker: 'alj', step: 3 }],
  });
});

test('preserves investigation flags on a verified claim without treating them as findings', async () => {
  const generate = async () => ({
    status: 'generated' as const,
    text: JSON.stringify([
      {
        claimId: 'claim-flagged',
        text: 'The record includes a sitting limitation.',
        flags: ['possible_cherry_pick', 'possible_specialist_mismatch'],
        source: {
          recordRevision: 1,
          documentVersionId: 'document-version-a',
          documentSha256: 'a'.repeat(64),
          extractionVersion: 'extraction-v1',
          sourceUnitId: 'source-unit-a',
          start: 13,
          end: 60,
          quote: source.rawText.slice(13),
        },
      },
    ]),
  });

  await expect(
    generateValidatedClaims(generate, 'Review the record context.', 'case-a', [source]),
  ).resolves.toMatchObject({
    status: 'validated',
    claims: [
      {
        status: 'verified',
        flags: ['possible_cherry_pick', 'possible_specialist_mismatch'],
      },
    ],
  });
});

test('preserves a bounded Gemini refusal without parsing model text', async () => {
  const generate = async () => ({ status: 'refused' as const, code: 'safety_refusal' as const });

  await expect(
    generateValidatedClaims(generate, 'Summarize the RFC.', 'case-a', [source]),
  ).resolves.toEqual({ status: 'refused', code: 'safety_refusal' });
});

test('returns invalid_output when Gemini does not return JSON', async () => {
  const generate = async () => ({ status: 'generated' as const, text: 'not-json' });

  await expect(
    generateValidatedClaims(generate, 'Summarize the RFC.', 'case-a', [source]),
  ).resolves.toEqual({ status: 'invalid_output' });
});

test('rejects each malformed claim field before source validation', async () => {
  const valid = {
    claimId: 'claim-a',
    text: 'A grounded claim.',
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
  const malformed = [
    null,
    'claim',
    { ...valid, source: null },
    { ...valid, source: 'source' },
    { ...valid, claimId: 1 },
    { ...valid, claimId: { length: 1 } },
    { ...valid, claimId: '' },
    { ...valid, text: 1 },
    { ...valid, text: { length: 1 } },
    { ...valid, text: '' },
    { ...valid, section: 'unknown' },
    { ...valid, section: 1 },
    { ...valid, section: {} },
    { ...valid, speaker: 'unknown' },
    { ...valid, speaker: 1 },
    { ...valid, speaker: {} },
    { ...valid, step: 0 },
    { ...valid, step: 6 },
    { ...valid, step: 1.5 },
    { ...valid, step: '3' },
    { ...valid, flags: [] },
    { ...valid, flags: 'possible_cherry_pick' },
    { ...valid, flags: [1] },
    { ...valid, flags: ['unknown'] },
    { ...valid, flags: ['possible_cherry_pick', 'unknown'] },
    { ...valid, chronology: null },
    { ...valid, chronology: { date: '' } },
    { ...valid, chronology: { date: '2024-03-12', provider: 1 } },
    { ...valid, source: { ...valid.source, recordRevision: 1.5 } },
    { ...valid, source: { ...valid.source, documentVersionId: 1 } },
    { ...valid, source: { ...valid.source, documentSha256: 1 } },
    { ...valid, source: { ...valid.source, extractionVersion: 1 } },
    { ...valid, source: { ...valid.source, sourceUnitId: 1 } },
    { ...valid, source: { ...valid.source, start: 1.5 } },
    { ...valid, source: { ...valid.source, end: 1.5 } },
    { ...valid, source: { ...valid.source, quote: 1 } },
  ];
  for (const claim of malformed) {
    const generate = async () => ({ status: 'generated' as const, text: JSON.stringify([claim]) });
    await expect(
      generateValidatedClaims(generate, 'Summarize the RFC.', 'case-a', [source]),
    ).resolves.toEqual({ status: 'invalid_output' });
  }
});

test('rejects an array containing both a valid and malformed claim', async () => {
  const generate = async () =>
    ({
      status: 'generated' as const,
      text: JSON.stringify([
        {
          claimId: 'claim-a',
          text: 'A grounded claim.',
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
        },
        null,
      ]),
    }) as const;

  await expect(
    generateValidatedClaims(generate, 'Summarize the RFC.', 'case-a', [source]),
  ).resolves.toEqual({ status: 'invalid_output' });
});

test('rejects generated claims with duplicate identifiers', async () => {
  const claim = {
    claimId: 'duplicate-claim',
    text: 'A grounded claim.',
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
  const generate = async () => ({
    status: 'generated' as const,
    text: JSON.stringify([claim, { ...claim, text: 'A second grounded claim.' }]),
  });

  await expect(
    generateValidatedClaims(generate, 'Summarize the RFC.', 'case-a', [source]),
  ).resolves.toEqual({ status: 'invalid_output' });
});

test('retains multiple generated claims when identifiers are distinct', async () => {
  const claim = {
    claimId: 'first-claim',
    text: 'A grounded claim.',
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
  const generate = async () => ({
    status: 'generated' as const,
    text: JSON.stringify([claim, { ...claim, claimId: 'second-claim' }]),
  });

  await expect(
    generateValidatedClaims(generate, 'Summarize the RFC.', 'case-a', [source]),
  ).resolves.toMatchObject({
    status: 'validated',
    claims: [{ claimId: 'first-claim' }, { claimId: 'second-claim' }],
  });
});

test('validates every chronology field before accepting a generated claim', async () => {
  const valid = {
    claimId: 'chronology-claim',
    text: 'A grounded chronology claim.',
    chronology: {
      date: '2024-03-12',
      provider: 'Dr. Rivera',
      reason: 'Follow-up evaluation',
      prescription: 'Continue physical therapy',
      name: 'ALJ hearing',
      importance: 'important',
    },
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
  const invalidChronologies: unknown[] = [
    null,
    'chronology',
    1,
    {},
    { date: 1 },
    { date: ' ' },
    { date: '2024-03-12', provider: 1 },
    { date: '2024-03-12', importance: 'urgent' },
    { date: '2024-03-12', reason: 1 },
    { date: '2024-03-12', prescription: 1 },
    { date: '2024-03-12', name: 1 },
  ];
  for (const chronology of invalidChronologies) {
    const generate = async () => ({
      status: 'generated' as const,
      text: JSON.stringify([{ ...valid, chronology }]),
    });
    await expect(
      generateValidatedClaims(generate, 'Summarize the record.', 'case-a', [source]),
    ).resolves.toEqual({ status: 'invalid_output' });
  }

  const generate = async () => ({
    status: 'generated' as const,
    text: JSON.stringify([valid]),
  });
  await expect(
    generateValidatedClaims(generate, 'Summarize the record.', 'case-a', [source]),
  ).resolves.toMatchObject({ status: 'validated' });

  const minimal = async () => ({
    status: 'generated' as const,
    text: JSON.stringify([{ ...valid, chronology: { date: '2024-03-12' } }]),
  });
  await expect(
    generateValidatedClaims(minimal, 'Summarize the record.', 'case-a', [source]),
  ).resolves.toMatchObject({ status: 'validated' });
});
