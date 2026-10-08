/** Suggestions for organization-defined values drawn from what the app already holds for a control. */
import type { ResponsibleRole } from '@shared/types';

export interface OdpValueSuggestion {
  text: string;
  /** Short note on where the value came from, shown beside the suggestion. */
  basis: string;
}

const ROLE_PARAM = /official|\brole|personnel|officer|individual|\bowner\b|designated/i;
const MAX_ROLE_SUGGESTIONS = 3;

/** For a role/official-type parameter: the control's responsible role first, then other roles with a configured contact. */
export function roleSuggestions(
  parameterLabel: string,
  responsibleRole: string,
  roles: ResponsibleRole[] | undefined,
): OdpValueSuggestion[] {
  if (!ROLE_PARAM.test(parameterLabel)) return [];
  const all = roles ?? [];
  const build = (role: ResponsibleRole | undefined, basis: string): OdpValueSuggestion | null => {
    if (!role) return null;
    const name = role.name.trim();
    return { text: name ? `${role.label}, ${name}` : role.label, basis };
  };

  const ordered = [
    build(all.find((r) => r.id === responsibleRole), 'Responsible role for this control'),
    ...all.filter((r) => r.id !== responsibleRole && r.name.trim()).map((r) => build(r, 'Role contact in Settings')),
  ];
  return ordered.filter((s): s is OdpValueSuggestion => s !== null).slice(0, MAX_ROLE_SUGGESTIONS);
}
