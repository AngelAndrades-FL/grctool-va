/** Derived scoring: how complete a control's evidence is, what's missing, and what's stale. */
import { DateTime } from 'luxon';
import type { EvidenceRecord } from '@shared/types';
import type { ControlNode } from './catalogIndex';

export interface GapReport {
  controlId: string;
  familyId: string;
  name: string;
  completeness: number;
  missingNarrative: boolean;
  unmappedEvidenceTypes: string[];
  unansweredObjectives: number;
  unansweredOdp: string[];
  noArtifacts: boolean;
  stale: boolean;
  staleByDays: number | null;
  reasons: string[];
}

const WEIGHTS = {
  status: 15,
  narrative: 30,
  evidenceTypes: 25,
  objectives: 15,
  odp: 10,
  ownership: 5,
} as const;

function pct(part: number, total: number): number {
  return total === 0 ? 1 : part / total;
}

export function evidenceTypeCoverage(node: ControlNode, record?: EvidenceRecord): {
  satisfied: string[];
  missing: string[];
} {
  const required = node.evidenceRequired.map((e) => e.evidence_type);
  if (!record) return { satisfied: [], missing: required };

  const satisfiedIndexes = new Set<number>();
  for (const artifact of record.artifacts) {
    node.evidenceRequired.forEach((req, index) => {
      if (req.evidence_type.toLowerCase() === artifact.evidenceType.toLowerCase()) {
        satisfiedIndexes.add(index);
      }
    });
  }

  return {
    satisfied: required.filter((_, i) => satisfiedIndexes.has(i)),
    missing: required.filter((_, i) => !satisfiedIndexes.has(i)),
  };
}

export function requiredOdp(
  node: ControlNode,
): Array<{ parameterId: string; label: string; source: 'nist' | 'va'; defaultValue?: string }> {
  const nist = node.parameters.map((p) => ({
    parameterId: p.parameterId,
    label: p.description,
    source: 'nist' as const,
  }));
  const va = (node.vaOverlay?.va_odp_values ?? []).map((v, i) => ({
    parameterId: `${node.id}_va_${i}`,
    label: v.parameter,
    source: 'va' as const,
    defaultValue: v.value,
  }));
  return [...nist, ...va];
}

export function computeCompleteness(node: ControlNode, record?: EvidenceRecord): number {
  if (!record) return 0;
  if (record.implementationStatus === 'not_applicable') {
    return record.naJustification.trim().length > 0 ? 100 : 40;
  }

  const coverage = evidenceTypeCoverage(node, record);
  const odp = requiredOdp(node);
  const answeredOdp = record.odpResponses.filter((r) => r.value.trim().length > 0).length;
  const answeredObjectives = record.objectiveResponses.filter((r) => r.met !== null).length;

  const score =
    (record.implementationStatus !== 'not_started' ? WEIGHTS.status : 0) +
    Math.min(1, record.narrative.implementation.text.trim().split(/\s+/).filter(Boolean).length / 60) *
      WEIGHTS.narrative +
    pct(coverage.satisfied.length, node.evidenceRequired.length) * WEIGHTS.evidenceTypes +
    pct(answeredObjectives, node.assessmentObjectives.length) * WEIGHTS.objectives +
    pct(answeredOdp, odp.length) * WEIGHTS.odp +
    (record.ownership.responsibleRole.trim() ? WEIGHTS.ownership : 0);

  return Math.round(Math.max(0, Math.min(100, score)));
}

/** Marked not applicable, with or without a rationale. */
export function isNotApplicable(record?: EvidenceRecord): boolean {
  return record?.implementationStatus === 'not_applicable';
}

/** Not applicable with a rationale on file: documented, so it drops out of coverage, gap and staleness metrics. */
export function isDocumentedNa(record?: EvidenceRecord): boolean {
  return isNotApplicable(record) && record!.naJustification.trim().length > 0;
}

