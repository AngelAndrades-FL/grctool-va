/** Reconciles a stored evidence record against the catalog so the form always has the right slots. */
import type { EvidenceRecord } from '@shared/types';
import { emptyRecord } from '@shared/oscal';
import type { ControlNode } from './catalogIndex';
import { requiredOdp } from './completeness';

/**
 * Produces the record the form binds to. ODP and objective rows are derived from
 * the catalog rather than stored blindly, so a catalog revision that adds an
 * objective surfaces as a new empty row instead of silently disappearing.
 */
export function seedRecord(node: ControlNode, existing?: EvidenceRecord): EvidenceRecord {
  const base = existing ?? emptyRecord(node.id, node.designation);
  const priorOdp = new Map(base.odpResponses.map((r) => [r.parameterId, r]));
  const priorObjectives = new Map(base.objectiveResponses.map((r) => [r.objectiveIndex, r]));

  return {
    ...base,
    // Records from before the "in scope" toggle was retired: out of scope means not applicable.
    implementationStatus: base.inScope === false ? 'not_applicable' : base.implementationStatus,
    inScope: true,
    familyId: node.familyId,
    isEnhancement: node.isEnhancement,
    parentControlId: node.parentId,
    // Records stored before these fields existed load without them.
    poam: { ...base.poam, artifactIds: base.poam?.artifactIds ?? [] },
    linkedArtifactIds: base.linkedArtifactIds ?? [],
    odpResponses: requiredOdp(node).map((param) => ({
      parameterId: param.parameterId,
      label: param.label,
      source: param.source,
      value: priorOdp.get(param.parameterId)?.value || param.defaultValue || '',
    })),
    objectiveResponses: node.assessmentObjectives.map((_objective, index) => ({
      objectiveIndex: index,
      met: priorObjectives.get(index)?.met ?? null,
      note: priorObjectives.get(index)?.note ?? '',
    })),
  };
}

/** Field-level diff used to append to the per-control audit trail. */
export function diffRecords(before: EvidenceRecord, after: EvidenceRecord, by: string) {
  const at = new Date().toISOString();
  const entries: EvidenceRecord['changeLog'] = [];

  const track = (field: string, from: unknown, to: unknown) => {
    const a = typeof from === 'string' ? from : JSON.stringify(from);
    const b = typeof to === 'string' ? to : JSON.stringify(to);
    if (a !== b) entries.push({ at, field, from: a.slice(0, 400), to: b.slice(0, 400), by });
  };

  track('implementationStatus', before.implementationStatus, after.implementationStatus);
  track('origination', before.origination, after.origination);
  track('inScope', before.inScope, after.inScope);
  track('narrative.implementation', before.narrative.implementation.text, after.narrative.implementation.text);
  track('narrative.whyCompliant', before.narrative.whyCompliant.text, after.narrative.whyCompliant.text);
  track('ownership.responsibleRole', before.ownership.responsibleRole, after.ownership.responsibleRole);
  track('dates.lastReviewedOn', before.dates.lastReviewedOn, after.dates.lastReviewedOn);
  track('artifacts', before.artifacts.length, after.artifacts.length);

  return entries;
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
