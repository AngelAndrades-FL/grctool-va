/** Collects each family's in-baseline controls and their narratives for the Word SOP export. */
import type { AppSettings, EvidenceMap, SopBullet, SopFamilyInput } from '@shared/types';
import { narrativeToBullets } from '@shared/sop';
import { isNodeInBaseline, type CatalogIndex, type ControlNode } from './catalogIndex';
import { resolveSharedArtifacts } from './sharedArtifacts';

function bulletsFor(node: ControlNode, evidence: EvidenceMap): SopBullet[] {
  const record = evidence[node.id];
  if (!record) return [];
  if (record.implementationStatus === 'not_applicable' && record.naJustification.trim()) {
    return [{ bullet_text: `This control is not applicable. ${record.naJustification.trim()}`, sub_bullets: [] }];
  }
  return narrativeToBullets(record.narrative.implementation);
}

/** File names of the control's own and linked artifacts; artifacts without a stored file are left out. */
function artifactFilesFor(node: ControlNode, evidence: EvidenceMap): string[] {
  const names = (evidence[node.id]?.artifacts ?? []).map((a) => a.fileName?.trim() ?? '').filter(Boolean);
  return [...new Set(names)];
}

export function buildSopFamilies(index: CatalogIndex, stored: EvidenceMap, settings: AppSettings): SopFamilyInput[] {
  const evidence = resolveSharedArtifacts(stored);
  const selected = (node: ControlNode) =>
    node.status === 'active' && isNodeInBaseline(node, settings.baseline, settings.frameworkMode);

  return index.families.flatMap((family) => {
    const nodes = (index.controlsByFamily.get(family.family_id) ?? []).filter(selected);
    const controls = nodes
      .filter((node) => !node.isEnhancement)
      .map((node) => ({
        id: node.id,
        name: node.name,
        narrative: bulletsFor(node, evidence),
        artifacts: artifactFilesFor(node, evidence),
        enhancements: nodes
          .filter((enh) => enh.parentId === node.id)
          .map((enh) => ({
            id: enh.id,
            name: enh.name,
            narrative: bulletsFor(enh, evidence),
            artifacts: artifactFilesFor(enh, evidence),
          })),
      }));
    return controls.length ? [{ familyId: family.family_id, familyName: family.family_name, controls }] : [];
  });
}
