import { locateSourceSpan, type SourceSpanCandidate, type SourceUnit } from './source-span.ts';

export type GeneratedClaimSection = 'summary' | 'medical' | 'procedural' | 'five_step';
export type GeneratedClaimSpeaker = 'alj' | 'plaintiff' | 'commissioner' | 'vocational_expert';
export type GeneratedClaimStep = 1 | 2 | 3 | 4 | 5;
export type GeneratedClaimFlag = 'possible_cherry_pick' | 'possible_specialist_mismatch';
export type GeneratedClaimChronology = Readonly<{
  date: string;
  provider?: string;
  reason?: string;
  prescription?: string;
  name?: string;
  importance?: 'important';
}>;

export type GeneratedClaim = Readonly<{
  claimId: string;
  text: string;
  source: SourceSpanCandidate;
  section?: GeneratedClaimSection;
  speaker?: GeneratedClaimSpeaker;
  step?: GeneratedClaimStep;
  flags?: readonly GeneratedClaimFlag[];
  chronology?: GeneratedClaimChronology;
}>;

export type GeneratedClaimValidation =
  | Readonly<{
      status: 'verified';
      claimId: string;
      text: string;
      source: Extract<ReturnType<typeof locateSourceSpan>, { status: 'located' }>['span'];
      section?: GeneratedClaimSection;
      speaker?: GeneratedClaimSpeaker;
      step?: GeneratedClaimStep;
      flags?: readonly GeneratedClaimFlag[];
      chronology?: GeneratedClaimChronology;
    }>
  | Readonly<{
      status: 'unverified';
      claimId: string;
      text: string;
      message: "The review system couldn't find this evidence in the authorized case record.";
      reason: 'source_unavailable' | 'source_mismatch' | 'invalid_offsets' | 'quote_mismatch';
      section?: GeneratedClaimSection;
      speaker?: GeneratedClaimSpeaker;
      step?: GeneratedClaimStep;
      flags?: readonly GeneratedClaimFlag[];
      chronology?: GeneratedClaimChronology;
    }>;

/**
 * Validate a generated claim against only the source units authorized for the case.
 * An unverified result is deliberately phrased as a search limitation, not as proof
 * that the underlying evidence does not exist.
 */
export function validateGeneratedClaim(
  caseId: string,
  sources: readonly SourceUnit[],
  claim: GeneratedClaim,
): GeneratedClaimValidation {
  const source = sources.find((candidate) => candidate.sourceUnitId === claim.source.sourceUnitId);
  const result = locateSourceSpan(caseId, source, claim.source);
  if (result.status === 'located')
    return {
      status: 'verified',
      claimId: claim.claimId,
      text: claim.text,
      source: result.span,
      ...(claim.section ? { section: claim.section } : {}),
      ...(claim.speaker ? { speaker: claim.speaker } : {}),
      ...(claim.step ? { step: claim.step } : {}),
      ...(claim.flags ? { flags: claim.flags } : {}),
      ...(claim.chronology ? { chronology: claim.chronology } : {}),
    };
  return {
    status: 'unverified',
    claimId: claim.claimId,
    text: claim.text,
    message: "The review system couldn't find this evidence in the authorized case record.",
    reason: result.reason,
    ...(claim.section ? { section: claim.section } : {}),
    ...(claim.speaker ? { speaker: claim.speaker } : {}),
    ...(claim.step ? { step: claim.step } : {}),
    ...(claim.flags ? { flags: claim.flags } : {}),
    ...(claim.chronology ? { chronology: claim.chronology } : {}),
  };
}
