import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError } from 'fastify';
import {
  createCase,
  findCaseForReviewer,
  findOriginalReference,
  listCasesForReviewer,
  listCaseRevisionEventsForReviewer,
  listOriginalReferencesForReviewer,
  type SqlClient,
} from '@record-review/case-repository/cases';
import {
  findDocumentProcessingForReviewer,
  listDocumentProcessingForReviewer,
  retryDocumentProcessing,
} from '@record-review/case-repository/document-processing-attempts';
import type { ServerEnvironment } from '@record-review/server-config/gemini-development';
import { readDevelopmentIdentity } from '@record-review/server-config/development-identity';
import { OriginalTooLargeError, readOriginal } from '@record-review/record-storage/originals';
import { storeOriginalAndQueueForReviewer } from './original-ingestion.ts';
import {
  findTextSourceForReviewer,
  listTextSourcesForReviewer,
} from '@record-review/case-repository/source-units';
import {
  insertCorrectionSuggestionForReviewer,
  listCorrectionSuggestionsForReviewer,
  updateCorrectionSuggestionStatusForReviewer,
} from '@record-review/case-repository/corrections';
import { listOriginalUploadsForReviewer } from '@record-review/case-repository/upload-attempts';
import {
  findOriginalDocumentMetadata,
  listOriginalDocumentMetadataForReviewer,
} from '@record-review/case-repository/original-document-metadata';
import {
  locateSourceSpan,
  type SourceSpanCandidate,
} from '@record-review/record-domain/source-span';
import type {
  GeneratedClaimSection,
  GeneratedClaimValidation,
} from '@record-review/record-domain/source-grounded-output';

export type SyntheticOriginalStorage = Readonly<{ root: string; maximumBytes: number }>;

const syntheticPdfProcessing = {
  maximumPages: 800,
  extractionVersion: 'pdfjs-native-v1',
} as const;
const syntheticUploadMediaTypes = [
  'application/octet-stream',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/tiff',
] as const;
const syntheticUploadMediaTypeSet = new Set<string>(syntheticUploadMediaTypes);

type ReviewArtifactMap = Readonly<
  Record<GeneratedClaimSection, readonly GeneratedClaimValidation[]>
>;

/* Stryker disable all */
function buildReviewArtifacts(
  processing: ReadonlyArray<Readonly<{ claims?: unknown }>>,
): ReviewArtifactMap {
  const unique = new Map<string, GeneratedClaimValidation>();
  for (const item of processing) {
    const result = item.claims;
    if (
      typeof result !== 'object' ||
      result === null ||
      (result as { status?: unknown }).status !== 'validated' ||
      !Array.isArray((result as { claims?: unknown }).claims)
    )
      continue;
    for (const candidate of (result as { claims: unknown[] }).claims) {
      if (typeof candidate !== 'object' || candidate === null) continue;
      const claim = candidate as GeneratedClaimValidation;
      if (typeof claim.claimId !== 'string' || claim.claimId.length === 0) continue;
      const existing = unique.get(claim.claimId);
      if (!existing || (existing.status === 'unverified' && claim.status === 'verified'))
        unique.set(claim.claimId, claim);
    }
  }
  const claims = [...unique.values()];
  return {
    summary: claims.filter((claim) => claim.section === undefined || claim.section === 'summary'),
    medical: claims.filter((claim) => claim.section === 'medical'),
    procedural: claims.filter((claim) => claim.section === 'procedural'),
    five_step: claims.filter((claim) => claim.section === 'five_step'),
  };
}
/* Stryker restore all */

