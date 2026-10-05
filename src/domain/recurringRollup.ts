/** Rolls recurring artifacts up into per-control and catalog-wide views. */
import type { AppSettings, Artifact, EvidenceMap, RecurringFrequency, RecurringStatus } from '@shared/types';
import { activeCycleLabels, artifactCycleLabel, nextDueDate, recurringStatus, type CycleSettings } from '@shared/recurring';

export interface RecurringRollup {
  count: number;
  /** Worst status across the control's recurring artifacts, or null when none are tracked. */
  status: RecurringStatus | null;
  /** Earliest upcoming due date across the control's recurring artifacts. */
  nextDue: string | null;
}

const SEVERITY_ORDER: RecurringStatus[] = ['current', 'due_soon', 'overdue', 'no_evidence_on_file'];

export function cycleSettingsOf(settings: AppSettings | undefined): CycleSettings {
  return { cycleBasis: settings?.cycleBasis ?? 'fiscal', fiscalYearStartMonth: settings?.fiscalYearStartMonth ?? 10 };
}

export function rollupRecurring(artifacts: Artifact[], dueSoonDays: number): RecurringRollup {
  const recurring = artifacts.filter((a) => a.recurrence);
  if (recurring.length === 0) return { count: 0, status: null, nextDue: null };

  let worst: RecurringStatus = 'current';
  let nextDue: string | null = null;

  for (const artifact of recurring) {
    const status = recurringStatus(artifact, dueSoonDays);
    if (SEVERITY_ORDER.indexOf(status) > SEVERITY_ORDER.indexOf(worst)) worst = status;
    const due = nextDueDate(artifact);
    if (due && (nextDue === null || due < nextDue)) nextDue = due;
  }

  return { count: recurring.length, status: worst, nextDue };
}

export interface RecurringRow {
  id: string;
  controlId: string;
  familyId: string;
  title: string;
  frequency: RecurringFrequency;
  evidenceType: string;
  lastCollected: string | null;
  nextDue: string | null;
  status: RecurringStatus;
  cycles: string;
  /** "FY2026: file.pdf; FY2025: older.pdf" — non-archived cycles, newest first. */
  references: string;
}

/** Every recurring artifact across the workspace, flattened for grids and exports. */
export function allRecurringRows(evidence: EvidenceMap, settings: AppSettings | undefined): RecurringRow[] {
  const dueSoonDays = settings?.recurringDueSoonDays ?? 30;
  const cycleSettings = cycleSettingsOf(settings);
  const rows: RecurringRow[] = [];

  for (const record of Object.values(evidence)) {
    for (const artifact of record.artifacts) {
      if (!artifact.recurrence) continue;
      const currentLabel = artifactCycleLabel(artifact, cycleSettings);
      const reference = (c: { fileName?: string; url?: string }) => c.fileName ?? c.url ?? artifact.title;
      const references = [
        ...(currentLabel ? [`${currentLabel}: ${reference(artifact)}`] : []),
        ...artifact.recurrence.history.filter((c) => !c.archived).map((c) => `${c.cycleLabel}: ${reference(c)}`),
      ];
      rows.push({
        id: artifact.id,
        controlId: record.controlId,
        familyId: record.familyId,
        title: artifact.title,
        frequency: artifact.recurrence.frequencyType,
        evidenceType: artifact.evidenceType,
        lastCollected: currentLabel && artifact.collectedAt ? artifact.collectedAt.slice(0, 10) : null,
        nextDue: nextDueDate(artifact),
        status: recurringStatus(artifact, dueSoonDays),
        cycles: activeCycleLabels(artifact, cycleSettings).join(', '),
        references: references.join('; '),
      });
    }
  }

  return rows.sort((a, b) => (a.nextDue ?? '9999').localeCompare(b.nextDue ?? '9999'));
}
