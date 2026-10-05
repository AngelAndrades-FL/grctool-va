/** Merges controls read from an external OSCAL SSP into the workspace's evidence records. */
import type { Artifact, EvidenceMap, EvidenceRecord, OscalImportControl, OscalImportResult } from '@shared/types';
import { normalizeParamId } from '@shared/oscalImport';
import type { CatalogIndex } from './catalogIndex';
import { diffRecords, seedRecord } from './records';

export interface OscalImportPlan {
  records: EvidenceRecord[];
  /** Control ids in the file that are not in the catalog. */
  unknownControls: string[];
  /** Parameter values that matched no ODP slot of their control. */
  unmatchedParameters: number;
  overwrittenNarratives: number;
  addedLinks: number;
}

export function planOscalImport(
  result: OscalImportResult,
  index: CatalogIndex,
  evidence: EvidenceMap,
  by: string,
): OscalImportPlan {
  const plan: OscalImportPlan = { records: [], unknownControls: [], unmatchedParameters: 0, overwrittenNarratives: 0, addedLinks: 0 };
  const now = new Date().toISOString();
  const source = `ServiceNow OSCAL ${result.sourceVersion ?? '?'} (${result.fileName ?? 'file'})`;

  for (const imp of result.controls ?? []) {
    const node = index.nodeById.get(imp.controlId);
    if (!node) {
      plan.unknownControls.push(imp.controlId);
      continue;
    }
    const existing = evidence[imp.controlId];
    const before = seedRecord(node, existing);
    const after = applyImport(before, imp, now, plan);
    if (imp.narrative && before.narrative.implementation.text.trim() && before.narrative.implementation.text !== imp.narrative) {
      plan.overwrittenNarratives++;
    }
    after.changeLog = [
      ...before.changeLog,
      ...diffRecords(before, after, by),
      { at: now, field: 'import', from: '', to: source, by },
    ];
    plan.records.push(after);
  }
  return plan;
}

function applyImport(base: EvidenceRecord, imp: OscalImportControl, now: string, plan: OscalImportPlan): EvidenceRecord {
  const rec: EvidenceRecord = structuredClone(base);
  if (imp.narrative) rec.narrative.implementation = { json: null, text: imp.narrative };
  if (imp.remarks) rec.narrative.whyCompliant = { json: null, text: imp.remarks };
  if (imp.implementationStatus) rec.implementationStatus = imp.implementationStatus;
  if (imp.origination) rec.origination = imp.origination;
  if (imp.naJustification) rec.naJustification = imp.naJustification;
  if (imp.responsibleRole) rec.ownership.responsibleRole = imp.responsibleRole;
  if (imp.owner) rec.ownership.owner = imp.owner;

  const slots = new Map(rec.odpResponses.map((o, i) => [normalizeParamId(o.parameterId), i]));
  for (const sp of imp.setParameters) {
    const slot = slots.get(normalizeParamId(sp.paramId));
    if (slot === undefined) plan.unmatchedParameters++;
    else rec.odpResponses[slot].value = sp.value;
  }

  const knownUrls = new Set(rec.artifacts.map((a) => a.url).filter(Boolean));
  for (const link of imp.links) {
    if (knownUrls.has(link.url)) continue;
    const artifact: Artifact = {
      id: crypto.randomUUID(),
      evidenceType: 'ServiceNow reference',
      title: link.title,
      description: 'Imported from a ServiceNow OSCAL SSP.',
      kind: 'url',
      url: link.url,
      collectedAt: now,
    };
    rec.artifacts.push(artifact);
    plan.addedLinks++;
  }

  rec.updatedAt = now;
  return rec;
}
