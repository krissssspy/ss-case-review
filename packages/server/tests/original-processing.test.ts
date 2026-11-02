import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createCase, registerOriginalReference } from '@record-review/case-repository/cases';
import {
  findTextSourceForReviewer,
  listTextSourcesForReviewer,
  insertTextSourceForReviewer,
} from '@record-review/case-repository/source-units';
import { writeOriginal } from '@record-review/record-storage/originals';
import { expect, test, vi } from 'vitest';
import {
  processPdfOriginalForReviewer,
  processStoredPdfOriginalForReviewer,
} from '../src/original-processing.ts';

function syntheticPdf(contents: readonly string[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: string[] = ['%PDF-1.4\n'];
  const offsets = [0];
  const addObject = (body: string) => {
    offsets.push(encoder.encode(chunks.join('')).byteLength);
    chunks.push(`${offsets.length - 1} 0 obj\n${body}\nendobj\n`);
  };
  addObject('<< /Type /Catalog /Pages 2 0 R >>');
  const pageReferences = contents.map((_, index) => `${3 + index * 2} 0 R`).join(' ');
  addObject(`<< /Type /Pages /Kids [${pageReferences}] /Count ${contents.length} >>`);
  const fontId = 3 + contents.length * 2;
  for (const [index, content] of contents.entries()) {
    addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4 + index * 2} 0 R >>`,
    );
    addObject(`<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}\nendstream`);
  }
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const xref = encoder.encode(chunks.join('')).byteLength;
  chunks.push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1))
    chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return encoder.encode(chunks.join(''));
}

test('publishes extracted PDF pages from verified original bytes and reports page gaps', async () => {
  const database = await PGlite.create();
  const root = await mkdtemp(join(tmpdir(), 'record-review-processing-test-'));
  const caseId = '00000000-0000-4000-8000-000000000001';
  const reviewerId = '00000000-0000-4000-8000-000000000011';
  const documentVersionId = '00000000-0000-4000-8000-000000000021';
  const sourceIds = [
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000032',
  ];
  const bytes = new TextEncoder().encode('%PDF-synthetic processing fixture');
  const unavailableInput = {
    database,
    reviewerId,
    caseId,
    documentVersionId,
    root,
    maximumBytes: bytes.byteLength,
    maximumPages: 3,
    extractionVersion: 'synthetic-native-v1',
    extractPages: vi.fn(),
    createSourceUnitId: vi.fn(),
  };
  try {
    for (const migration of [
      '202609230001_initial_case_metadata.sql',
      '202609280001_text_source_units.sql',
      '202610190001_text_source_geometry.sql',
    ]) {
      const sql = await readFile(
        new URL(`../../case-repository/migrations/${migration}`, import.meta.url),
        'utf8',
      );
      await database.exec(sql.replace(/-- Down Migration[\s\S]*$/, ''));
    }
    const unavailableQueries = vi.spyOn(database, 'query');
    await expect(processPdfOriginalForReviewer(unavailableInput)).resolves.toEqual({
      status: 'original_unavailable',
    });
    expect(unavailableQueries).toHaveBeenCalledOnce();
    expect(unavailableQueries.mock.calls[0]?.[0]).toContain('FROM cases');
    unavailableQueries.mockRestore();
    await createCase(database, { caseId, reviewerId, label: 'Synthetic processing case' });
    await expect(processPdfOriginalForReviewer(unavailableInput)).resolves.toEqual({
      status: 'original_unavailable',
    });
    const reference = await writeOriginal(root, { caseId, documentVersionId }, bytes);
    await registerOriginalReference(database, reviewerId, reference);
    const extractPages = vi.fn(async (received: Uint8Array, maximumPages: number) => {
      expect([...received]).toEqual([...bytes]);
      expect(maximumPages).toBe(3);
      return [
        {
          status: 'extracted' as const,
          pageNumber: 1,
          rawText: 'First exact page',
          geometry: {
            view: [0, 0, 612, 792],
            rotation: 0,
            items: [{ start: 0, end: 16, transform: [1, 0, 0, 1, 72, 720], width: 96, height: 12 }],
          },
        },
        {
          status: 'unavailable' as const,
          pageNumber: 2,
          reason: 'page_extraction_failed' as const,
        },
        { status: 'extracted' as const, pageNumber: 3, rawText: 'Third exact page' },
      ];
    });
    const createSourceUnitId = vi
      .fn<() => string>()
      .mockReturnValueOnce(sourceIds[0] as string)
      .mockReturnValueOnce(sourceIds[1] as string);
    const generatedClaims = { status: 'validated' as const, claims: [] };
    const generateClaims = vi.fn().mockResolvedValue(generatedClaims);

    await expect(
      processPdfOriginalForReviewer({
        ...unavailableInput,
        maximumBytes: bytes.byteLength - 1,
      }),
    ).rejects.toThrow('original_byte_budget_exceeded');

    const unsupportedVersionId = '00000000-0000-4000-8000-000000000022';
    const unsupported = await writeOriginal(
      root,
      { caseId, documentVersionId: unsupportedVersionId },
      new TextEncoder().encode('synthetic unsupported original'),
    );
    await registerOriginalReference(database, reviewerId, unsupported);
    await expect(
      processPdfOriginalForReviewer({
        ...unavailableInput,
        documentVersionId: unsupportedVersionId,
        maximumBytes: unsupported.byteLength,
      }),
    ).rejects.toThrow('unsupported_document_format');

    const rejectedExtraction = vi.fn(async () => {
      await database.query('DELETE FROM case_memberships WHERE case_id = $1 AND reviewer_id = $2', [
        caseId,
        reviewerId,
      ]);
      return [{ status: 'extracted' as const, pageNumber: 1, rawText: 'Revoked page' }];
    });
    await expect(
      processPdfOriginalForReviewer({
        ...unavailableInput,
        extractPages: rejectedExtraction,
        createSourceUnitId: () => '00000000-0000-4000-8000-000000000039',
      }),
    ).resolves.toEqual({ status: 'publication_rejected' });
    await database.query('INSERT INTO case_memberships (case_id, reviewer_id) VALUES ($1, $2)', [
      caseId,
      reviewerId,
    ]);
    const priorSource = {
      sourceUnitId: '00000000-0000-4000-8000-000000000039',
      caseId,
      documentVersionId,
      recordRevision: 1,
      documentSha256: reference.sha256,
      extractionVersion: 'synthetic-native-v1',
      pageNumber: 4,
      rawText: 'Previously published case-record page',
      geometry: { view: [], rotation: 0, items: [] },
    };
    expect(await insertTextSourceForReviewer(database, reviewerId, priorSource)).toEqual(
      priorSource,
    );

    await expect(
      processPdfOriginalForReviewer({
        ...unavailableInput,
        extractPages,
        createSourceUnitId,
        generateClaims,
      }),
    ).resolves.toEqual({
      status: 'published',
      sourceUnitIds: sourceIds,
      gaps: [{ pageNumber: 2, reason: 'page_extraction_failed' }],
      claims: generatedClaims,
    });
    expect(extractPages).toHaveBeenCalledOnce();
    expect(unavailableInput.extractPages).not.toHaveBeenCalled();
    expect(rejectedExtraction).toHaveBeenCalledOnce();
    expect(createSourceUnitId).toHaveBeenCalledTimes(2);
    expect(generateClaims).toHaveBeenCalledExactlyOnceWith(caseId, [
      priorSource,
      expect.objectContaining({ sourceUnitId: sourceIds[0], rawText: 'First exact page' }),
      expect.objectContaining({ sourceUnitId: sourceIds[1], rawText: 'Third exact page' }),
    ]);
    expect(await listTextSourcesForReviewer(database, reviewerId, caseId)).toEqual([
      {
        sourceUnitId: sourceIds[0],
        caseId,
        documentVersionId,
        recordRevision: 1,
        documentSha256: reference.sha256,
        extractionVersion: 'synthetic-native-v1',
        pageNumber: 1,
        geometry: {
          view: [0, 0, 612, 792],
          rotation: 0,
          items: [{ start: 0, end: 16, transform: [1, 0, 0, 1, 72, 720], width: 96, height: 12 }],
        },
      },
      {
        sourceUnitId: sourceIds[1],
        caseId,
        documentVersionId,
        recordRevision: 1,
        documentSha256: reference.sha256,
        extractionVersion: 'synthetic-native-v1',
        pageNumber: 3,
        geometry: { view: [], rotation: 0, items: [] },
      },
      {
        sourceUnitId: priorSource.sourceUnitId,
        caseId,
        documentVersionId,
        recordRevision: 1,
        documentSha256: reference.sha256,
        extractionVersion: 'synthetic-native-v1',
        pageNumber: 4,
        geometry: { view: [], rotation: 0, items: [] },
      },
    ]);
  } finally {
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

test('processes a verified stored PDF through the bounded concrete adapter', async () => {
  const database = await PGlite.create();
  const root = await mkdtemp(join(tmpdir(), 'record-review-concrete-processing-test-'));
  const caseId = '00000000-0000-4000-8000-000000000101';
  const reviewerId = '00000000-0000-4000-8000-000000000111';
  const documentVersionId = '00000000-0000-4000-8000-000000000121';
  const sourceIds = [
    '00000000-0000-4000-8000-000000000131',
    '00000000-0000-4000-8000-000000000132',
  ];
  const bytes = syntheticPdf([
    'BT /F1 12 Tf 72 720 Td (First stored source) Tj ET',
    'BT /F1 12 Tf 72 720 Td (Second stored source) Tj ET',
  ]);
  try {
    for (const migration of [
      '202609230001_initial_case_metadata.sql',
      '202609280001_text_source_units.sql',
      '202610190001_text_source_geometry.sql',
    ]) {
      const sql = await readFile(
        new URL(`../../case-repository/migrations/${migration}`, import.meta.url),
        'utf8',
      );
      await database.exec(sql.replace(/-- Down Migration[\s\S]*$/, ''));
    }
    await createCase(database, { caseId, reviewerId, label: 'Concrete processing case' });
    const reference = await writeOriginal(root, { caseId, documentVersionId }, bytes);
    await registerOriginalReference(database, reviewerId, reference);
    const createSourceUnitId = vi
      .fn<() => string>()
      .mockReturnValueOnce(sourceIds[0] as string)
      .mockReturnValueOnce(sourceIds[1] as string);

    await expect(
      processStoredPdfOriginalForReviewer({
        database,
        reviewerId,
        caseId,
        documentVersionId,
        root,
        maximumBytes: bytes.byteLength,
        maximumPages: 2,
        extractionVersion: 'pdfjs-native-v1',
        createSourceUnitId,
      }),
    ).resolves.toEqual({ status: 'published', sourceUnitIds: sourceIds, gaps: [] });
    expect(createSourceUnitId).toHaveBeenCalledTimes(2);
    const sources = await listTextSourcesForReviewer(database, reviewerId, caseId);
    expect(sources).toEqual([
      {
        sourceUnitId: sourceIds[0],
        caseId,
        documentVersionId,
        recordRevision: 1,
        documentSha256: reference.sha256,
        extractionVersion: 'pdfjs-native-v1',
        pageNumber: 1,
        geometry: { view: [], rotation: 0, items: expect.any(Array) },
      },
      {
        sourceUnitId: sourceIds[1],
        caseId,
        documentVersionId,
        recordRevision: 1,
        documentSha256: reference.sha256,
        extractionVersion: 'pdfjs-native-v1',
        pageNumber: 2,
        geometry: { view: [], rotation: 0, items: expect.any(Array) },
      },
    ]);
    await expect(
      Promise.all(
        sourceIds.map((sourceUnitId) =>
          findTextSourceForReviewer(database, reviewerId, caseId, sourceUnitId),
        ),
      ),
    ).resolves.toMatchObject([
      {
        rawText: 'First stored source',
        geometry: { view: [], rotation: 0, items: expect.any(Array) },
      },
      {
        rawText: 'Second stored source',
        geometry: { view: [], rotation: 0, items: expect.any(Array) },
      },
    ]);
  } finally {
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