/** Evidence is stale once it predates the last ATO or exceeds the configured age. */
export function stalenessDays(record: EvidenceRecord | undefined, staleAfterDays: number): number | null {
  if (isNotApplicable(record)) return null;
  const stamp = record?.dates.evidenceAsOf ?? record?.dates.lastReviewedOn;
  if (!stamp) return null;
  const age = Math.floor(-DateTime.fromISO(stamp).diffNow('days').days);
  return age > staleAfterDays ? age : null;
}

export function predatesAto(record: EvidenceRecord | undefined, lastAtoDate: string | null): boolean {
  if (!record || !lastAtoDate || isNotApplicable(record)) return false;
  const stamp = record.dates.evidenceAsOf ?? record.dates.lastReviewedOn;
  if (!stamp) return false;
  return DateTime.fromISO(stamp) < DateTime.fromISO(lastAtoDate);
}

/** The last ATO date, as a Luxon value, used as the earliest selectable date across the app's date pickers. */
export function atoMinDate(lastAtoDate: string | null | undefined): DateTime | undefined {
  return lastAtoDate ? DateTime.fromISO(lastAtoDate) : undefined;
}

export function buildGapReport(
  node: ControlNode,
  record: EvidenceRecord | undefined,
  options: { staleAfterDays: number; lastAtoDate: string | null },
): GapReport {
  if (isNotApplicable(record)) {
    // Nothing else is expected of a not-applicable control except the rationale.
    return {
      controlId: node.id,
      familyId: node.familyId,
      name: node.name,
      completeness: computeCompleteness(node, record),
      missingNarrative: false,
      unmappedEvidenceTypes: [],
      unansweredObjectives: 0,
      unansweredOdp: [],
      noArtifacts: false,
      stale: false,
      staleByDays: null,
      reasons: isDocumentedNa(record) ? [] : ['Rationale for not applicable is missing.'],
    };
  }
  const coverage = evidenceTypeCoverage(node, record);
  const odp = requiredOdp(node);
  const answeredOdpIds = new Set(
    (record?.odpResponses ?? []).filter((r) => r.value.trim()).map((r) => r.parameterId),
  );
  const unansweredOdp = odp.filter((p) => !answeredOdpIds.has(p.parameterId)).map((p) => p.label);
  const answeredObjectives = (record?.objectiveResponses ?? []).filter((r) => r.met !== null).length;
  const unansweredObjectives = Math.max(0, node.assessmentObjectives.length - answeredObjectives);
  const missingNarrative = !record || record.narrative.implementation.text.trim().length < 40;
  const staleByDays = stalenessDays(record, options.staleAfterDays);
  const stale = staleByDays !== null || predatesAto(record, options.lastAtoDate);

  const reasons: string[] = [];
  if (!record) reasons.push('No evidence record started.');
  if (missingNarrative && record) reasons.push('Implementation narrative is missing or too thin.');
  if (coverage.missing.length) reasons.push(`Unmapped evidence types: ${coverage.missing.join(', ')}.`);
  if (unansweredObjectives) reasons.push(`${unansweredObjectives} assessment objective(s) unanswered.`);
  if (unansweredOdp.length) reasons.push(`Unanswered ODP values: ${unansweredOdp.join('; ')}.`);
  if (record && record.artifacts.length === 0) reasons.push('No artifacts attached.');
  if (staleByDays !== null) reasons.push(`Evidence is ${staleByDays} days old.`);
  if (predatesAto(record, options.lastAtoDate)) reasons.push('Evidence predates the last ATO date.');

  return {
    controlId: node.id,
    familyId: node.familyId,
    name: node.name,
    completeness: computeCompleteness(node, record),
    missingNarrative,
    unmappedEvidenceTypes: coverage.missing,
    unansweredObjectives,
    unansweredOdp,
    noArtifacts: !record || record.artifacts.length === 0,
    stale,
    staleByDays,
    reasons,
  };
}
