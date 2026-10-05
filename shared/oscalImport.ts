/**
 * Reads an OSCAL SSP produced by another tool (ServiceNow IRM exports OSCAL 1.1.2)
 * and maps it onto the app's OSCAL version and evidence fields.
 *
 * 1.1.2 -> 1.2.0 is a backward-compatible minor upgrade for the SSP model
 * (1.2.0 relaxes constraints such as optional `system-implementation/users` and adds
 * the separate control-mapping model), so a 1.1.x SSP is valid 1.2.0 once its
 * declared version is bumped. 1.0.x files carried implementation status as a prop
 * rather than the `implementation-status` assembly; that is normalized here too.
 */
import type { ControlDesignation, ImplementationStatus, OscalImportControl } from './types.js';
import { fromOscalId } from './ids.js';
import {
  OSCAL_VERSION,
  type OscalByComponent,
  type OscalImplementationState,
  type OscalImplementedRequirement,
  type OscalLink,
  type OscalProp,
  type OscalResource,
  type OscalResponsibleRole,
  type OscalSsp,
} from './oscal.js';

const STATE_TO_STATUS: Record<OscalImplementationState, ImplementationStatus> = {
  implemented: 'implemented',
  partial: 'partially_implemented',
  planned: 'planned',
  alternative: 'alternative_implementation',
  'not-applicable': 'not_applicable',
};

/** OSCAL/FedRAMP `control-origination` values onto the app's designation. */
const ORIGINATION: Record<string, ControlDesignation> = {
  'sp-corporate': 'common',
  common: 'common',
  'sp-system': 'system_specific',
  'system-specific': 'system_specific',
  'customer-configured': 'system_specific',
  'customer-provided': 'system_specific',
  shared: 'hybrid',
  hybrid: 'hybrid',
  inherited: 'inherited',
};

function parseVersion(version: string | undefined): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** Validates the document is an OSCAL SSP and upgrades it in place to the app's OSCAL version. */
export function migrateSsp(raw: unknown): { ssp: OscalSsp; sourceVersion: string; notes: string[] } {
  const doc = raw as Partial<OscalSsp> & { 'component-definition'?: unknown; 'assessment-results'?: unknown };
  const plan = doc?.['system-security-plan'];
  if (!plan || typeof plan !== 'object') {
    const other = Object.keys(doc ?? {}).find((k) => k !== '$schema');
    throw new Error(
      other
        ? `This file is an OSCAL "${other}", not a System Security Plan. Export the SSP from ServiceNow and try again.`
        : 'This file is not an OSCAL System Security Plan (no "system-security-plan" root).',
    );
  }

  const notes: string[] = [];
  const sourceVersion = plan.metadata?.['oscal-version'] ?? 'unknown';
  const parsed = parseVersion(sourceVersion);
  const target = parseVersion(OSCAL_VERSION)!;
  if (!parsed) {
    notes.push(`The file does not declare a recognizable oscal-version ("${sourceVersion}"); it was read as OSCAL 1.1.x.`);
  } else if (parsed[0] !== 1) {
    throw new Error(`OSCAL ${sourceVersion} is not supported. Only OSCAL 1.x SSPs can be imported.`);
  } else if (parsed[1] > target[1]) {
    notes.push(`The file declares OSCAL ${sourceVersion}, newer than this app's ${OSCAL_VERSION}; unknown fields were ignored.`);
  }

  const ssp = structuredClone(doc) as OscalSsp;
  const p = ssp['system-security-plan'];
  p.metadata = { ...p.metadata, 'oscal-version': OSCAL_VERSION };
  p['control-implementation'] = {
    ...p['control-implementation'],
    description: p['control-implementation']?.description ?? '',
    'implemented-requirements': p['control-implementation']?.['implemented-requirements'] ?? [],
  };

  // OSCAL 1.0.x: implementation status was a prop; 1.1+ made it an assembly.
  let converted = 0;
  const upgradeStatus = (bc: OscalByComponent) => {
    if (bc['implementation-status']) return;
    const value = bc.props?.find((pr) => pr.name === 'implementation-status')?.value as OscalImplementationState | undefined;
    if (value && value in STATE_TO_STATUS) {
      bc['implementation-status'] = { state: value };
      converted++;
    }
  };
  for (const req of p['control-implementation']['implemented-requirements']) {
    req['by-components']?.forEach(upgradeStatus);
    req.statements?.forEach((s) => s['by-components']?.forEach(upgradeStatus));
  }
  if (converted) notes.push(`Converted ${converted} legacy implementation-status prop(s) to the OSCAL 1.1+ assembly.`);
  if (sourceVersion !== OSCAL_VERSION) notes.push(`Migrated from OSCAL ${sourceVersion} to ${OSCAL_VERSION}.`);
  return { ssp, sourceVersion, notes };
}

function propValue(props: OscalProp[] | undefined, name: string): string | undefined {
  return props?.find((pr) => pr.name === name)?.value;
}

/** `ac-2_smt.a.1` -> `a.1.`; the bare `_smt` statement has no label. */
function statementLabel(statementId: string): string {
  const m = /_smt(?:\.(.+))?$/.exec(statementId);
  return m?.[1] ? `${m[1]}.` : '';
}

