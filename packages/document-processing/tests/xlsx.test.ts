import { expect, test, vi } from 'vitest';
import JSZip from 'jszip';
import { extractXlsxBytes } from '../src/xlsx.ts';

test('extracts bounded XLSX sheets as source pages', async () => {
  const readWorkbook = vi.fn(() => ({
    SheetNames: ['Earnings'],
    Sheets: { Earnings: { rows: [['2024 wages']] } },
  }));
  await expect(
    extractXlsxBytes(new Uint8Array([80, 75, 3, 4]), 16, 2, readWorkbook),
  ).resolves.toEqual([
    {
      status: 'extracted',
      pageNumber: 1,
      rawText: '2024 wages',
    },
  ]);
  expect(readWorkbook).toHaveBeenCalledExactlyOnceWith({
    buffer: Buffer.from([80, 75, 3, 4]),
    type: 'buffer',
    cellDates: true,
    dense: true,
  });
});

test('rejects XLSX input beyond the byte budget before reading', async () => {
  const readWorkbook = vi.fn();
  await expect(extractXlsxBytes(new Uint8Array([1, 2, 3]), 2, 1, readWorkbook)).rejects.toThrow(
    'xlsx_byte_budget_exceeded',
  );
  expect(readWorkbook).not.toHaveBeenCalled();
});

test('rejects invalid XLSX budgets', async () => {
  await expect(extractXlsxBytes(new Uint8Array([1]), 0, 1)).rejects.toThrow(
    'invalid_xlsx_byte_budget',
  );
  await expect(extractXlsxBytes(new Uint8Array([1]), 1, 0)).rejects.toThrow(
    'invalid_xlsx_page_budget',
  );
});

test('rejects an XLSX workbook with more sheets than the page budget', async () => {
  const readWorkbook = vi.fn(() => ({
    SheetNames: ['Earnings', 'Benefits'],
    Sheets: { Earnings: { rows: [] }, Benefits: { rows: [] } },
  }));
  await expect(extractXlsxBytes(new Uint8Array([1]), 1, 1, readWorkbook)).rejects.toThrow(
    'xlsx_page_budget_exceeded',
  );
});

test('maps XLSX parser failures to a safe error', async () => {
  const readWorkbook = vi.fn(() => {
    throw new Error('private parser details');
  });
  await expect(extractXlsxBytes(new Uint8Array([1]), 1, 1, readWorkbook)).rejects.toMatchObject({
    message: 'xlsx_extraction_failed',
    cause: { message: 'private parser details' },
  });
});

test('preserves the safe page-budget failure from the XLSX parser', async () => {
  const readWorkbook = vi.fn(() => ({
    SheetNames: ['One', 'Two'],
    Sheets: { One: { rows: [] }, Two: { rows: [] } },
  }));
  await expect(extractXlsxBytes(new Uint8Array([1]), 1, 1, readWorkbook)).rejects.toThrow(
    'xlsx_page_budget_exceeded',
  );
});

test('renders an empty or missing worksheet as an empty source page', async () => {
  const readWorkbook = vi.fn(() => ({ SheetNames: ['Missing'], Sheets: {} }));
  await expect(extractXlsxBytes(new Uint8Array([1]), 1, 1, readWorkbook)).resolves.toEqual([
    { status: 'extracted', pageNumber: 1, rawText: '' },
  ]);
});

test('reports malformed XLSX archive entries without exposing parser details', async () => {
  const archive = new JSZip();
  archive.file(
    'xl/workbook.xml',
    '<workbook><sheets><sheet name="Bad" r:id="rId1"/></sheets></workbook>',
  );
  archive.file('xl/_rels/workbook.xml.rels', '<Relationships/>');
  const bytes = await archive.generateAsync({ type: 'uint8array' });
  await expect(extractXlsxBytes(bytes, bytes.byteLength, 1)).rejects.toMatchObject({
    message: 'xlsx_extraction_failed',
    cause: { message: 'xlsx_missing_sheet_relationship' },
  });
});

test('reports an XLSX archive without workbook metadata safely', async () => {
  const archive = new JSZip();
  const bytes = await archive.generateAsync({ type: 'uint8array' });
  await expect(extractXlsxBytes(bytes, bytes.byteLength, 1)).rejects.toMatchObject({
    message: 'xlsx_extraction_failed',
    cause: { message: 'xlsx_missing_entry:xl/workbook.xml' },
  });
});

test('rejects an XLSX sheet without a usable name or relationship', async () => {
  const archive = new JSZip();
  archive.file('xl/workbook.xml', '<workbook><sheets><sheet r:id="rId1"/></sheets></workbook>');
  archive.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  const bytes = await archive.generateAsync({ type: 'uint8array' });
  await expect(extractXlsxBytes(bytes, bytes.byteLength, 1)).rejects.toMatchObject({
    message: 'xlsx_extraction_failed',
    cause: { message: 'xlsx_invalid_sheet' },
  });
});

test('reads an XLSX archive without shared strings or inline values', async () => {
  const archive = new JSZip();
  archive.file(
    'xl/workbook.xml',
    '<workbook><sheets><sheet name="Numbers" r:id="rId1"/></sheets></workbook>',
  );
  archive.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="rId1" Target="/worksheets/sheet1.xml"/></Relationships>',
  );
  archive.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>9</v></c><c><v>42</v></c><c><foo/><v>99</v></c><c t="ss"><v>0</v></c><c><v> 4 2 </v></c></row></sheetData></worksheet>',
  );
  const bytes = await archive.generateAsync({ type: 'uint8array' });
  await expect(extractXlsxBytes(bytes, bytes.byteLength, 1)).resolves.toEqual([
    { status: 'extracted', pageNumber: 1, rawText: '\t\t42\t\t0\t 4 2 ' },
  ]);
});

test('reads a minimal XLSX archive with shared and inline values', async () => {
  const archive = new JSZip();
  archive.file(
    'xl/workbook.xml',
    '<workbook><sheets><sheet name="Earnings" r:id="rId1"/></sheets></workbook>',
  );
  archive.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  archive.file('xl/sharedStrings.xml', '<sst><si><t>Shared &amp; wage</t></si></sst>');
  archive.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet><sheetData><row r="1"><c t="s"><v>0</v></c><c><is><t>Inline &lt;note&gt; &quot;ok&quot; &apos;y&apos;</t></is></c></row><row r="2"><c><v foo="x">42</v></c><c><foo/></c><c t="str"><v>7</v></c></row></sheetData></worksheet>',
  );
  const bytes = await archive.generateAsync({ type: 'uint8array' });
  await expect(extractXlsxBytes(bytes, bytes.byteLength, 1)).resolves.toEqual([
    {
      status: 'extracted',
      pageNumber: 1,
      rawText: 'Shared & wage\tInline <note> "ok" \'y\'\n42\t\t7',
    },
  ]);
});

test('distinguishes a missing worksheet relationship identifier', async () => {
  const archive = new JSZip();
  archive.file('xl/workbook.xml', '<workbook><sheets><sheet name="NoId"/></sheets></workbook>');
  archive.file('xl/_rels/workbook.xml.rels', '<Relationships/>');
  const bytes = await archive.generateAsync({ type: 'uint8array' });
  await expect(extractXlsxBytes(bytes, bytes.byteLength, 1)).rejects.toMatchObject({
    message: 'xlsx_extraction_failed',
    cause: { message: 'xlsx_invalid_sheet' },
  });
});
