import type { SqlClient } from './cases.ts';

export type TextSourceGeometry = Readonly<{
  view: readonly number[];
  rotation: number;
  items: readonly Readonly<{
    start: number;
    end: number;
    transform: readonly number[];
    width: number;
    height: number;
  }>[];
}>;

export type TextSourceUnit = Readonly<{
  sourceUnitId: string;
  caseId: string;
  documentVersionId: string;
  recordRevision: number;
  documentSha256: string;
  extractionVersion: string;
  pageNumber: number;
  rawText: string;
  geometry: TextSourceGeometry;
}>;

export type TextSourceReference = Omit<TextSourceUnit, 'rawText'>;

export async function listTextSourceUnitsForReviewer(
  client: SqlClient,
  reviewerId: string,
  caseId: string,
): Promise<TextSourceUnit[]> {
  const result = await client.query<TextSourceUnit>(
    `SELECT sources.source_unit_id AS "sourceUnitId", sources.case_id AS "caseId",
      sources.document_version_id AS "documentVersionId", sources.record_revision AS "recordRevision",
      sources.document_sha256 AS "documentSha256", sources.extraction_version AS "extractionVersion",
      sources.page_number AS "pageNumber", sources.raw_text AS "rawText", sources.geometry AS "geometry"
    FROM text_source_units sources
    JOIN case_memberships members ON members.case_id = sources.case_id
    JOIN original_references originals ON originals.case_id = sources.case_id
      AND originals.document_version_id = sources.document_version_id
    JOIN cases ON cases.case_id = sources.case_id
    WHERE sources.case_id = $1 AND members.reviewer_id = $2
      AND originals.sha256 = sources.document_sha256
      AND cases.record_revision = sources.record_revision
    ORDER BY sources.document_version_id, sources.page_number,
      sources.extraction_version, sources.source_unit_id`,
    [caseId, reviewerId],
  );
  return result.rows;
}

export async function listTextSourcesForReviewer(
  client: SqlClient,
  reviewerId: string,
  caseId: string,
): Promise<TextSourceReference[]> {
  const result = await client.query<TextSourceReference>(
    `SELECT sources.source_unit_id AS "sourceUnitId", sources.case_id AS "caseId",
      sources.document_version_id AS "documentVersionId", sources.record_revision AS "recordRevision",
      sources.document_sha256 AS "documentSha256", sources.extraction_version AS "extractionVersion",
      sources.page_number AS "pageNumber", sources.geometry AS "geometry"
    FROM text_source_units sources
    JOIN case_memberships members ON members.case_id = sources.case_id
    JOIN original_references originals ON originals.case_id = sources.case_id
      AND originals.document_version_id = sources.document_version_id
    JOIN cases ON cases.case_id = sources.case_id
    WHERE sources.case_id = $1 AND members.reviewer_id = $2
      AND originals.sha256 = sources.document_sha256
      AND cases.record_revision = sources.record_revision
    ORDER BY sources.document_version_id, sources.page_number,
      sources.extraction_version, sources.source_unit_id`,
    [caseId, reviewerId],
  );
  return result.rows;
}

export async function findTextSourceForReviewer(
  client: SqlClient,
  reviewerId: string,
  caseId: string,
  sourceUnitId: string,
): Promise<TextSourceUnit | undefined> {
  const result = await client.query<TextSourceUnit>(
    `SELECT sources.source_unit_id AS "sourceUnitId", sources.case_id AS "caseId",
      sources.document_version_id AS "documentVersionId", sources.record_revision AS "recordRevision",
      sources.document_sha256 AS "documentSha256", sources.extraction_version AS "extractionVersion",
      sources.page_number AS "pageNumber", sources.raw_text AS "rawText",
      sources.geometry AS "geometry"
    FROM text_source_units sources
    JOIN case_memberships members ON members.case_id = sources.case_id
    JOIN original_references originals ON originals.case_id = sources.case_id
      AND originals.document_version_id = sources.document_version_id
    WHERE sources.case_id = $1 AND sources.source_unit_id = $2 AND members.reviewer_id = $3
      AND originals.sha256 = sources.document_sha256`,
    [caseId, sourceUnitId, reviewerId],
  );
  return result.rows[0];
}

