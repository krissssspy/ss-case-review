import JSZip from 'jszip';

export type XlsxTextPage = Readonly<{
  status: 'extracted';
  pageNumber: number;
  rawText: string;
}>;

type XlsxSheet = Readonly<{
  rows: readonly (readonly string[])[];
}>;

type XlsxWorkbook = Readonly<{
  SheetNames: readonly string[];
  Sheets: Readonly<Record<string, XlsxSheet>>;
}>;

type ReadWorkbookInput = Readonly<{
  buffer: Buffer;
  type: 'buffer';
  cellDates: true;
  dense: true;
}>;

type ReadWorkbook = (input: ReadWorkbookInput) => Promise<XlsxWorkbook> | XlsxWorkbook;

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function textFromXml(value: string) {
  return decodeXml(value.replace(/<[^>]+>/g, ''));
}

function relationshipTarget(xml: string, relationshipId: string) {
  const relationship = xml.match(
    new RegExp(`<Relationship[^>]+Id="${relationshipId}"[^>]+Target="([^"]+)"`),
  );
  return relationship?.[1];
}

function sharedStringsFromXml(xml: string) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textFromXml(match[1] as string));
}

function sheetFromXml(xml: string, sharedStrings: readonly string[]): XlsxSheet {
  const rows = [...xml.matchAll(/<row(?: [^>]*)?>([\s\S]*?)<\/row>/g)].map((row) =>
    [...(row[1] as string).matchAll(/<c(?: [^>]*)?>([\s\S]*?)<\/c>/g)].map((cell) => {
      const body = cell[1] as string;
      const type = body.match(/^\s*<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '';
      const value = decodeXml(type);
      const attributes = (cell[0] as string).match(/^<c([^>]*)>/)?.[1] as string;
      const cellType = attributes.split(' ').includes('t="s"') ? 's' : undefined;
      if (cellType === 's') return sharedStrings[Number(value)] ?? '';
      const inline = body.match(/<is>([\s\S]*?)<\/is>/)?.[1];
      return inline ? textFromXml(inline) : value;
    }),
  );
  return { rows };
}

async function readXlsxWorkbook(input: ReadWorkbookInput): Promise<XlsxWorkbook> {
  const archive = await JSZip.loadAsync(input.buffer);
  const readText = async (path: string) => {
    const file = archive.file(path);
    if (!file) throw new Error(`xlsx_missing_entry:${path}`);
    return file.async('string');
  };
  const workbookXml = await readText('xl/workbook.xml');
  const relationshipsXml = await readText('xl/_rels/workbook.xml.rels');
  const sharedStrings = archive.file('xl/sharedStrings.xml')
    ? sharedStringsFromXml(await readText('xl/sharedStrings.xml'))
    : [];
  const sheets = [...workbookXml.matchAll(/<sheet([^>]*)\/>/g)].map((match) => {
    const attributes = match[1] as string;
    const name = attributes.match(/\bname="([^"]+)"/)?.[1];
    const relationshipId = attributes.match(/\br:id="([^"]+)"/)?.[1];
    if (!name || !relationshipId) throw new Error('xlsx_invalid_sheet');
    const target = relationshipTarget(relationshipsXml, relationshipId);
    if (!target) throw new Error('xlsx_missing_sheet_relationship');
    return { name: decodeXml(name), path: `xl/${target.replace(/^\//, '')}` };
  });
  const entries = await Promise.all(
    sheets.map(
      async (sheet) =>
        [sheet.name, sheetFromXml(await readText(sheet.path), sharedStrings)] as const,
    ),
  );
  return { SheetNames: entries.map(([name]) => name), Sheets: Object.fromEntries(entries) };
}

function sheetToText(sheet: XlsxSheet) {
  return sheet.rows.map((row) => row.join('\t')).join('\n');
}

export async function extractXlsxBytes(
  bytes: Uint8Array,
  maximumBytes: number,
  maximumPages: number,
  readWorkbook: ReadWorkbook = readXlsxWorkbook,
): Promise<XlsxTextPage[]> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
    throw new Error('invalid_xlsx_byte_budget');
  if (bytes.byteLength > maximumBytes) throw new Error('xlsx_byte_budget_exceeded');
  if (!Number.isSafeInteger(maximumPages) || maximumPages < 1)
    throw new Error('invalid_xlsx_page_budget');
  try {
    const workbook = await readWorkbook({
      buffer: Buffer.from(bytes),
      type: 'buffer',
      cellDates: true,
      dense: true,
    });
    if (workbook.SheetNames.length > maximumPages) throw new Error('xlsx_page_budget_exceeded');
    return workbook.SheetNames.map((name, index) => ({
      status: 'extracted' as const,
      pageNumber: index + 1,
      rawText: sheetToText(workbook.Sheets[name] ?? { rows: [] }),
    }));
  } catch (error) {
    if (error instanceof Error && error.message === 'xlsx_page_budget_exceeded') throw error;
    throw new Error('xlsx_extraction_failed', { cause: error });
  }
}
