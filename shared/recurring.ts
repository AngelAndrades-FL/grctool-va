/**
 * Recurring-evidence cadence maths, cycle labelling, and the seed table of
 * controls whose 800-53 text carries an organization-defined frequency.
 *
 * Recurrence is an optional facet of an artifact: the artifact holds the current
 * cycle's evidence and `recurrence.history` keeps every earlier cycle.
 *
 * Everything here is advisory: frequencies in the seed table are starting
 * points, not policy. The real cadence comes from the org's tailored baseline
 * and approved SSP, so every value stays editable in the UI.
 */
import { DateTime } from 'luxon';
import type {
  AppSettings,
  Artifact,
  ArtifactCycle,
  ArtifactRecurrence,
  RecurringFrequency,
  RecurringStatus,
} from './types.js';

export type CycleSettings = Pick<AppSettings, 'cycleBasis' | 'fiscalYearStartMonth'>;

export const FREQUENCY_LABEL: Record<RecurringFrequency, string> = {
  annual: 'Annual',
  semiannual: 'Semiannual',
  quarterly: 'Quarterly',
  monthly: 'Monthly',
  continuous: 'Continuous',
  org_defined: 'Organization-defined',
};

export const STATUS_LABEL: Record<RecurringStatus, string> = {
  current: 'Current',
  due_soon: 'Due soon',
  overdue: 'Overdue',
  no_evidence_on_file: 'No evidence on file',
};

/** Months per cycle. `org_defined` has no machine-readable interval. */
const INTERVAL_MONTHS: Partial<Record<RecurringFrequency, number>> = {
  annual: 12,
  semiannual: 6,
  quarterly: 3,
  monthly: 1,
  continuous: 1,
};

/** Whether the artifact currently carries evidence content for its kind. */
export function hasEvidence(artifact: Artifact): boolean {
  switch (artifact.kind) {
    case 'file':
      return Boolean(artifact.filePath);
    case 'url':
      return Boolean(artifact.url?.trim());
    case 'text':
      return Boolean(artifact.body?.trim());
    case 'diagram':
      return Boolean(artifact.mermaid?.trim());
  }
}

export function nextDueDate(artifact: Artifact): string | null {
  const months = artifact.recurrence && INTERVAL_MONTHS[artifact.recurrence.frequencyType];
  if (!months || !artifact.collectedAt || !hasEvidence(artifact)) return null;
  const due = DateTime.fromISO(artifact.collectedAt).plus({ months });
  return due.isValid ? due.toISODate() : null;
}

export function daysUntilDue(artifact: Artifact): number | null {
  const due = nextDueDate(artifact);
  if (!due) return null;
  return Math.ceil(DateTime.fromISO(due).diffNow('days').days);
}

export function recurringStatus(artifact: Artifact, dueSoonDays: number): RecurringStatus {
  if (!hasEvidence(artifact)) return 'no_evidence_on_file';
  const days = daysUntilDue(artifact);
  if (days === null) return 'current';
  if (days < 0) return 'overdue';
  if (days <= dueSoonDays) return 'due_soon';
  return 'current';
}

export function statusSeverity(status: RecurringStatus): 'success' | 'warning' | 'error' {
  if (status === 'current') return 'success';
  if (status === 'due_soon') return 'warning';
  return 'error';
}

/** The cycle a date falls in, e.g. `FY2026` for 2025-11-02 with an October fiscal start. */
export function cycleLabelFor(date: DateTime, settings: CycleSettings): string {
  if (settings.cycleBasis === 'calendar') return String(date.year);
  const startMonth = Math.min(12, Math.max(1, settings.fiscalYearStartMonth || 10));
  const fiscalYear = date.month >= startMonth ? date.year + 1 : date.year;
  return `FY${fiscalYear}`;
}

export function currentCycleLabel(settings: CycleSettings): string {
  return cycleLabelFor(DateTime.now(), settings);
}

/** Cycle label of the artifact's current evidence, or null when nothing is on file. */
export function artifactCycleLabel(artifact: Artifact, settings: CycleSettings): string | null {
  if (!hasEvidence(artifact) || !artifact.collectedAt) return null;
  const date = DateTime.fromISO(artifact.collectedAt);
  return date.isValid ? cycleLabelFor(date, settings) : null;
}

