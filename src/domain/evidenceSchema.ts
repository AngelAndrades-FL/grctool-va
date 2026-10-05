/**
 * ArkType schema mirroring `EvidenceRecord`. Used as the TanStack Form validator
 * and to vet records arriving from an imported backup.
 */
import { type } from 'arktype';

const richText = type({ json: 'string | null', text: 'string' });

const artifactCycle = type({
  id: 'string',
  cycleLabel: 'string',
  'collectedAt?': 'string',
  'collectedBy?': 'string',
  archived: 'boolean',
  'filePath?': 'string',
  'fileName?': 'string',
  'mimeType?': 'string',
  'sizeBytes?': 'number',
  'sha256?': 'string',
  'url?': 'string',
  'body?': 'string',
  'mermaid?': 'string',
});

const artifactRecurrence = type({
  frequencyType: "'annual' | 'semiannual' | 'quarterly' | 'monthly' | 'continuous' | 'org_defined'",
  frequencyDetail: 'string',
  retentionPeriods: 'number',
  notes: 'string',
  history: artifactCycle.array(),
});

const artifact = type({
  id: 'string',
  evidenceType: 'string',
  title: 'string',
  description: 'string',
  kind: "'file' | 'url' | 'diagram' | 'text'",
  'filePath?': 'string',
  'fileName?': 'string',
  'mimeType?': 'string',
  'sizeBytes?': 'number',
  'sha256?': 'string',
  'url?': 'string',
  'mermaid?': 'string',
  'body?': 'string',
  'collectedAt?': 'string',
  'collectedBy?': 'string',
  'recurrence?': artifactRecurrence,
});

const objectiveCoverage = type({
  'objectiveIndex?': 'number',
  objective: 'string',
  covered: 'boolean',
  rationale: 'string',
});

const aiEvaluation = type({
  id: 'string',
  at: 'string',
  promptVersion: 'number',
  inputHash: 'string',
  score: 'number',
  verdict: "'satisfied' | 'other_than_satisfied' | 'insufficient_detail'",
  strengths: 'string[]',
  gaps: 'string[]',
  objectiveCoverage: objectiveCoverage.array(),
  suggestedRewrite: 'string',
  renderedPrompt: 'string',
  'rawResponse?': 'string',
});

export const evidenceRecordSchema = type({
  controlId: 'string > 0',
  familyId: 'string',
  isEnhancement: 'boolean',
  'parentControlId?': 'string',
  implementationStatus:
    "'not_started' | 'planned' | 'partially_implemented' | 'implemented' | 'inherited' | 'not_applicable' | 'alternative_implementation'",
  inScope: 'boolean',
  naJustification: 'string',
  origination: "'common' | 'hybrid' | 'system_specific' | 'inherited'",
  narrative: {
    implementation: richText,
    processDescription: richText,
    whyCompliant: richText,
    limitations: richText,
  },
  odpResponses: type({
    parameterId: 'string',
    label: 'string',
    value: 'string',
    source: "'nist' | 'va'",
  }).array(),
  objectiveResponses: type({
    objectiveIndex: 'number',
    met: 'boolean | null',
    note: 'string',
  }).array(),
  processSteps: type({
    id: 'string',
    order: 'number',
    actor: 'string',
    action: 'string',
    system: 'string',
    frequency: 'string',
    evidenceRef: 'string',
  }).array(),
  artifacts: artifact.array(),
  linkedArtifactIds: 'string[]',
  ownership: { responsibleRole: 'string', owner: 'string', poc: 'string' },
  dates: {
    implementedOn: 'string | null',
    lastReviewedOn: 'string | null',
    nextReviewDue: 'string | null',
    evidenceAsOf: 'string | null',
  },
  poam: {
    hasFinding: 'boolean',
    findingId: 'string',
    severity: "'' | 'low' | 'moderate' | 'high' | 'critical'",
    remediationPlan: 'string',
    dueDate: 'string | null',
    artifactIds: 'string[]',
  },
  aiEvaluations: aiEvaluation.array(),
  tags: 'string[]',
  changeLog: type({
    at: 'string',
    field: 'string',
    from: 'string',
    to: 'string',
    by: 'string',
  }).array(),
  updatedAt: 'string',
});

/** Cross-field rules the shape schema cannot express. */
export function validateEvidenceRules(record: {
  implementationStatus: string;
  naJustification: string;
  poam: { hasFinding: boolean; remediationPlan: string };
}): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (record.implementationStatus === 'not_applicable' && !record.naJustification.trim()) {
    errors.naJustification = 'A justification is required when a control is marked not applicable.';
  }
  if (record.poam.hasFinding && !record.poam.remediationPlan.trim()) {
    errors['poam.remediationPlan'] = 'Describe the remediation plan for the open finding.';
  }
  return Object.keys(errors).length ? errors : null;
}
