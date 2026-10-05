/**
 * OSCAL v1.2.0 System Security Plan model plus the mapping to/from the app's
 * `EvidenceRecord`. Verified against
 * https://github.com/usnistgov/OSCAL/releases/download/v1.2.0/oscal_ssp_schema.json
 *
 * Anything OSCAL can legitimately express lives in `system-security-plan.json`
 * (status, origination, parameters, narrative, responsible roles, authorization
 * date, artifact resources). Everything else — Lexical editor state,
 * assessment-objective responses, AI evaluations, process steps, POA&M scratch,
 * change log — lives in `supplemental.json`, keyed by the same control id.
 */
import type {
  Artifact,
  ControlDesignation,
  EvidenceRecord,
  ImplementationStatus,
  AppSettings,
} from './types.js';
import { familyOf, fromOscalId, isEnhancementId, parentOf, toOscalId } from './ids.js';
import { mergeLegacyRecurring, type LegacyRecurringRequirement } from './recurring.js';

export const OSCAL_VERSION = '1.2.0';
export const NS = 'https://github.com/grctool/ns/oscal';
export const THIS_SYSTEM_COMPONENT_UUID = '11111111-0000-4000-8000-000000000001';

export interface OscalProp {
  name: string;
  value: string;
  uuid?: string;
  ns?: string;
  class?: string;
  group?: string;
  remarks?: string;
}

export interface OscalLink {
  href: string;
  rel?: string;
  'media-type'?: string;
  'resource-fragment'?: string;
  text?: string;
}

export interface OscalSetParameter {
  'param-id': string;
  values: string[];
  remarks?: string;
}

/** Schema enum for `implementation-status/state`. */
export type OscalImplementationState =
  | 'implemented'
  | 'partial'
  | 'planned'
  | 'alternative'
  | 'not-applicable';

export interface OscalImplementationStatus {
  state: OscalImplementationState;
  remarks?: string;
}

export interface OscalResponsibleRole {
  'role-id': string;
  'party-uuids'?: string[];
  props?: OscalProp[];
  links?: OscalLink[];
  remarks?: string;
}

export interface OscalByComponent {
  'component-uuid': string;
  uuid: string;
  description: string;
  props?: OscalProp[];
  links?: OscalLink[];
  'set-parameters'?: OscalSetParameter[];
  'implementation-status'?: OscalImplementationStatus;
  'responsible-roles'?: OscalResponsibleRole[];
  remarks?: string;
}

export interface OscalStatement {
  'statement-id': string;
  uuid: string;
  props?: OscalProp[];
  links?: OscalLink[];
  'responsible-roles'?: OscalResponsibleRole[];
  'by-components'?: OscalByComponent[];
  remarks?: string;
}

export interface OscalImplementedRequirement {
  uuid: string;
  'control-id': string;
  props?: OscalProp[];
  links?: OscalLink[];
  'set-parameters'?: OscalSetParameter[];
  'responsible-roles'?: OscalResponsibleRole[];
  statements?: OscalStatement[];
  'by-components'?: OscalByComponent[];
  remarks?: string;
}

export type OscalHashAlgorithm = 'SHA-256' | 'SHA-384' | 'SHA-512';

export interface OscalRlink {
  href: string;
  'media-type'?: string;
  hashes?: Array<{ algorithm: OscalHashAlgorithm; value: string }>;
}

export interface OscalResource {
  uuid: string;
  title?: string;
  description?: string;
  props?: OscalProp[];
  rlinks?: OscalRlink[];
  citation?: { text: string };
  remarks?: string;
}

