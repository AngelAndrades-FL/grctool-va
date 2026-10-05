/** Control identifier helpers. Catalog uses `AC-2` / `AC-2(1)`; OSCAL uses `ac-2` / `ac-2.1`. */

export function familyOf(controlId: string): string {
  return controlId.slice(0, controlId.indexOf('-')).toUpperCase();
}

export function isEnhancementId(controlId: string): boolean {
  return controlId.includes('(');
}

export function parentOf(controlId: string): string | undefined {
  const i = controlId.indexOf('(');
  return i === -1 ? undefined : controlId.slice(0, i).trim();
}

/** `AC-2(1)` -> `ac-2.1`, `AC-2` -> `ac-2` */
export function toOscalId(controlId: string): string {
  const m = /^([A-Za-z]{2})-(\d+)(?:\s*\((\d+)\))?$/.exec(controlId.trim());
  if (!m) return controlId.trim().toLowerCase().replace(/\s+/g, '');
  const [, fam, num, enh] = m;
  return enh ? `${fam.toLowerCase()}-${num}.${enh}` : `${fam.toLowerCase()}-${num}`;
}

/** `ac-2.1` -> `AC-2(1)` */
export function fromOscalId(oscalId: string): string {
  const m = /^([a-z]{2})-(\d+)(?:\.(\d+))?$/i.exec(oscalId.trim());
  if (!m) return oscalId.toUpperCase();
  const [, fam, num, enh] = m;
  return enh ? `${fam.toUpperCase()}-${num}(${enh})` : `${fam.toUpperCase()}-${num}`;
}

/** Filesystem-safe token for a control: `AC-2(1)` -> `AC-2_1` */
export function idToFileToken(controlId: string): string {
  return controlId.replace(/[()]/g, (c) => (c === '(' ? '_' : '')).replace(/\s+/g, '');
}

export function slugifyFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** `AC-2_1__20260924T1530__network-diagram.png` */
export function buildAttachmentName(controlId: string, originalName: string, when: Date): string {
  const stamp = when
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '')
    .slice(0, 13);
  return `${idToFileToken(controlId)}__${stamp}__${slugifyFileName(originalName)}`;
}

/** One `_`-delimited segment: underscores and other unsafe characters collapse to `-`. */
function nameSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** `AC-2_1_Access-Review_Quarterly-user-review_2026-10-01.pdf` (control_evidence type_title_collected on). */
export function buildArtifactFileName(parts: {
  controlId: string;
  evidenceType: string;
  title: string;
  collectedOn: string;
  extension: string;
}): string {
  const segments = [
    idToFileToken(parts.controlId),
    nameSegment(parts.evidenceType) || 'Evidence',
    nameSegment(parts.title) || 'Untitled',
    nameSegment(parts.collectedOn),
  ].filter(Boolean);
  const ext = /^\.[A-Za-z0-9]{1,10}$/.test(parts.extension) ? parts.extension.toLowerCase() : '';
  return `${segments.join('_')}${ext}`;
}

/** `AC-2_1_2026-10-01_poam.pdf`, or `archive_AC-2_1_2026-10-01_poam.pdf` when archived. */
export function buildPoamFileName(parts: {
  controlId: string;
  collectedOn: string;
  extension: string;
  archived: boolean;
}): string {
  const ext = /^\.[A-Za-z0-9]{1,10}$/.test(parts.extension) ? parts.extension.toLowerCase() : '';
  const name = [idToFileToken(parts.controlId), nameSegment(parts.collectedOn), 'poam'].filter(Boolean).join('_');
  return `${parts.archived ? 'archive_' : ''}${name}${ext}`;
}

/** Sort key that orders AC-1, AC-2, AC-2(1), AC-10 correctly. */
export function controlSortKey(controlId: string): string {
  const m = /^([A-Za-z]{2})-(\d+)(?:\s*\((\d+)\))?$/.exec(controlId.trim());
  if (!m) return controlId;
  const [, fam, num, enh] = m;
  return `${fam}-${num.padStart(3, '0')}-${(enh ?? '0').padStart(3, '0')}`;
}
