/** Renderer-side builders for the export formats offered on the Export page. */
import type { AppSettings, EvidenceMap } from '@shared/types';
import { FREQUENCY_LABEL, STATUS_LABEL } from '@shared/recurring';
import type { CatalogIndex } from './catalogIndex';
import { computeCompleteness, isNotApplicable } from './completeness';
import { allRecurringRows } from './recurringRollup';

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildJsonBackup(evidence: EvidenceMap): string {
  return JSON.stringify(
    { schema: 'grctool/backup', version: 1, exportedAt: new Date().toISOString(), records: evidence },
    null,
    2,
  );
}

export function buildCsv(index: CatalogIndex, evidence: EvidenceMap): string {
  const header = [
    'Control ID',
    'Family',
    'Name',
    'Status',
    'Completeness %',
    'Artifacts',
    'Last reviewed',
    'Next review due',
    'Evidence as of',
    'Not-applicable rationale',
  ];
  const rows = index.nodes.map((node) => {
    const record = evidence[node.id];
    const na = isNotApplicable(record);
    return [
      node.id,
      node.familyId,
      node.name,
      record?.implementationStatus ?? 'not_started',
      na ? '' : String(computeCompleteness(node, record)),
      String(record?.artifacts.length ?? 0),
      record?.dates.lastReviewedOn ?? '',
      record?.dates.nextReviewDue ?? '',
      record?.dates.evidenceAsOf ?? '',
      na ? record!.naJustification : '',
    ]
      .map(csvCell)
      .join(',');
  });
  return [header.join(','), ...rows].join('\n');
}

/**
 * Recurring-evidence status across every control, laid out the way an assessor
 * verifying "current and prior year" evidence expects to read it.
 */
export function buildRecurringCsv(evidence: EvidenceMap, settings: AppSettings | undefined): string {
  const header = [
    'Control ID',
    'Family',
    'Artifact',
    'Frequency',
    'Evidence type',
    'Last collected',
    'Next due',
    'Status',
    'Cycles on file',
    'Evidence files',
  ];
  const rows = allRecurringRows(evidence, settings).map((row) =>
    [
      row.controlId,
      row.familyId,
      row.title,
      FREQUENCY_LABEL[row.frequency],
      row.evidenceType,
      row.lastCollected ?? '',
      row.nextDue ?? '',
      STATUS_LABEL[row.status],
      row.cycles,
      row.references,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

/** Narratives and artifact manifest only — not a substitute for the OSCAL SSP. */export function buildSspLiteMarkdown(index: CatalogIndex, evidence: EvidenceMap, settings: AppSettings): string {
  const lines: string[] = [
    `# ${settings.systemName || 'System'} \u2014 SSP-lite`,
    '',
    `Generated ${new Date().toISOString()}${settings.lastAtoDate ? ` \u00b7 Last ATO ${settings.lastAtoDate}` : ''}`,
  ];

  for (const family of index.families) {
    const nodes = (index.controlsByFamily.get(family.family_id) ?? []).filter((node) => evidence[node.id]);
    if (nodes.length === 0) continue;

    lines.push('', `## ${family.family_id} \u2014 ${family.family_name}`);
    for (const node of nodes) {
      const record = evidence[node.id]!;
      if (isNotApplicable(record)) {
        lines.push('', `### ${node.id} \u2014 ${node.name}`, 'Status: **not applicable**');
        lines.push('', record.naJustification.trim() || '_Rationale not yet documented._');
        continue;
      }
      lines.push(
        '',
        `### ${node.id} \u2014 ${node.name}`,
        `Status: **${record.implementationStatus.replace(/_/g, ' ')}** \u00b7 Completeness: ${computeCompleteness(node, record)}%`,
      );
      if (record.narrative.implementation.text.trim()) {
        lines.push('', record.narrative.implementation.text.trim());
      }
      if (record.artifacts.length > 0) {
        lines.push('', 'Artifacts:');
        for (const artifact of record.artifacts) {
          lines.push(`- ${artifact.title || artifact.fileName || artifact.evidenceType} (${artifact.evidenceType})`);
        }
      }
    }
  }

  return lines.join('\n');
}