export async function insertTextSourceForReviewer(
  client: SqlClient,
  reviewerId: string,
  source: TextSourceUnit,
): Promise<TextSourceUnit | undefined> {
  const result = await client.query<TextSourceUnit>(
    `INSERT INTO text_source_units (
      source_unit_id, case_id, document_version_id, record_revision,
      document_sha256, extraction_version, page_number, raw_text, geometry
    )
    SELECT $1, case_id, $3, $4, $5, $6, $7, $8, $9::jsonb
    FROM case_memberships JOIN original_references USING (case_id)
      JOIN cases USING (case_id)
    WHERE case_id = $2 AND reviewer_id = $10 AND document_version_id = $3
      AND sha256 = $5 AND cases.record_revision = $4
    RETURNING source_unit_id AS "sourceUnitId", case_id AS "caseId",
      document_version_id AS "documentVersionId", record_revision AS "recordRevision",
      document_sha256 AS "documentSha256", extraction_version AS "extractionVersion",
      page_number AS "pageNumber", raw_text AS "rawText", geometry AS "geometry"`,
    [
      source.sourceUnitId,
      source.caseId,
      source.documentVersionId,
      source.recordRevision,
      source.documentSha256,
      source.extractionVersion,
      source.pageNumber,
      source.rawText,
      JSON.stringify(source.geometry),
      reviewerId,
    ],
  );
  return result.rows[0];
}

export async function insertTextSourcesForReviewer(
  client: SqlClient,
  reviewerId: string,
  sources: readonly TextSourceUnit[],
): Promise<TextSourceUnit[]> {
  const result = await client.query<TextSourceUnit>(
    `WITH candidates AS (
      SELECT
        (entry.value->>'sourceUnitId')::uuid AS source_unit_id,
        (entry.value->>'caseId')::uuid AS case_id,
        (entry.value->>'documentVersionId')::uuid AS document_version_id,
        (entry.value->>'recordRevision')::integer AS record_revision,
        entry.value->>'documentSha256' AS document_sha256,
        entry.value->>'extractionVersion' AS extraction_version,
        (entry.value->>'pageNumber')::integer AS page_number,
        entry.value->>'rawText' AS raw_text,
        entry.value->'geometry' AS geometry,
        entry.ordinality
      FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS entry(value, ordinality)
    ), authorized AS (
      SELECT candidates.*
      FROM candidates
      JOIN case_memberships members ON members.case_id = candidates.case_id
      JOIN original_references originals ON originals.case_id = candidates.case_id
        AND originals.document_version_id = candidates.document_version_id
      JOIN cases ON cases.case_id = candidates.case_id
      WHERE members.reviewer_id = $2 AND originals.sha256 = candidates.document_sha256
        AND cases.record_revision = candidates.record_revision
    ), inserted AS (
      INSERT INTO text_source_units (
        source_unit_id, case_id, document_version_id, record_revision,
        document_sha256, extraction_version, page_number, raw_text, geometry
      )
      SELECT source_unit_id, case_id, document_version_id, record_revision,
        document_sha256, extraction_version, page_number, raw_text, geometry
      FROM authorized
      WHERE (SELECT count(*) FROM authorized) = (SELECT count(*) FROM candidates)
      RETURNING source_unit_id, case_id, document_version_id, record_revision,
        document_sha256, extraction_version, page_number, raw_text, geometry
    )
    SELECT inserted.source_unit_id AS "sourceUnitId", inserted.case_id AS "caseId",
      inserted.document_version_id AS "documentVersionId",
      inserted.record_revision AS "recordRevision", inserted.document_sha256 AS "documentSha256",
      inserted.extraction_version AS "extractionVersion", inserted.page_number AS "pageNumber",
      inserted.raw_text AS "rawText", inserted.geometry AS "geometry"
    FROM inserted JOIN candidates USING (source_unit_id)
    ORDER BY candidates.ordinality`,
    [JSON.stringify(sources), reviewerId],
  );
  return result.rows;
}