/** Non-archived cycles on file (current + history), newest first. */
export function activeCycleLabels(artifact: Artifact, settings: CycleSettings): string[] {
  const labels = (artifact.recurrence?.history ?? []).filter((c) => !c.archived).map((c) => c.cycleLabel);
  const current = artifactCycleLabel(artifact, settings);
  if (current) labels.push(current);
  return [...new Set(labels)].sort().reverse();
}

/** Cycles beyond the retention window, oldest first — candidates for archiving. */
export function cyclesBeyondRetention(artifact: Artifact, settings: CycleSettings): string[] {
  const labels = activeCycleLabels(artifact, settings).reverse();
  const keep = Math.max(1, artifact.recurrence?.retentionPeriods ?? 1);
  return labels.length <= keep ? [] : labels.slice(0, labels.length - keep);
}

/** Captures the artifact's current evidence as a history entry. */
export function snapshotCycle(artifact: Artifact, settings: CycleSettings): ArtifactCycle {
  return {
    id: globalThis.crypto.randomUUID(),
    cycleLabel: artifactCycleLabel(artifact, settings) ?? 'Unlabelled',
    collectedAt: artifact.collectedAt,
    collectedBy: artifact.collectedBy,
    archived: false,
    filePath: artifact.filePath,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    url: artifact.url,
    body: artifact.body,
    mermaid: artifact.mermaid,
    script: artifact.script,
  };
}

/**
 * Moves the current evidence into history so a new cycle can be collected.
 * File content is cleared (a new file must be chosen); links, notes and diagrams
 * are kept as a starting point for the new cycle.
 */
export function startNewCycle(artifact: Artifact, settings: CycleSettings, collectedBy: string): Artifact {
  if (!artifact.recurrence) return artifact;
  const history = hasEvidence(artifact)
    ? [snapshotCycle(artifact, settings), ...artifact.recurrence.history]
    : artifact.recurrence.history;
  return {
    ...artifact,
    filePath: undefined,
    fileName: undefined,
    mimeType: undefined,
    sizeBytes: undefined,
    sha256: undefined,
    collectedAt: DateTime.now().toISO() ?? undefined,
    collectedBy,
    recurrence: { ...artifact.recurrence, history },
  };
}

export function newRecurrence(template?: Partial<RecurringSeedTemplate>): ArtifactRecurrence {
  return {
    frequencyType: template?.frequencyType ?? 'annual',
    frequencyDetail: template?.frequencyDetail ?? '',
    retentionPeriods: 2,
    notes: '',
    history: [],
  };
}

export interface FrequencySuggestion {
  artifactId: string;
  artifactTitle: string;
  text: string;
}

const FREQUENCY_PARAM = /frequen|how often|interval|periodic/i;
const GENERIC_WORDS = new Set(['frequency', 'review', 'reviews', 'update', 'updates', 'organization', 'defined', 'which', 'with', 'from', 'that', 'and/or']);

/**
 * For a frequency-type organization-defined parameter, the recurring artifacts whose
 * cadence answers it. Artifacts whose evidence type or title shares a word with the
 * parameter (e.g. "policy", "procedure") are preferred; with `strict`, only those are returned.
 */
export function frequencySuggestions(
  parameterLabel: string,
  artifacts: Artifact[],
  strict = false,
): FrequencySuggestion[] {
  if (!FREQUENCY_PARAM.test(parameterLabel)) return [];
  const recurring = artifacts.filter((a) => a.recurrence);
  const keywords = parameterLabel
    .toLowerCase()
    .split(/[^a-z/]+/)
    .filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w))
    .map((w) => w.replace(/s$/, ''));
  const matches = recurring.filter((a) => {
    const haystack = `${a.evidenceType} ${a.title}`.toLowerCase();
    return keywords.some((k) => haystack.includes(k));
  });

  const seen = new Set<string>();
  return (matches.length || strict ? matches : recurring).flatMap((a) => {
    const text = a.recurrence!.frequencyDetail.trim() || FREQUENCY_LABEL[a.recurrence!.frequencyType];
    if (seen.has(text)) return [];
    seen.add(text);
    return [{ artifactId: a.id, artifactTitle: a.title || a.evidenceType, text }];
  });
}

/* --------------------------------------------------------------- seed table */

/** Broad categories used by the seed table and by recurring data saved before recurrence moved onto artifacts. */
export type EvidenceCategory =
  | 'training_record'
  | 'test_report'
  | 'review_log'
  | 'scan_report'
  | 'recertification'
  | 'policy_update'
  | 'other';

