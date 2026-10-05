// Verifies EvidenceRecord -> OSCAL SSP + supplemental -> EvidenceRecord loses nothing.
import { recordsToOscal, oscalToRecords, emptyRecord, readAtoDates } from '../shared/oscal.js';
import { mergeLegacyRecurring } from '../shared/recurring.js';
import type { AppSettings, EvidenceRecord } from '../shared/types.js';
import { DEFAULT_PROMPT_TEMPLATE } from '../shared/ai.js';

const settings: AppSettings = {
  systemName: 'Test System',
  systemId: 'sys-42',
  organization: 'VA',
  currentUser: 'tester',
  baseline: 'Moderate',
  frameworkMode: 'va',
  lastAtoDate: '2025-03-14',
  nextAtoDate: '2028-03-14',
  evidenceStaleAfterDays: 365,
  recurringDueSoonDays: 30,
  cycleBasis: 'fiscal',
  fiscalYearStartMonth: 10,
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  promptVersion: 3,
  promptHistory: [],
  themeMode: 'light',
};

function populated(controlId: string): EvidenceRecord {
  const r = emptyRecord(controlId, 'hybrid');
  return {
    ...r,
    implementationStatus: 'partially_implemented',
    inScope: true,
    naJustification: 'n/a text',
    origination: 'hybrid',
    narrative: {
      implementation: { json: '{"root":"impl"}', text: 'The ISO reviews accounts semi-annually.' },
      processDescription: { json: '{"root":"proc"}', text: 'Step one, step two.' },
      whyCompliant: { json: '{"root":"why"}', text: 'Because the SOP enforces it.' },
      limitations: { json: '{"root":"lim"}', text: 'Legacy hosts excluded.' },
    },
    odpResponses: [
      { parameterId: 'ac-2_prm_1', label: 'group criteria', value: 'Role-based', source: 'nist' },
      { parameterId: 'AC-2_va_0', label: 'review frequency', value: 'Semi-annually', source: 'va' },
    ],
    objectiveResponses: [
      { objectiveIndex: 0, met: true, note: 'See SOP p.4' },
      { objectiveIndex: 1, met: false, note: '' },
      { objectiveIndex: 2, met: null, note: 'pending' },
    ],
    processSteps: [
      { id: 'p1', order: 1, actor: 'ISO', action: 'Review', system: 'AD', frequency: 'Monthly', evidenceRef: 'a1' },
    ],
    artifacts: [
      {
        id: '5a0f4e0e-1111-4111-8111-111111111111',
        evidenceType: 'Policy',
        title: 'Access Control Policy',
        description: 'Enterprise policy doc',
        kind: 'file',
        filePath: 'attachments/AC/AC-2__20260924T1530__policy.pdf',
        fileName: 'AC-2__20260924T1530__policy.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12345,
        sha256: 'abc123',
        collectedAt: '2026-09-01T00:00:00.000Z',
        collectedBy: 'tester',
        recurrence: {
          frequencyType: 'annual',
          frequencyDetail: 'Organization-defined',
          retentionPeriods: 2,
          notes: 'Pulled from the IAM export.',
          history: [
            {
              id: 'cyc-1',
              cycleLabel: 'FY2025',
              collectedAt: '2025-02-01T00:00:00.000Z',
              collectedBy: 'tester',
              archived: false,
              filePath: 'attachments/AC/AC-2__20250201T0900__policy.pdf',
              fileName: 'AC-2__20250201T0900__policy.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1000,
              sha256: 'old123',
            },
            { id: 'cyc-0', cycleLabel: 'FY2024', archived: true, url: 'https://example.gov/old' },
          ],
        },
      },
      {
        id: '5a0f4e0e-2222-4222-8222-222222222222',
        evidenceType: 'Diagram',
        title: 'Flow',
        description: 'Data flow',
        kind: 'diagram',
        mermaid: 'graph TD; A-->B;',
        collectedAt: '2026-09-02T00:00:00.000Z',
        collectedBy: 'tester',
      },
      {
        id: '5a0f4e0e-3333-4333-8333-333333333333',
        evidenceType: 'Reference List',
        title: 'TRM',
        description: 'Approved tech',
        kind: 'url',
        url: 'https://example.gov/trm',
        collectedAt: '2026-09-03T00:00:00.000Z',
        collectedBy: 'tester',
      },
      {
        id: '5a0f4e0e-4444-4444-8444-444444444444',
        evidenceType: 'Configuration',
        title: 'Local administrators listing',
        description: 'Collected by script',
        kind: 'file',
        filePath: 'attachments/AC/AC-2__20260924T1600__admins.txt',
        fileName: 'AC-2__20260924T1600__admins.txt',
        mimeType: 'text/plain',
        sizeBytes: 480,
        sha256: 'def456',
        script: {
          language: 'powershell',
          source: 'Get-LocalGroupMember -Group Administrators',
          outputMode: 'text',
          ranAt: '2026-09-04T00:00:00.000Z',
          exitCode: 0,
          durationMs: 812,
          host: 'WORKSTATION-1',
          runBy: 'tester',
          stderr: '',
        },
        collectedAt: '2026-09-04T00:00:00.000Z',
        collectedBy: 'tester',
      },
    ],
    ownership: { responsibleRole: 'information-system-owner', owner: 'A. Owner', poc: '' },
    dates: {
      implementedOn: '2025-01-15',
      lastReviewedOn: '2026-06-01',
      nextReviewDue: '2026-12-01',
      evidenceAsOf: '2026-06-01',
    },
    poam: {
      hasFinding: true,
      findingId: 'F-2026-001',
      severity: 'moderate',
      remediationPlan: 'Patch legacy hosts',
      dueDate: '2026-12-31',
      artifactIds: ['art-1'],
    },
    aiEvaluations: [
      {
        id: 'eval-1',
        at: '2026-09-10T12:00:00.000Z',
        promptVersion: 3,
        inputHash: 'deadbeef',
        score: 72,
        verdict: 'other_than_satisfied',
        strengths: ['names the role'],
        gaps: ['no frequency'],
        objectiveCoverage: [{ objective: 'obj 1', covered: true, rationale: 'covered' }],
        suggestedRewrite: 'Rewritten text',
        renderedPrompt: 'PROMPT',
      },
    ],
    tags: ['priority', 'audit-2026'],
    changeLog: [{ at: '2026-09-10T12:00:00.000Z', field: 'status', from: 'planned', to: 'partial', by: 'tester' }],
    updatedAt: '2026-09-10T12:00:00.000Z',
  };
}

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL  ${label}`);
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`PASS  ${label}`);
  }
};

const original = [populated('AC-2'), populated('AC-2(1)'), emptyRecord('AU-6')];
const { ssp, supplemental } = recordsToOscal(original, settings);
const restored = oscalToRecords(ssp, supplemental);

console.log('--- OSCAL envelope ---');
check('oscal-version', ssp['system-security-plan'].metadata['oscal-version'], '1.2.0');
check('date-authorized', ssp['system-security-plan']['system-characteristics']['date-authorized'], '2025-03-14');
check('ato dates read back', readAtoDates(ssp), { lastAtoDate: '2025-03-14', nextAtoDate: '2028-03-14' });
check('control ids lowercased', ssp['system-security-plan']['control-implementation']['implemented-requirements'].map((r) => r['control-id']), ['ac-2', 'ac-2.1', 'au-6']);
check('users omitted (optional in 1.2.0)', 'users' in ssp['system-security-plan']['system-implementation'], false);
check('hash algorithm casing', ssp['system-security-plan']['back-matter']?.resources[0]?.rlinks?.[0]?.hashes?.[0]?.algorithm, 'SHA-256');
check('resource count (artifacts + unarchived earlier cycles)', ssp['system-security-plan']['back-matter']?.resources.length, 10);

console.log('\n--- round trip ---');
check('record count', restored.length, original.length);

for (const before of original) {
  const after = restored.find((r) => r.controlId === before.controlId)!;
  const label = before.controlId;
  check(`${label} implementationStatus`, after.implementationStatus, before.implementationStatus);
  check(`${label} origination`, after.origination, before.origination);
  check(`${label} inScope`, after.inScope, before.inScope);
  check(`${label} naJustification`, after.naJustification, before.naJustification);
  check(`${label} narrative`, after.narrative, before.narrative);
  check(`${label} odpResponses`, after.odpResponses, before.odpResponses);
  check(`${label} objectiveResponses`, after.objectiveResponses, before.objectiveResponses);
  check(`${label} processSteps`, after.processSteps, before.processSteps);
  check(`${label} artifacts`, after.artifacts, before.artifacts);
  check(`${label} ownership.responsibleRole`, after.ownership.responsibleRole, before.ownership.responsibleRole);
  check(`${label} dates`, after.dates, before.dates);
  check(`${label} poam`, after.poam, before.poam);
  check(`${label} aiEvaluations`, after.aiEvaluations, before.aiEvaluations);
  check(`${label} tags`, after.tags, before.tags);
  check(`${label} changeLog`, after.changeLog, before.changeLog);
  check(`${label} isEnhancement`, after.isEnhancement, before.isEnhancement);
  check(`${label} parentControlId`, after.parentControlId, before.parentControlId);
}

console.log('\n--- legacy recurring requirements fold into artifacts ---');
{
  const file = (id: string, collectedAt: string) => ({
    id,
    evidenceType: 'Training record',
    title: `upload ${id}`,
    description: '',
    kind: 'file' as const,
    filePath: `attachments/AT/${id}.pdf`,
    fileName: `${id}.pdf`,
    collectedAt,
  });
  const merged = mergeLegacyRecurring(
    [file('new', '2026-01-10T00:00:00.000Z'), file('old', '2025-01-10T00:00:00.000Z'), file('unrelated', '2026-03-01T00:00:00.000Z')],
    [
      {
        id: 'req-a',
        requirementLabel: 'Awareness training completion',
        frequencyType: 'annual',
        frequencyDetail: '',
        retentionPeriods: 2,
        evidenceType: 'training_record',
        lastCollectedDate: '2026-01-10',
        notes: 'note',
        linkedFiles: [
          { id: 'l1', artifactId: 'old', cycleLabel: 'FY2025', collectionDate: '2025-01-10', archived: false },
          { id: 'l2', artifactId: 'new', cycleLabel: 'FY2026', collectionDate: '2026-01-10', archived: false },
        ],
      },
      {
        id: 'req-b',
        requirementLabel: 'Role-based training',
        frequencyType: 'quarterly',
        frequencyDetail: '',
        retentionPeriods: 3,
        evidenceType: 'training_record',
        lastCollectedDate: null,
        notes: '',
        linkedFiles: [],
      },
    ],
  );
  check('artifact ids after merge', merged.map((a) => a.id), ['new', 'unrelated', 'req-b']);
  check('newest file is the current cycle', merged[0]?.title, 'Awareness training completion');
  check('older file becomes history', merged[0]?.recurrence?.history.map((c) => [c.cycleLabel, c.filePath]), [['FY2025', 'attachments/AT/old.pdf']]);
  check('unlinked artifact untouched', merged[1]?.recurrence, undefined);
  check('empty requirement becomes placeholder', [merged[2]?.recurrence?.frequencyType, merged[2]?.filePath], ['quarterly', undefined]);
}

console.log(`\n${failures === 0 ? 'ROUND TRIP CLEAN' : `${failures} FIELD(S) LOST OR MUTATED`}`);
process.exit(failures === 0 ? 0 : 1);
