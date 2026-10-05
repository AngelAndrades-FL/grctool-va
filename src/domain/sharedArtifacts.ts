import type { Artifact, EvidenceMap } from '@shared/types';

/** Every artifact keyed by id, with the control that owns it. */
export function artifactOwners(evidence: EvidenceMap): Map<string, { owner: string; artifact: Artifact }> {
  const owners = new Map<string, { owner: string; artifact: Artifact }>();
  for (const record of Object.values(evidence)) {
    for (const artifact of record.artifacts) owners.set(artifact.id, { owner: record.controlId, artifact });
  }
  return owners;
}

/** Read-only view in which each record also lists artifacts linked from other controls. Never save this. */
export function resolveSharedArtifacts(evidence: EvidenceMap): EvidenceMap {
  const owners = artifactOwners(evidence);
  const resolved: EvidenceMap = {};
  for (const [id, record] of Object.entries(evidence)) {
    const linked = (record.linkedArtifactIds ?? []).flatMap((artifactId) => {
      const entry = owners.get(artifactId);
      return entry && entry.owner !== record.controlId ? [{ ...entry.artifact, sharedFrom: entry.owner }] : [];
    });
    resolved[id] = linked.length ? { ...record, artifacts: [...record.artifacts, ...linked] } : record;
  }
  return resolved;
}
