/** Shapes the control-family SOP data that fills the Word template (docxtemplater tags in catalog/sop-family-template.docx). */
import type { RichText, SopBullet, SopControlInput, SopFamilyInput } from './types.js';

/** Family-level text that the app does not collect; seeded from the POM into catalog/sop-family-content.json. */
export interface SopFamilyContent {
  familyNumber: number;
  purpose: string;
  scope: string;
  policy: string;
  roles: Array<{ name: string; responsibilities: string[] }>;
  references: string[];
}

export type SopContentFile = Record<string, SopFamilyContent>;

interface LexNode {
  type?: string;
  text?: string;
  children?: LexNode[];
}

const tidy = (text: string) => text.replace(/^[\s»]+/, '').replace(/\s+/g, ' ').trim();

function nodeText(node: LexNode): string {
  if (node.type === 'linebreak') return ' ';
  if (typeof node.text === 'string') return node.text;
  return (node.children ?? []).filter((c) => c.type !== 'list').map(nodeText).join('');
}

function listItems(list: LexNode): string[] {
  return (list.children ?? []).flatMap((item) => [
    nodeText(item),
    ...(item.children ?? []).filter((c) => c.type === 'list').flatMap(listItems),
  ]);
}

function bulletsFromText(text: string): SopBullet[] {
  const bullets: SopBullet[] = [];
  let lead: SopBullet | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const listLine = /^\s*[•\-*–]\s+/.test(line);
    const clean = tidy(line.replace(/^\s*[•\-*–]\s+/, ''));
    if (!clean) continue;
    if (listLine && lead) {
      lead.sub_bullets.push({ text: clean });
    } else {
      const bullet = { bullet_text: clean, sub_bullets: [] };
      bullets.push(bullet);
      lead = listLine ? null : bullet;
    }
  }
  return bullets;
}

/** Paragraphs become top-level bullets; list items become sub-bullets of the paragraph above them, or bullets of their own when no paragraph leads. */
export function narrativeToBullets(narrative: RichText): SopBullet[] {
  let root: LexNode | undefined;
  try {
    root = narrative.json ? (JSON.parse(narrative.json) as { root?: LexNode }).root : undefined;
  } catch {
    root = undefined;
  }
  if (!root?.children) return bulletsFromText(narrative.text);

  const bullets: SopBullet[] = [];
  let lead: SopBullet | null = null;
  for (const block of root.children) {
    if (block.type === 'list') {
      for (const item of listItems(block).map(tidy).filter(Boolean)) {
        if (lead) {
          lead.sub_bullets.push({ text: item });
        } else {
          bullets.push({ bullet_text: item, sub_bullets: [] });
        }
      }
    } else {
      const text = tidy(nodeText(block));
      if (!text) continue;
      lead = { bullet_text: text, sub_bullets: [] };
      bullets.push(lead);
    }
  }
  return bullets;
}

/** Controls with a narrative, or with an enhancement that has one; enhancements without a narrative are dropped. */
function narratedControls(controls: SopControlInput[]): SopControlInput[] {
  return controls.flatMap((control) => {
    const enhancements = control.enhancements.filter((e) => e.narrative.length);
    return control.narrative.length || enhancements.length ? [{ ...control, enhancements }] : [];
  });
}

/** The data object for one family. `fallbackNumber` is used for families the seed content does not cover. */
export function composeSopFamilyData(input: SopFamilyInput, content: SopFamilyContent | undefined, fallbackNumber: number) {
  const familyNumber = content?.familyNumber ?? fallbackNumber;
  let next = 0;
  const purposeNum = ++next;
  const scopeText = content?.scope ?? '[Scope to be written]';
  const scopeNum = scopeText ? ++next : 0;
  const policyNum = content?.policy ? ++next : 0;
  const rolesNum = ++next;
  const proceduresNum = ++next;
  const references = content?.references ?? [];
  const referencesNum = references.length ? ++next : 0;

  const procedures = `${familyNumber}.${proceduresNum}`;
  return {
    family_number: familyNumber,
    family_name: input.familyName,
    purpose_num: purposeNum,
    scope_num: scopeNum,
    policy_num: policyNum,
    roles_num: rolesNum,
    procedures_num: proceduresNum,
    references_num: referencesNum,
    purpose_text: content?.purpose ?? '[Purpose to be written]',
    has_scope: scopeNum > 0,
    scope_text: scopeText,
    has_policy: policyNum > 0,
    policy_text: content?.policy ?? '',
    roles: (content?.roles ?? []).map((role, i) => ({
      role_number: `${familyNumber}.${rolesNum}.${i + 1}`,
      role_name: role.name,
      responsibilities: role.responsibilities.map((text) => ({ text })),
    })),
    base_controls: narratedControls(input.controls).map((control, i) => {
      const number = `${procedures}.${i + 1}`;
      return {
        heading_number: number,
        heading_text: `${control.name} - ${control.id}`,
        narrative: control.narrative,
        has_artifacts: control.artifacts.length > 0,
        artifacts: control.artifacts.map((file_name) => ({ file_name })),
        enhancements: control.enhancements.map((enh, j) => ({
          heading_number: `${number}.${j + 1}`,
          heading_text: `${enh.name.includes('|') ? enh.name : `${control.name} | ${enh.name}`} - ${enh.id}`,
          narrative: enh.narrative,
          has_artifacts: enh.artifacts.length > 0,
          artifacts: enh.artifacts.map((file_name) => ({ file_name })),
        })),
      };
    }),
    has_references: referencesNum > 0,
    references: references.map((text) => ({ text })),
  };
}

/** All families that have at least one narrative, in POM order; families the seed content does not cover follow it. */
export function composeSopDocumentData(families: SopFamilyInput[], content: SopContentFile, exportDate: string) {
  let fallbackNumber = Math.max(0, ...Object.values(content).map((c) => c.familyNumber));
  return {
    export_date: exportDate,
    families: families
      .filter((family) => narratedControls(family.controls).length)
      .map((family) => {
        const seeded = content[family.familyId];
        return composeSopFamilyData(family, seeded, seeded ? seeded.familyNumber : ++fallbackNumber);
      })
      .sort((a, b) => a.family_number - b.family_number),
  };
}