export interface OscalSsp {
  'system-security-plan': {
    uuid: string;
    metadata: {
      title: string;
      published?: string;
      'last-modified': string;
      version: string;
      'oscal-version': string;
      props?: OscalProp[];
      links?: OscalLink[];
      roles?: Array<{ id: string; title: string; description?: string }>;
      parties?: Array<{ uuid: string; type: 'person' | 'organization'; name?: string }>;
    };
    'import-profile': { href: string; remarks?: string };
    'system-characteristics': {
      'system-ids': Array<{ id: string; 'identifier-type'?: string }>;
      'system-name': string;
      'system-name-short'?: string;
      description: string;
      props?: OscalProp[];
      links?: OscalLink[];
      /** OSCAL `date` (YYYY-MM-DD) — the date the system received its authorization. */
      'date-authorized'?: string;
      'security-sensitivity-level'?: string;
      'system-information': {
        'information-types': Array<{
          uuid: string;
          title: string;
          description: string;
          'confidentiality-impact'?: { base: string };
          'integrity-impact'?: { base: string };
          'availability-impact'?: { base: string };
        }>;
      };
      'security-impact-level'?: {
        'security-objective-confidentiality': string;
        'security-objective-integrity': string;
        'security-objective-availability': string;
      };
      status: { state: 'operational' | 'under-development' | 'under-major-modification' | 'disposition' | 'other'; remarks?: string };
      'authorization-boundary': { description: string };
    };
    'system-implementation': {
      /** Optional as of OSCAL 1.2.0. */
      users?: Array<{ uuid: string; title?: string; 'role-ids'?: string[] }>;
      components: Array<{
        uuid: string;
        type: string;
        title: string;
        description: string;
        props?: OscalProp[];
        status: { state: 'under-development' | 'operational' | 'disposition' | 'other' };
      }>;
      'inventory-items'?: unknown[];
      remarks?: string;
    };
    'control-implementation': {
      description: string;
      'set-parameters'?: OscalSetParameter[];
      'implemented-requirements': OscalImplementedRequirement[];
    };
    'back-matter'?: { resources: OscalResource[] };
  };
}

/** Fields that have no OSCAL home, stored alongside the SSP. */
export interface SupplementalRecord {
  controlId: string;
  narrativeJson: {
    implementation: string | null;
    processDescription: string | null;
    whyCompliant: string | null;
    limitations: string | null;
  };
  narrativeText: {
    processDescription: string;
    limitations: string;
    /** The implementation text itself; the SSP description holds the N/A rationale instead when not applicable. */
    implementation?: string;
  };
  objectiveResponses: EvidenceRecord['objectiveResponses'];
  processSteps: EvidenceRecord['processSteps'];
  poam: EvidenceRecord['poam'];
  poc?: string;
  /** Read-only: requirements saved before recurrence moved onto artifacts. Migrated on load, never written. */
  recurringEvidence?: LegacyRecurringRequirement[];
  aiEvaluations: EvidenceRecord['aiEvaluations'];
  changeLog: EvidenceRecord['changeLog'];
  dates: EvidenceRecord['dates'];
  artifactExtras: Record<
    string,
    Pick<
      Artifact,
      'kind' | 'mermaid' | 'body' | 'url' | 'script' | 'collectedAt' | 'collectedBy' | 'recurrence'
    >
  >;
  naJustification: string;
  inScope: boolean;
  updatedAt: string;
}

export interface SupplementalFile {
  schema: 'grctool/supplemental';
  version: 1;
  lastModified: string;
  records: Record<string, SupplementalRecord>;
}

const STATUS_TO_OSCAL: Record<ImplementationStatus, OscalImplementationState> = {
  not_started: 'planned',
  planned: 'planned',
  partially_implemented: 'partial',
  implemented: 'implemented',
  inherited: 'implemented',
  not_applicable: 'not-applicable',
  alternative_implementation: 'alternative',
};

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

export function emptyRecord(controlId: string, origination: ControlDesignation = 'hybrid'): EvidenceRecord {
  return {
    controlId,
    familyId: familyOf(controlId),
    isEnhancement: isEnhancementId(controlId),
    parentControlId: parentOf(controlId),
    implementationStatus: 'not_started',
    inScope: true,
    naJustification: '',
    origination,
    narrative: {
      implementation: { json: null, text: '' },
      processDescription: { json: null, text: '' },
      whyCompliant: { json: null, text: '' },
      limitations: { json: null, text: '' },
    },
    odpResponses: [],
    objectiveResponses: [],
    processSteps: [],
    artifacts: [],
    linkedArtifactIds: [],
    ownership: { responsibleRole: '', owner: '', poc: '' },
    dates: { implementedOn: null, lastReviewedOn: null, nextReviewDue: null, evidenceAsOf: null },
    poam: { hasFinding: false, findingId: '', severity: '', remediationPlan: '', dueDate: null, artifactIds: [] },
    aiEvaluations: [],
    tags: [],
    changeLog: [],
    updatedAt: new Date().toISOString(),
  };
}

