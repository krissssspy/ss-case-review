import { expect, test, vi } from 'vitest';
import { extractDocxBytes } from '../src/docx.ts';

test('extracts bounded DOCX text as a source page', async () => {
  const extractRawText = vi.fn(async () => ({ value: 'ALJ decision text', messages: [] }));
  await expect(
    extractDocxBytes(new Uint8Array([80, 75, 3, 4]), 16, 1, extractRawText),
  ).resolves.toEqual([
    {
      status: 'extracted',
      pageNumber: 1,
      rawText: 'ALJ decision text',
    },
  ]);
  expect(extractRawText).toHaveBeenCalledExactlyOnceWith({
    buffer: Buffer.from([80, 75, 3, 4]),
  });
});

test('rejects DOCX input beyond the byte budget before extraction', async () => {
  const extractRawText = vi.fn();
  await expect(extractDocxBytes(new Uint8Array([1, 2, 3]), 2, 1, extractRawText)).rejects.toThrow(
    'docx_byte_budget_exceeded',
  );
  expect(extractRawText).not.toHaveBeenCalled();
});

test('rejects invalid DOCX extraction budgets', async () => {
  await expect(extractDocxBytes(new Uint8Array([1]), 0, 1)).rejects.toThrow(
    'invalid_docx_byte_budget',
  );
  await expect(extractDocxBytes(new Uint8Array([1]), 1, 0)).rejects.toThrow(
    'invalid_docx_page_budget',
  );
});

test('maps DOCX extraction failures to a safe error', async () => {
  const extractRawText = vi.fn(async () => {
    throw new Error('private parser details');
  });
  const result = extractDocxBytes(new Uint8Array([80, 75, 3, 4]), 16, 1, extractRawText);
  await expect(result).rejects.toThrow('docx_extraction_failed');
  await expect(result).rejects.toMatchObject({
    cause: expect.objectContaining({ message: 'private parser details' }),
  });
});