export const EVIDENCE_CATEGORY_LABEL: Record<EvidenceCategory, string> = {
  training_record: 'Training record',
  test_report: 'Test report',
  review_log: 'Review log',
  scan_report: 'Scan report',
  recertification: 'Recertification',
  policy_update: 'Policy update',
  other: 'Other',
};

export interface RecurringSeedTemplate {
  controlId: string;
  requirementLabel: string;
  frequencyType: RecurringFrequency;
  frequencyDetail: string;
  evidenceType: EvidenceCategory;
}

/**
 * Non-exhaustive starting point covering controls that structurally contain an
 * organization-defined frequency tied to a review, test, train, update or
 * assess action. Admins can add to, remove from, or override any of this.
 */
export const RECURRING_SEED_TEMPLATES: RecurringSeedTemplate[] = [
  { controlId: 'AT-2', requirementLabel: 'Literacy training and awareness completion', frequencyType: 'annual', frequencyDetail: '', evidenceType: 'training_record' },
  { controlId: 'AT-3', requirementLabel: 'Role-based training completion', frequencyType: 'annual', frequencyDetail: '', evidenceType: 'training_record' },
  { controlId: 'AT-4', requirementLabel: 'Training record retention', frequencyType: 'annual', frequencyDetail: 'Retention proof, not the training itself', evidenceType: 'training_record' },
  { controlId: 'CP-3', requirementLabel: 'Contingency training completion', frequencyType: 'annual', frequencyDetail: '', evidenceType: 'training_record' },
  { controlId: 'CP-4', requirementLabel: 'Contingency plan test / exercise', frequencyType: 'annual', frequencyDetail: '', evidenceType: 'test_report' },
  { controlId: 'CP-2', requirementLabel: 'Contingency plan review and update', frequencyType: 'annual', frequencyDetail: '', evidenceType: 'policy_update' },
  { controlId: 'IR-2', requirementLabel: 'Incident response training completion', frequencyType: 'annual', frequencyDetail: '', evidenceType: 'training_record' },
  { controlId: 'IR-3', requirementLabel: 'Incident response testing', frequencyType: 'annual', frequencyDetail: '', evidenceType: 'test_report' },
  { controlId: 'IR-8', requirementLabel: 'Incident response plan review and update', frequencyType: 'annual', frequencyDetail: '', evidenceType: 'policy_update' },
  { controlId: 'CA-2', requirementLabel: 'Control assessment report', frequencyType: 'annual', frequencyDetail: '', evidenceType: 'review_log' },
  { controlId: 'CA-7', requirementLabel: 'Continuous monitoring reporting', frequencyType: 'monthly', frequencyDetail: 'Continuous or monthly — confirm with the SSP', evidenceType: 'scan_report' },
  { controlId: 'RA-5', requirementLabel: 'Vulnerability scan reports', frequencyType: 'monthly', frequencyDetail: 'Monthly or organization-defined — confirm with the SSP', evidenceType: 'scan_report' },
  { controlId: 'AC-2', requirementLabel: 'Account review / recertification', frequencyType: 'annual', frequencyDetail: 'Organization-defined — confirm with the SSP', evidenceType: 'recertification' },
  { controlId: 'AC-6(7)', requirementLabel: 'Privileged access review', frequencyType: 'annual', frequencyDetail: 'Organization-defined — confirm with the SSP', evidenceType: 'recertification' },
  { controlId: 'PE-8', requirementLabel: 'Visitor access log review', frequencyType: 'quarterly', frequencyDetail: 'Organization-defined — confirm with the SSP', evidenceType: 'review_log' },
  { controlId: 'PE-3', requirementLabel: 'Physical access list review', frequencyType: 'annual', frequencyDetail: 'Organization-defined — confirm with the SSP', evidenceType: 'review_log' },
  { controlId: 'PS-6', requirementLabel: 'Access agreement / rules of behaviour re-acknowledgment', frequencyType: 'annual', frequencyDetail: '', evidenceType: 'recertification' },
  { controlId: 'PS-7', requirementLabel: 'External personnel review', frequencyType: 'annual', frequencyDetail: 'Organization-defined — confirm with the SSP', evidenceType: 'review_log' },
  { controlId: 'AU-6', requirementLabel: 'Audit record review and analysis', frequencyType: 'monthly', frequencyDetail: 'Organization-defined — confirm with the SSP', evidenceType: 'review_log' },
  { controlId: 'CM-6', requirementLabel: 'Configuration settings compliance scan', frequencyType: 'monthly', frequencyDetail: 'Organization-defined — confirm with the SSP', evidenceType: 'scan_report' },
];