export function emptySsp(settings: AppSettings): OscalSsp {
  const now = new Date().toISOString();
  const level = settings.baseline.toLowerCase();
  return {
    'system-security-plan': {
      uuid: uuid(),
      metadata: {
        title: `${settings.systemName} — System Security Plan`,
        'last-modified': now,
        version: '0.1.0',
        'oscal-version': OSCAL_VERSION,
        props: nextAtoProps(settings),
      },
      'import-profile': {
        href: '#nist-sp-800-53-rev5-va-6500-overlay',
      },
      'system-characteristics': {
        'system-ids': [{ id: settings.systemId || 'system-001' }],
        'system-name': settings.systemName,
        description: `Evidence collection workspace for ${settings.systemName}.`,
        'date-authorized': settings.lastAtoDate ?? undefined,
        'security-sensitivity-level': level,
        'system-information': {
          'information-types': [
            {
              uuid: uuid(),
              title: 'System information',
              description: 'Information processed by this system.',
              'confidentiality-impact': { base: `fips-199-${level}` },
              'integrity-impact': { base: `fips-199-${level}` },
              'availability-impact': { base: `fips-199-${level}` },
            },
          ],
        },
        'security-impact-level': {
          'security-objective-confidentiality': level,
          'security-objective-integrity': level,
          'security-objective-availability': level,
        },
        status: { state: 'under-development' },
        'authorization-boundary': { description: 'To be documented.' },
      },
      'system-implementation': {
        components: [
          {
            uuid: THIS_SYSTEM_COMPONENT_UUID,
            type: 'this-system',
            title: settings.systemName,
            description: 'The system under authorization.',
            status: { state: 'operational' },
          },
        ],
      },
      'control-implementation': {
        description: 'Control implementation statements captured in the GRC evidence workspace.',
        'implemented-requirements': [],
      },
      'back-matter': { resources: [] },
    },
  };
}

/** `next-ato-date` has no OSCAL home, so it rides along as a namespaced prop. */
function nextAtoProps(settings: AppSettings): OscalProp[] {
  return settings.nextAtoDate ? [{ name: 'next-ato-date', value: settings.nextAtoDate, ns: NS }] : [];
}

function prop(props: OscalProp[] | undefined, name: string): string | undefined {
  return props?.find((p) => p.name === name)?.value;
}

