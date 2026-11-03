import mammoth from 'mammoth';

export type DocxTextPage = Readonly<{
  status: 'extracted';
  pageNumber: number;
  rawText: string;
}>;

type ExtractRawText = (input: { buffer: Buffer }) => Promise<{ value: string }>;

export async function extractDocxBytes(
  bytes: Uint8Array,
  maximumBytes: number,
  maximumPages: number,
  extractRawText: ExtractRawText = mammoth.extractRawText,
): Promise<DocxTextPage[]> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('invalid_docx_byte_budget');
  }
  if (bytes.byteLength > maximumBytes) {
    throw new Error('docx_byte_budget_exceeded');
  }
  if (!Number.isSafeInteger(maximumPages) || maximumPages < 1) {
    throw new Error('invalid_docx_page_budget');
  }

  try {
    const result = await extractRawText({ buffer: Buffer.from(bytes) });
    return [{ status: 'extracted', pageNumber: 1, rawText: result.value }];
  } catch (error) {
    throw new Error('docx_extraction_failed', { cause: error });
  }
}
