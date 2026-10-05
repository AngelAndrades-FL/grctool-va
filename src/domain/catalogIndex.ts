/**
 * Flattens the catalog into addressable nodes (controls and enhancements share
 * one id space) and builds the lookup/search structures the UI navigates with.
 */
import type {
  Baseline,
  BaselineFilter,
  Catalog,
  CatalogControl,
  CatalogEnhancement,
  CatalogFamily,
  ControlDesignation,
  CrossReference,
  EvidenceRequirement,
  FrameworkMode,
  VaOverlay,
} from '@shared/types';
import { controlSortKey } from '@shared/ids';
import { isControlInBaseline, isEnhancementInBaseline } from './baseline';

export interface ControlNode {
  id: string;
  name: string;
  familyId: string;
  familyName: string;
  isEnhancement: boolean;
  parentId?: string;
  status: string;
  control: CatalogControl;
  enhancement?: CatalogEnhancement;
  /** Effective view of the node's own fields, enhancement-aware. */
  statement: string;
  statementVerbatim: string;
  discussion: string;
  supplementalGuidance: string;
  plainEnglish: string;
  assessmentObjectives: string[];
  parameters: Array<{ parameterId: string; description: string }>;
  evidenceRequired: EvidenceRequirement[];
  vaOverlay?: VaOverlay;
  relatedControls: string[];
  crossReferences: CrossReference[];
  designation: ControlDesignation;
  priorityCode: string;
  controlTypes: string[];
  searchText: string;
}

export interface CatalogIndex {
  catalog: Catalog;
  families: CatalogFamily[];
  familyById: Map<string, CatalogFamily>;
  nodes: ControlNode[];
  nodeById: Map<string, ControlNode>;
  controlsByFamily: Map<string, ControlNode[]>;
}

function toNode(
  family: CatalogFamily,
  control: CatalogControl,
  enhancement?: CatalogEnhancement,
): ControlNode {
  const source = enhancement ?? control;
  const nist = source.nist_800_53;
  const overlay = source.va_overlay ?? (enhancement ? control.va_overlay : undefined);
  const id = enhancement ? enhancement.enhancement_id : control.control_id;
  const name = enhancement ? enhancement.enhancement_name : control.control_name;

  const node: ControlNode = {
    id,
    name,
    familyId: family.family_id,
    familyName: family.family_name,
    isEnhancement: Boolean(enhancement),
    parentId: enhancement ? control.control_id : undefined,
    status: source.status,
    control,
    enhancement,
    statement: nist.control_statement ?? '',
    statementVerbatim: nist.control_statement_verbatim ?? '',
    discussion: nist.discussion ?? '',
    supplementalGuidance: nist.supplemental_guidance ?? '',
    plainEnglish: source.plain_english_explanation ?? '',
    assessmentObjectives: nist.assessment_objectives ?? [],
    parameters: (nist.parameters ?? []).map((p) => ({
      parameterId: p.parameter_id,
      description: p.description,
    })),
    evidenceRequired: source.evidence_required ?? [],
    vaOverlay: source.va_overlay,
    relatedControls: control.nist_800_53.related_controls ?? [],
    crossReferences: control.cross_reference_controls ?? [],
    designation: overlay?.control_designation ?? 'system_specific',
    priorityCode: (enhancement ? control.va_overlay?.priority_code : control.va_overlay?.priority_code) ?? '',
    controlTypes: control.control_type ?? [],
    searchText: '',
  };

  node.searchText = [
    id,
    name,
    node.plainEnglish,
    node.statement,
    family.family_name,
    ...node.evidenceRequired.map((e) => e.evidence_type),
  ]
    .join(' ')
    .toLowerCase();

  return node;
}

export function buildIndex(catalog: Catalog): CatalogIndex {
  const families = catalog.control_families;
  const nodes: ControlNode[] = [];

  for (const family of families) {
    for (const control of family.controls) {
      nodes.push(toNode(family, control));
      for (const enhancement of control.control_enhancements ?? []) {
        nodes.push(toNode(family, control, enhancement));
      }
    }
  }

  nodes.sort((a, b) => controlSortKey(a.id).localeCompare(controlSortKey(b.id)));

  const controlsByFamily = new Map<string, ControlNode[]>();
  for (const node of nodes) {
    const list = controlsByFamily.get(node.familyId) ?? [];
    list.push(node);
    controlsByFamily.set(node.familyId, list);
  }

  return {
    catalog,
    families,
    familyById: new Map(families.map((f) => [f.family_id, f])),
    nodes,
    nodeById: new Map(nodes.map((n) => [n.id, n])),
    controlsByFamily,
  };
}

export function isNodeInBaseline(
  node: ControlNode,
  baseline: BaselineFilter,
  mode: FrameworkMode,
): boolean {
  return node.isEnhancement && node.enhancement
    ? isEnhancementInBaseline(node.control, node.enhancement, baseline, mode)
    : isControlInBaseline(node.control, baseline, mode);
}

export interface NodeFilters {
  baseline: BaselineFilter;
  mode: FrameworkMode;
  showOutOfBaseline: boolean;
  showWithdrawn: boolean;
  familyId?: string;
  query?: string;
}

export function filterNodes(index: CatalogIndex, filters: NodeFilters): ControlNode[] {
  const query = filters.query?.trim().toLowerCase();
  return index.nodes.filter((node) => {
    if (filters.familyId && node.familyId !== filters.familyId) return false;
    if (!filters.showWithdrawn && node.status !== 'active') return false;
    if (!filters.showOutOfBaseline && !isNodeInBaseline(node, filters.baseline, filters.mode)) return false;
    if (query && !node.searchText.includes(query)) return false;
    return true;
  });
}

/** Ranked fuzzy-ish search for the command palette: id prefix beats name beats body. */
export function searchNodes(index: CatalogIndex, rawQuery: string, limit = 40): ControlNode[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  const scored: Array<{ node: ControlNode; score: number }> = [];

  for (const node of index.nodes) {
    const id = node.id.toLowerCase();
    let score = 0;
    if (id === query) score = 1000;
    else if (id.startsWith(query)) score = 800 - id.length;
    else if (node.name.toLowerCase().includes(query)) score = 500 - node.name.length / 10;
    else if (node.searchText.includes(query)) score = 200;
    if (score > 0) scored.push({ node, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || controlSortKey(a.node.id).localeCompare(controlSortKey(b.node.id)))
    .slice(0, limit)
    .map((s) => s.node);
}

export function baselineLevels(): Baseline[] {
  return ['Low', 'Moderate', 'High'];
}
