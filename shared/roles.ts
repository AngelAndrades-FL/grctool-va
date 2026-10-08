/** Responsible roles offered on a control. Each `id` is written to the OSCAL SSP as `role-id`, so it stays fixed when the label is edited. */
import type { ResponsibleRole } from './types.js';

export const FAMILY_IDS = [
  'AC', 'AT', 'AU', 'CA', 'CM', 'CP', 'IA', 'IR', 'MA', 'MP',
  'PE', 'PL', 'PM', 'PS', 'PT', 'RA', 'SA', 'SC', 'SI', 'SR',
] as const;

/** Legacy single role that the per-family Common Control Provider roles replace. */
export const LEGACY_COMMON_CONTROL_PROVIDER = 'common-control-provider';

const role = (id: string, label: string): ResponsibleRole => ({ id, label, name: '', email: '' });

export function defaultResponsibleRoles(): ResponsibleRole[] {
  return [
    role('authorizing-official', 'Authorizing Official (AO)'),
    role('information-system-security-officer', 'Information System Security Officer (ISSO)'),
    role('system-owner', 'System Owner (SO)'),
    role('information-owner', 'Information Owner/Steward'),
    ...FAMILY_IDS.map((family) => role(`${family.toLowerCase()}-common-control-provider`, `${family} Common Control Provider`)),
    role('security-control-assessor', 'Security Control Assessor (SCA)'),
    role('privacy-officer', 'Privacy Officer'),
  ];
}

/** A role-id token from a label, made unique against `taken`. */
export function roleIdFromLabel(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'role';
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}