/** Flattens a migrated SSP into one import entry per implemented requirement. */
export function sspToImportControls(ssp: OscalSsp): { controls: OscalImportControl[]; notes: string[] } {
  const plan = ssp['system-security-plan'];
  const components = new Map((plan['system-implementation']?.components ?? []).map((c) => [c.uuid, c]));
  const parties = new Map((plan.metadata.parties ?? []).map((pa) => [pa.uuid, pa.name ?? '']));
  const resources = new Map((plan['back-matter']?.resources ?? []).map((r) => [r.uuid, r]));
  const reqs = plan['control-implementation']['implemented-requirements'];

  const componentIds = new Set<string>();
  for (const req of reqs) {
    req['by-components']?.forEach((bc) => componentIds.add(bc['component-uuid']));
    req.statements?.forEach((s) => s['by-components']?.forEach((bc) => componentIds.add(bc['component-uuid'])));
  }
  const multiComponent = componentIds.size > 1;
  const componentPrefix = (bc: OscalByComponent) =>
    multiComponent ? `[${components.get(bc['component-uuid'])?.title ?? 'Component'}] ` : '';

  const linksOf = (links: OscalLink[] | undefined) =>
    (links ?? []).flatMap((l) => {
      if (/^https?:\/\//i.test(l.href)) return [{ title: l.text || l.href, url: l.href }];
      if (!l.href.startsWith('#')) return [];
      const res: OscalResource | undefined = resources.get(l.href.slice(1));
      const href = res?.rlinks?.find((r) => /^https?:\/\//i.test(r.href))?.href;
      return href ? [{ title: res?.title || l.text || href, url: href }] : [];
    });

  const ownerOf = (roles: OscalResponsibleRole[] | undefined) => {
    const role = roles?.[0];
    if (!role) return { responsibleRole: '', owner: '' };
    const names = (role['party-uuids'] ?? []).map((u) => parties.get(u)).filter(Boolean);
    return { responsibleRole: role['role-id'], owner: names.join(', ') || role.remarks || '' };
  };

  let skippedEmpty = 0;
  const controls: OscalImportControl[] = [];
  for (const req of reqs as OscalImplementedRequirement[]) {
    const reqComponents = req['by-components'] ?? [];
    const statementComponents = (req.statements ?? []).flatMap((s) =>
      (s['by-components'] ?? []).map((bc) => ({ bc, label: statementLabel(s['statement-id']) })),
    );
    const allComponents = [...reqComponents, ...statementComponents.map((x) => x.bc)];

    const paragraphs = [
      ...reqComponents.map((bc) => bc.description?.trim() && `${componentPrefix(bc)}${bc.description.trim()}`),
      ...statementComponents.map(
        ({ bc, label }) => bc.description?.trim() && `${label ? `${label} ` : ''}${componentPrefix(bc)}${bc.description.trim()}`,
      ),
    ].filter((x): x is string => Boolean(x));

    const statusSource =
      allComponents.find((bc) => components.get(bc['component-uuid'])?.type === 'this-system' && bc['implementation-status']) ??
      allComponents.find((bc) => bc['implementation-status']);
    const state = statusSource?.['implementation-status']?.state;
    const originationRaw = (propValue(req.props, 'control-origination') ?? '').toLowerCase();

    const params = new Map<string, string>();
    for (const sp of [...(req['set-parameters'] ?? []), ...allComponents.flatMap((bc) => bc['set-parameters'] ?? [])]) {
      const value = sp.values?.filter(Boolean).join(', ');
      if (value && !params.has(sp['param-id'])) params.set(sp['param-id'], value);
    }

    const roleSource = req['responsible-roles']?.length ? req['responsible-roles'] : allComponents.find((bc) => bc['responsible-roles']?.length)?.['responsible-roles'];

    const urlSet = new Map<string, { title: string; url: string }>();
    for (const link of [...linksOf(req.links), ...allComponents.flatMap((bc) => linksOf(bc.links))]) urlSet.set(link.url, link);

    const entry: OscalImportControl = {
      controlId: fromOscalId(req['control-id']),
      implementationStatus: state ? STATE_TO_STATUS[state] : undefined,
      origination: ORIGINATION[originationRaw],
      narrative: paragraphs.join('\n\n'),
      remarks: [req.remarks, ...allComponents.map((bc) => bc.remarks)].filter((r): r is string => Boolean(r?.trim())).join('\n\n'),
      naJustification: state === 'not-applicable' ? statusSource?.['implementation-status']?.remarks ?? '' : '',
      setParameters: [...params].map(([paramId, value]) => ({ paramId, value })),
      ...ownerOf(roleSource),
      links: [...urlSet.values()],
    };

    if (!entry.narrative && !entry.implementationStatus && !entry.setParameters.length) {
      skippedEmpty++;
      continue;
    }
    controls.push(entry);
  }

  const notes: string[] = [];
  if (skippedEmpty) notes.push(`${skippedEmpty} implemented requirement(s) had no narrative, status or parameters and were skipped.`);
  if (multiComponent) notes.push('The SSP has several components; each narrative paragraph is prefixed with its component title.');
  return { controls, notes };
}

/** Compares parameter ids across `ac-1_prm_1`, `AC-1_prm_1`, `ac-01_prm_1` and `ac-2.1_prm_1` / `AC-2(1)_prm_1`. */
export function normalizeParamId(id: string): string {
  return id
    .toLowerCase()
    .replace(/\(/g, '.')
    .replace(/\)/g, '')
    .replace(/^([a-z]{2})-0*(\d+)/, '$1-$2');
}