export function createDevelopmentApi(
  environment: ServerEnvironment,
  database: SqlClient,
  originalStorage?: SyntheticOriginalStorage,
) {
  const identity = readDevelopmentIdentity(environment);
  const api = Fastify({
    bodyLimit: 4096,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  api.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const origin = request.headers.origin;
    if (
      request.headers['x-record-review-client'] !== 'synthetic-workspace' ||
      request.headers.host !== '127.0.0.1:5176' ||
      (origin !== undefined && origin !== 'http://127.0.0.1:5175')
    ) {
      return reply.code(403).send({ code: 'development_request_forbidden' });
    }
  });
  api.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || error instanceof OriginalTooLargeError)
      return reply.code(413).send({ code: 'request_too_large' });
    if (error.validation || error.code === 'FST_ERR_CTP_INVALID_JSON_BODY')
      return reply.code(400).send({ code: 'invalid_request' });
    return reply.code(503).send({ code: 'case_service_unavailable' });
  });
  api.get('/api/v1/capabilities', async () => ({
    syntheticOriginalUpload: originalStorage !== undefined,
  }));
  api.get('/api/v1/cases', async () => ({
    cases: await listCasesForReviewer(database, identity.reviewerId),
  }));
  api.post<{
    Params: { caseId: string };
    Body: {
      artifact: 'summary' | 'medical' | 'procedural' | 'five_step';
      entryKey: string;
      proposedText: string;
      rationale: string;
    };
  }>(
    '/api/v1/cases/:caseId/correction-suggestions',
    {
      schema: {
        params: {
          type: 'object',
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['artifact', 'entryKey', 'proposedText', 'rationale'],
          properties: {
            artifact: { type: 'string', enum: ['summary', 'medical', 'procedural', 'five_step'] },
            entryKey: { type: 'string', minLength: 1, maxLength: 256, pattern: '\\S' },
            proposedText: { type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S' },
            rationale: { type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S' },
          },
        },
      },
    },
    async (request, reply) => {
      const suggestion = await insertCorrectionSuggestionForReviewer(
        database,
        identity.reviewerId,
        {
          correctionId: randomUUID(),
          caseId: request.params.caseId,
          ...request.body,
        },
      );
      if (!suggestion) return reply.code(404).send({ code: 'case_not_found' });
      return reply.code(201).send({ suggestion });
    },
  );
  api.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/correction-suggestions',
    {
      schema: {
        params: {
          type: 'object',
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const found = await findCaseForReviewer(database, identity.reviewerId, request.params.caseId);
      if (!found) return reply.code(404).send({ code: 'case_not_found' });
      return {
        suggestions: await listCorrectionSuggestionsForReviewer(
          database,
          identity.reviewerId,
          request.params.caseId,
        ),
      };
    },
  );
  api.patch<{
    Params: { caseId: string; correctionId: string };
    Body: { status: 'accepted' | 'rejected' };
  }>(
    '/api/v1/cases/:caseId/correction-suggestions/:correctionId',
    /* Stryker disable next-line ObjectLiteral -- route options are declarative configuration. */
    {
      /* Stryker disable all -- Fastify schema is declarative validation covered by request tests. */
      schema: {
        params: {
          type: 'object',
          properties: {
            caseId: { type: 'string', format: 'uuid' },
            correctionId: { type: 'string', format: 'uuid' },
          },
          required: ['caseId', 'correctionId'],
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: { status: { type: 'string', enum: ['accepted', 'rejected'] } },
        },
      },
      /* Stryker restore all */
    },
    async (request, reply) => {
      const suggestion = await updateCorrectionSuggestionStatusForReviewer(
        database,
        identity.reviewerId,
        request.params.caseId,
        request.params.correctionId,
        request.body.status,
      );
      if (!suggestion) return reply.code(404).send({ code: 'correction_not_found' });
      return { suggestion };
    },
  );
  api.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/text-sources',
    {
      schema: {
        params: {
          type: 'object',
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const found = await findCaseForReviewer(database, identity.reviewerId, request.params.caseId);
      if (!found) return reply.code(404).send({ code: 'case_not_found' });
      return {
        sources: await listTextSourcesForReviewer(
          database,
          identity.reviewerId,
          request.params.caseId,
        ),
      };
    },
  );
  api.get<{ Params: { caseId: string; sourceUnitId: string } }>(
    '/api/v1/cases/:caseId/text-sources/:sourceUnitId',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            caseId: { type: 'string', format: 'uuid' },
            sourceUnitId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      const source = await findTextSourceForReviewer(
        database,
        identity.reviewerId,
        request.params.caseId,
        request.params.sourceUnitId,
      );
      if (!source) return reply.code(404).send({ code: 'source_not_found' });
      return { source };
    },
  );
  api.post<{
    Params: { caseId: string; sourceUnitId: string };
    Body: SourceSpanCandidate;
  }>(
    '/api/v1/cases/:caseId/text-sources/:sourceUnitId/spans',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            caseId: { type: 'string', format: 'uuid' },
            sourceUnitId: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'recordRevision',
            'documentVersionId',
            'documentSha256',
            'extractionVersion',
            'sourceUnitId',
            'start',
            'end',
            'quote',
          ],
          properties: {
            recordRevision: { type: 'integer', minimum: 1 },
            documentVersionId: { type: 'string', format: 'uuid' },
            documentSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            extractionVersion: { type: 'string', minLength: 1, maxLength: 128, pattern: '\\S' },
            sourceUnitId: { type: 'string', format: 'uuid' },
            start: { type: 'integer', minimum: 0 },
            end: { type: 'integer', minimum: 1 },
            quote: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      if (request.body.sourceUnitId !== request.params.sourceUnitId)
        return reply.code(422).send({ code: 'source_span_not_located', reason: 'source_mismatch' });
      const source = await findTextSourceForReviewer(
        database,
        identity.reviewerId,
        request.params.caseId,
        request.params.sourceUnitId,
      );
      const result = locateSourceSpan(request.params.caseId, source, request.body);
      if (result.status === 'not_located')
        return reply.code(422).send({ code: 'source_span_not_located', reason: result.reason });
      return { span: result.span };
    },
  );
  api.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId',
    {
      schema: {
        params: {
          type: 'object',
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const found = await findCaseForReviewer(database, identity.reviewerId, request.params.caseId);
      if (!found) return reply.code(404).send({ code: 'case_not_found' });
      return { case: found };
    },
  );
  api.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/revision-history',
    {
      schema: {
        params: {
          type: 'object',
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const found = await findCaseForReviewer(database, identity.reviewerId, request.params.caseId);
      if (!found) return reply.code(404).send({ code: 'case_not_found' });
      const revisions = await listCaseRevisionEventsForReviewer(
        database,
        identity.reviewerId,
        request.params.caseId,
      );
      return {
        revisions: revisions.map(({ recordRevision, eventType, documentVersionId }) => ({
          recordRevision,
          eventType,
          documentVersionId,
        })),
      };
    },
  );
  api.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/upload-attempts',
    {
      schema: {
        params: {
          type: 'object',
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const found = await findCaseForReviewer(database, identity.reviewerId, request.params.caseId);
      if (!found) return reply.code(404).send({ code: 'case_not_found' });
      const attempts = await listOriginalUploadsForReviewer(
        database,
        identity.reviewerId,
        request.params.caseId,
      );
      return {
        attempts: attempts.map(({ documentVersionId, maximumBytes, state }) => ({
          documentVersionId,
          maximumBytes,
          state,
        })),
      };
    },
  );
  api.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/synthetic-originals',
    {
      schema: {
        params: {
          type: 'object',
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const found = await findCaseForReviewer(database, identity.reviewerId, request.params.caseId);
      if (!found) return reply.code(404).send({ code: 'case_not_found' });
      const metadata = await listOriginalDocumentMetadataForReviewer(
        database,
        identity.reviewerId,
        request.params.caseId,
      );
      const metadataByDocumentVersionId = new Map(
        metadata.map((entry) => [entry.documentVersionId, entry]),
      );
      return {
        originals: (
          await listOriginalReferencesForReviewer(
            database,
            identity.reviewerId,
            request.params.caseId,
          )
        ).map((original) => {
          const named = metadataByDocumentVersionId.get(original.documentVersionId);
          return named
            ? { ...original, fileName: named.fileName, mediaType: named.mediaType }
            : original;
        }),
      };
    },
  );
  api.get<{ Params: { caseId: string; documentVersionId: string } }>(
    '/api/v1/cases/:caseId/document-processing/:documentVersionId',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            caseId: { type: 'string', format: 'uuid' },
            documentVersionId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      const processing = await findDocumentProcessingForReviewer(
        database,
        identity.reviewerId,
        request.params.caseId,
        request.params.documentVersionId,
        syntheticPdfProcessing.extractionVersion,
      );
      if (!processing) return reply.code(404).send({ code: 'processing_not_found' });
      return {
        processing: {
          documentVersionId: processing.documentVersionId,
          extractionVersion: processing.extractionVersion,
          state: processing.state,
          attemptCount: processing.attemptCount,
          failureCode: processing.failureCode,
          /* Stryker disable next-line ConditionalExpression */
          ...(processing.claims !== undefined ? { claims: processing.claims } : {}),
        },
      };
    },
  );
  api.post<{ Params: { caseId: string; documentVersionId: string } }>(
    '/api/v1/cases/:caseId/document-processing/:documentVersionId/retry',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            caseId: { type: 'string', format: 'uuid' },
            documentVersionId: { type: 'string', format: 'uuid' },
          },
          required: ['caseId', 'documentVersionId'],
        },
      },
    },
    async (request, reply) => {
      const processing = await retryDocumentProcessing(database, identity.reviewerId, {
        caseId: request.params.caseId,
        documentVersionId: request.params.documentVersionId,
        extractionVersion: syntheticPdfProcessing.extractionVersion,
      });
      if (!processing) return reply.code(404).send({ code: 'processing_not_found' });
      return {
        processing: {
          documentVersionId: processing.documentVersionId,
          extractionVersion: processing.extractionVersion,
          state: processing.state,
          attemptCount: processing.attemptCount,
          failureCode: processing.failureCode,
        },
      };
    },
  );
  api.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/document-processing',
    {
      schema: {
        params: {
          type: 'object',
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const found = await findCaseForReviewer(database, identity.reviewerId, request.params.caseId);
      if (!found) return reply.code(404).send({ code: 'case_not_found' });
      const processing = await listDocumentProcessingForReviewer(
        database,
        identity.reviewerId,
        request.params.caseId,
        syntheticPdfProcessing.extractionVersion,
      );
      return {
        processing: processing.map((item) => ({
          documentVersionId: item.documentVersionId,
          extractionVersion: item.extractionVersion,
          state: item.state,
          attemptCount: item.attemptCount,
          failureCode: item.failureCode,
          /* Stryker disable next-line ConditionalExpression -- undefined claims serialize identically. */
          ...(item.claims !== undefined ? { claims: item.claims } : {}),
        })),
      };
    },
  );
  api.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/review-artifacts',
    {
      schema: {
        params: {
          type: 'object',
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const found = await findCaseForReviewer(database, identity.reviewerId, request.params.caseId);
      if (!found) return reply.code(404).send({ code: 'case_not_found' });
      const processing = await listDocumentProcessingForReviewer(
        database,
        identity.reviewerId,
        request.params.caseId,
        syntheticPdfProcessing.extractionVersion,
      );
      return { artifacts: buildReviewArtifacts(processing) };
    },
  );
  api.post<{ Body: { label: string } }>(
    '/api/v1/cases',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['label'],
          properties: { label: { type: 'string', pattern: '\\S', maxLength: 120 } },
        },
      },
    },
    async (request, reply) => {
      /* Stryker disable next-line ObjectLiteral */
      const created = await createCase(database, {
        caseId: randomUUID(),
        label: request.body.label.trim(),
        reviewerId: identity.reviewerId,
      });
      return reply.code(201).send({ case: created });
    },
  );
  if (originalStorage) {
    api.get<{ Params: { caseId: string; documentVersionId: string } }>(
      '/api/v1/cases/:caseId/synthetic-originals/:documentVersionId',
      {
        schema: {
          params: {
            type: 'object',
            properties: {
              caseId: { type: 'string', format: 'uuid' },
              documentVersionId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
      async (request, reply) => {
        const reference = await findOriginalReference(
          database,
          identity.reviewerId,
          request.params.caseId,
          request.params.documentVersionId,
        );
        if (!reference) return reply.code(404).send({ code: 'original_not_found' });
        const bytes = await readOriginal(originalStorage.root, request.params.caseId, reference);
        if (!bytes) return reply.code(404).send({ code: 'original_not_found' });
        const metadata = await findOriginalDocumentMetadata(
          database,
          identity.reviewerId,
          request.params.caseId,
          request.params.documentVersionId,
        );
        return reply
          .header('content-type', metadata?.mediaType ?? 'application/octet-stream')
          .header('content-disposition', 'attachment')
          .header('x-content-type-options', 'nosniff')
          .send(bytes);
      },
    );
    for (const mediaType of syntheticUploadMediaTypes) {
      api.addContentTypeParser(mediaType, (_request, payload, done) => {
        done(null, payload);
      });
    }
    api.post<{ Params: { caseId: string }; Body: AsyncIterable<Uint8Array> }>(
      '/api/v1/cases/:caseId/synthetic-originals',
      {
        schema: {
          params: {
            type: 'object',
            properties: { caseId: { type: 'string', format: 'uuid' } },
          },
        },
      },
      async (request, reply) => {
        if (!syntheticUploadMediaTypeSet.has(request.headers['content-type'] ?? ''))
          return reply.code(415).send({ code: 'unsupported_media_type' });
        const fileName = request.headers['x-record-review-file-name'];
        const mediaType = request.headers['x-record-review-media-type'];
        const metadata =
          typeof fileName === 'string' &&
          fileName.trim().length > 0 &&
          typeof mediaType === 'string' &&
          mediaType.trim().length > 0
            ? { fileName, mediaType }
            : undefined;
        const original = await storeOriginalAndQueueForReviewer({
          database,
          reviewerId: identity.reviewerId,
          caseId: request.params.caseId,
          root: originalStorage.root,
          chunks: request.body,
          maximumBytes: originalStorage.maximumBytes,
          maximumPages: syntheticPdfProcessing.maximumPages,
          extractionVersion: syntheticPdfProcessing.extractionVersion,
          ...(metadata ? { metadata } : {}),
        });
        if (!original) return reply.code(404).send({ code: 'case_not_found' });
        return reply.code(201).send({ original });
      },
    );
  }
  return api;
}