/** Split a set of records into an OSCAL SSP plus the supplemental sidecar. */
export function recordsToOscal(
  records: EvidenceRecord[],
  settings: AppSettings,
  existing?: OscalSsp,
): { ssp: OscalSsp; supplemental: SupplementalFile } {
  const ssp: OscalSsp = existing ? structuredClone(existing) : emptySsp(settings);
  const plan = ssp['system-security-plan'];
  const now = new Date().toISOString();

  plan.metadata['last-modified'] = now;
  plan.metadata['oscal-version'] = OSCAL_VERSION;
  plan.metadata.title = `${settings.systemName} — System Security Plan`;
  plan.metadata.props = nextAtoProps(settings);
  plan['system-characteristics']['system-name'] = settings.systemName;
  plan['system-characteristics']['system-ids'] = [{ id: settings.systemId || 'system-001' }];
  plan['system-characteristics']['date-authorized'] = settings.lastAtoDate ?? undefined;

  const priorReqs = new Map(
    (plan['control-implementation']['implemented-requirements'] ?? []).map((r) => [r['control-id'], r]),
  );
  const resources: OscalResource[] = [];
  const ownedArtifacts = new Map(
    records.flatMap((r) => r.artifacts.map((a) => [a.id, { owner: r.controlId, artifact: a }] as const)),
  );
  const supplemental: SupplementalFile = {
    schema: 'grctool/supplemental',
    version: 1,
    lastModified: now,
    records: {},
  };

  const implemented: OscalImplementedRequirement[] = records.map((rec) => {
    const oscalId = toOscalId(rec.controlId);
    const prior = priorReqs.get(oscalId);
    const links: OscalLink[] = [];

    // Linked artifacts live once in back-matter under their owner; this control only references them.
    for (const id of rec.linkedArtifactIds ?? []) {
      const owned = ownedArtifacts.get(id);
      if (owned && owned.owner !== rec.controlId) {
        links.push({ href: `#${id}`, rel: 'evidence', text: owned.artifact.title || owned.artifact.evidenceType });
      }
    }

    for (const art of rec.artifacts) {
      const resourceUuid = art.id;
      resources.push({
        uuid: resourceUuid,
        title: art.title || art.fileName || art.evidenceType,
        description: art.description,
        props: [
          { name: 'evidence-type', value: art.evidenceType, ns: NS },
          { name: 'artifact-kind', value: art.kind, ns: NS },
          { name: 'control-id', value: rec.controlId, ns: NS },
          ...(art.sizeBytes === undefined ? [] : [{ name: 'size-bytes', value: String(art.sizeBytes), ns: NS }]),
          ...(art.collectedAt ? [{ name: 'collected-at', value: art.collectedAt, ns: NS }] : []),
          ...(art.collectedBy ? [{ name: 'collected-by', value: art.collectedBy, ns: NS }] : []),
        ],
        rlinks: art.filePath
          ? [
              {
                href: art.filePath,
                'media-type': art.mimeType ?? 'application/octet-stream',
                ...(art.sha256 ? { hashes: [{ algorithm: 'SHA-256' as const, value: art.sha256 }] } : {}),
              },
            ]
          : art.url
            ? [{ href: art.url }]
            : undefined,
      });
      links.push({ href: `#${resourceUuid}`, rel: 'evidence', text: art.title || art.evidenceType });

      // Earlier cycles are published too, so an assessor can verify current and prior evidence from the SSP alone.
      for (const cycle of art.recurrence?.history ?? []) {
        if (cycle.archived || (!cycle.filePath && !cycle.url)) continue;
        resources.push({
          uuid: cycle.id,
          title: `${art.title || art.evidenceType} — ${cycle.cycleLabel}`,
          props: [
            { name: 'evidence-type', value: art.evidenceType, ns: NS },
            { name: 'control-id', value: rec.controlId, ns: NS },
            { name: 'recurrence-cycle-of', value: art.id, ns: NS },
            { name: 'cycle-label', value: cycle.cycleLabel, ns: NS },
            ...(cycle.collectedAt ? [{ name: 'collected-at', value: cycle.collectedAt, ns: NS }] : []),
          ],
          rlinks: cycle.filePath
            ? [
                {
                  href: cycle.filePath,
                  'media-type': cycle.mimeType ?? 'application/octet-stream',
                  ...(cycle.sha256 ? { hashes: [{ algorithm: 'SHA-256' as const, value: cycle.sha256 }] } : {}),
                },
              ]
            : [{ href: cycle.url! }],
        });
        links.push({ href: `#${cycle.id}`, rel: 'evidence', text: `${art.title || art.evidenceType} (${cycle.cycleLabel})` });
      }
    }

    supplemental.records[rec.controlId] = {
      controlId: rec.controlId,
      narrativeJson: {
        implementation: rec.narrative.implementation.json,
        processDescription: rec.narrative.processDescription.json,
        whyCompliant: rec.narrative.whyCompliant.json,
        limitations: rec.narrative.limitations.json,
      },
      narrativeText: {
        processDescription: rec.narrative.processDescription.text,
        limitations: rec.narrative.limitations.text,
        implementation: rec.narrative.implementation.text,
      },
      objectiveResponses: rec.objectiveResponses,
      processSteps: rec.processSteps,
      poam: rec.poam,
      poc: rec.ownership.poc,
      aiEvaluations: rec.aiEvaluations,
      changeLog: rec.changeLog,
      dates: rec.dates,
      artifactExtras: Object.fromEntries(
        rec.artifacts.map((a) => [
          a.id,
          {
            kind: a.kind,
            mermaid: a.mermaid,
            body: a.body,
            url: a.url,
            script: a.script,
            collectedAt: a.collectedAt,
            collectedBy: a.collectedBy,
            recurrence: a.recurrence,
          },
        ]),
      ),
      naJustification: rec.naJustification,
      inScope: rec.inScope,
      updatedAt: rec.updatedAt,
    };

    return {
      uuid: prior?.uuid ?? uuid(),
      'control-id': oscalId,
      props: [
        { name: 'control-origination', value: rec.origination.replace(/_/g, '-'), ns: NS },
        { name: 'grc-status', value: rec.implementationStatus, ns: NS },
        { name: 'in-scope', value: String(rec.inScope), ns: NS },
        ...(rec.tags.length ? [{ name: 'tags', value: rec.tags.join(','), ns: NS }] : []),
        ...(rec.dates.lastReviewedOn ? [{ name: 'last-reviewed', value: rec.dates.lastReviewedOn, ns: NS }] : []),
        ...(rec.dates.nextReviewDue ? [{ name: 'next-review-due', value: rec.dates.nextReviewDue, ns: NS }] : []),
        ...(rec.dates.evidenceAsOf ? [{ name: 'evidence-as-of', value: rec.dates.evidenceAsOf, ns: NS }] : []),
        ...(rec.dates.implementedOn ? [{ name: 'implemented-on', value: rec.dates.implementedOn, ns: NS }] : []),
      ],
      'set-parameters': rec.odpResponses
        .filter((p) => p.value.trim().length > 0)
        .map((p) => ({ 'param-id': p.parameterId, values: [p.value], remarks: p.label })),
      'by-components': [
        {
          'component-uuid': THIS_SYSTEM_COMPONENT_UUID,
          uuid: prior?.['by-components']?.[0]?.uuid ?? uuid(),
          description:
            rec.implementationStatus === 'not_applicable' && rec.naJustification.trim()
              ? rec.naJustification
              : rec.narrative.implementation.text,
          'implementation-status': {
            state: STATUS_TO_OSCAL[rec.implementationStatus],
            remarks: rec.implementationStatus === 'not_applicable' ? rec.naJustification : undefined,
          },
          'responsible-roles': rec.ownership.responsibleRole
            ? [{ 'role-id': rec.ownership.responsibleRole, remarks: rec.ownership.owner }]
            : undefined,
          links: links.length ? links : undefined,
          remarks: rec.narrative.whyCompliant.text || undefined,
        },
      ],
    };
  });

  plan['control-implementation']['implemented-requirements'] = implemented;
  plan['back-matter'] = { resources };
  return { ssp, supplemental };
}