export function seedTemplatesFor(controlId: string): RecurringSeedTemplate[] {
  return RECURRING_SEED_TEMPLATES.filter((t) => t.controlId === controlId);
}

/* ------------------------------------------------------- legacy migration */

/** Shape of the standalone recurring requirements stored before recurrence moved onto artifacts. */
export interface LegacyRecurringRequirement {
  id: string;
  requirementLabel: string;
  frequencyType: RecurringFrequency;
  frequencyDetail: string;
  retentionPeriods: number;
  evidenceType: EvidenceCategory;
  lastCollectedDate: string | null;
  notes: string;
  linkedFiles: Array<{ id: string; artifactId: string; cycleLabel: string; collectionDate: string; archived: boolean }>;
}

/**
 * Folds legacy requirements into the artifact list: each requirement becomes one
 * recurring artifact whose newest linked file is the current cycle and whose other
 * linked files become its history. Requirements with no files become placeholder
 * artifacts so they still show as "No evidence on file".
 */
export function mergeLegacyRecurring(
  artifacts: Artifact[],
  legacy: LegacyRecurringRequirement[] | undefined,
): Artifact[] {
  if (!legacy?.length) return artifacts;
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const consumed = new Set<string>();
  const folded = new Set<string>();
  const result = [...artifacts];

  for (const req of legacy) {
    const recurrenceBase = {
      frequencyType: req.frequencyType,
      frequencyDetail: req.frequencyDetail,
      retentionPeriods: req.retentionPeriods,
      notes: req.notes,
    };
    const linked = req.linkedFiles
      .filter((f) => byId.has(f.artifactId) && !consumed.has(f.artifactId))
      .sort((a, b) => Number(a.archived) - Number(b.archived) || b.collectionDate.localeCompare(a.collectionDate));

    const primaryLink = linked[0];
    if (!primaryLink) {
      result.push({
        id: req.id,
        evidenceType: EVIDENCE_CATEGORY_LABEL[req.evidenceType] ?? 'Other',
        title: req.requirementLabel,
        description: '',
        kind: 'file',
        recurrence: { ...recurrenceBase, history: [] },
      });
      continue;
    }

    const primary = byId.get(primaryLink.artifactId)!;
    consumed.add(primary.id);
    const history: ArtifactCycle[] = linked.slice(1).map((link) => {
      const a = byId.get(link.artifactId)!;
      consumed.add(a.id);
      folded.add(a.id);
      return {
        id: link.id,
        cycleLabel: link.cycleLabel,
        collectedAt: a.collectedAt ?? link.collectionDate,
        collectedBy: a.collectedBy,
        archived: link.archived,
        filePath: a.filePath,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        sha256: a.sha256,
        url: a.url,
        body: a.body,
        mermaid: a.mermaid,
        script: a.script,
      };
    });

    const index = result.findIndex((a) => a.id === primary.id);
    result[index] = {
      ...primary,
      title: req.requirementLabel || primary.title,
      collectedAt: primary.collectedAt ?? primaryLink.collectionDate ?? req.lastCollectedDate ?? undefined,
      recurrence: { ...recurrenceBase, history },
    };
  }

  return result.filter((a) => !folded.has(a.id));
}

/* ----------------------------------------------- recurring-language heuristic */

const RECURRING_LANGUAGE = [
  /\bfrequency\b/i,
  /\bperiodic(ally)?\b/i,
  /\bannual(ly)?\b/i,
  /\b(quarterly|monthly|semi-?annual(ly)?|weekly|daily)\b/i,
  /\breview[^.]{0,60}\bupdate\b/i,
  /\btest(s|ing)?\b[^.]{0,40}\bplan\b/i,
  /\breassess(es|ment)?\b/i,
  /\brecertif/i,
  /\bat least once\b/i,
];

/** True when a control's text reads like evidence will need re-collecting on a cadence. */
export function suggestsRecurringEvidence(text: string): boolean {
  return RECURRING_LANGUAGE.some((re) => re.test(text));
}