/** Read the authorization dates back out of a stored SSP. */
export function readAtoDates(ssp: OscalSsp | null): { lastAtoDate: string | null; nextAtoDate: string | null } {
  if (!ssp) return { lastAtoDate: null, nextAtoDate: null };
  const plan = ssp['system-security-plan'];
  return {
    lastAtoDate: plan['system-characteristics']['date-authorized'] ?? null,
    nextAtoDate: prop(plan.metadata.props, 'next-ato-date') || null,
  };
}

/** Rehydrate `EvidenceRecord`s by merging the SSP with its supplemental sidecar. */export function oscalToRecords(ssp: OscalSsp | null, supplemental: SupplementalFile | null): EvidenceRecord[] {
  if (!ssp) return [];
  const plan = ssp['system-security-plan'];
  const resources = new Map((plan['back-matter']?.resources ?? []).map((r) => [r.uuid, r]));

  return (plan['control-implementation']['implemented-requirements'] ?? []).map((req) => {
    const controlId = fromOscalId(req['control-id']);
    const sup = supplemental?.records[controlId];
    const byComp = req['by-components']?.[0];
    const base = emptyRecord(controlId);

    const resourcesHere = (byComp?.links ?? [])
      .filter((l) => l.href.startsWith('#'))
      .map((l) => resources.get(l.href.slice(1)))
      .filter((r): r is OscalResource => Boolean(r) && !prop(r?.props, 'recurrence-cycle-of'));
    // A resource tagged with another control's id is shared into this one rather than owned by it.
    const isLinked = (r: OscalResource) => {
      const owner = prop(r.props, 'control-id');
      return owner !== undefined && owner !== controlId;
    };
    const linkedArtifactIds = resourcesHere.filter(isLinked).map((r) => r.uuid);

    const artifacts: Artifact[] = resourcesHere
      .filter((r) => !isLinked(r))
      .map((r) => {
        const extras = sup?.artifactExtras[r.uuid];
        const rlink = r.rlinks?.[0];
        const size = prop(r.props, 'size-bytes');
        return {
          id: r.uuid,
          evidenceType: prop(r.props, 'evidence-type') ?? '',
          title: r.title ?? '',
          description: r.description ?? '',
          kind: extras?.kind ?? ((prop(r.props, 'artifact-kind') as Artifact['kind']) || 'file'),
          filePath: rlink && !rlink.href.startsWith('http') ? rlink.href : undefined,
          fileName: rlink && !rlink.href.startsWith('http') ? rlink.href.split('/').pop() : undefined,
          mimeType: rlink?.['media-type'],
          sizeBytes: size === undefined ? undefined : Number(size),
          sha256: rlink?.hashes?.[0]?.value,
          url: extras?.url ?? (rlink?.href.startsWith('http') ? rlink.href : undefined),
          mermaid: extras?.mermaid,
          body: extras?.body,
          script: extras?.script,
          collectedAt: extras?.collectedAt ?? prop(r.props, 'collected-at'),
          collectedBy: extras?.collectedBy ?? prop(r.props, 'collected-by'),
          ...(extras?.recurrence ? { recurrence: extras.recurrence } : {}),
        };
      });

    return {
      ...base,
      implementationStatus:
        (prop(req.props, 'grc-status') as ImplementationStatus) ?? base.implementationStatus,
      origination:
        ((prop(req.props, 'control-origination') ?? '').replace(/-/g, '_') as EvidenceRecord['origination']) ||
        base.origination,
      inScope: sup?.inScope ?? prop(req.props, 'in-scope') !== 'false',
      naJustification: sup?.naJustification ?? '',
      tags: (prop(req.props, 'tags') ?? '').split(',').filter(Boolean),
      narrative: {
        implementation: {
          json: sup?.narrativeJson.implementation ?? null,
          text: sup?.narrativeText.implementation ?? byComp?.description ?? '',
        },
        processDescription: {
          json: sup?.narrativeJson.processDescription ?? null,
          text: sup?.narrativeText.processDescription ?? '',
        },
        whyCompliant: { json: sup?.narrativeJson.whyCompliant ?? null, text: byComp?.remarks ?? '' },
        limitations: { json: sup?.narrativeJson.limitations ?? null, text: sup?.narrativeText.limitations ?? '' },
      },
      odpResponses: (req['set-parameters'] ?? []).map((p) => ({
        parameterId: p['param-id'],
        label: p.remarks ?? p['param-id'],
        value: p.values[0] ?? '',
        source: p['param-id'].includes('_prm_') ? ('nist' as const) : ('va' as const),
      })),
      objectiveResponses: sup?.objectiveResponses ?? [],
      processSteps: sup?.processSteps ?? [],
      artifacts: mergeLegacyRecurring(artifacts, sup?.recurringEvidence),
      linkedArtifactIds,
      ownership: {
        responsibleRole: byComp?.['responsible-roles']?.[0]?.['role-id'] ?? '',
        owner: byComp?.['responsible-roles']?.[0]?.remarks ?? '',
        poc: sup?.poc ?? '',
      },
      dates: sup?.dates ?? {
        implementedOn: prop(req.props, 'implemented-on') ?? null,
        lastReviewedOn: prop(req.props, 'last-reviewed') ?? null,
        nextReviewDue: prop(req.props, 'next-review-due') ?? null,
        evidenceAsOf: prop(req.props, 'evidence-as-of') ?? null,
      },
      // Spread over the defaults so records written before a field existed still load.
      poam: { ...base.poam, ...sup?.poam, artifactIds: sup?.poam?.artifactIds ?? [] },
      aiEvaluations: sup?.aiEvaluations ?? [],
      changeLog: sup?.changeLog ?? [],
      updatedAt: sup?.updatedAt ?? plan.metadata['last-modified'],
    };
  });
}
