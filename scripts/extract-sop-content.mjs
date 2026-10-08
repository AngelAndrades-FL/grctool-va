/**
 * Seeds catalog/sop-family-content.json (purpose, scope, policy, roles and references per control
 * family) from an existing POM .docx.
 *
 * Usage: node scripts/extract-sop-content.mjs "<path to POM.docx>"
 */
import fs from 'node:fs';
import path from 'node:path';
import PizZip from 'pizzip';

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/extract-sop-content.mjs "<path to POM.docx>"');
  process.exit(1);
}

// The POM numbers its first 17 SOPs in this order.
const FAMILY_IDS = ['AC', 'AT', 'AU', 'CA', 'CM', 'CP', 'IA', 'IR', 'MA', 'MP', 'PE', 'PL', 'PS', 'RA', 'SA', 'SC', 'SI'];

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const xml = new PizZip(fs.readFileSync(source)).file('word/document.xml').asText();
const paragraphs = (xml.slice(xml.indexOf('<w:body>')).match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) => ({
  style: /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '',
  text: decode((p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''))
    .replace(/\s+/g, ' ')
    .trim(),
}));

const SECTION_KINDS = [
  ['purpose', /Purpose$/],
  ['scope', /Scope$/],
  ['policy', /Policy$/],
  ['roles', /Roles and Responsibilities$/],
  ['procedures', /Procedures$/],
  ['references', /References$/],
];

const content = {};
let familyIndex = -1;
let family = null;
let section = null;
let role = null;

const bullet = (text) => text.replace(/^»\s*/, '').trim();

for (const { style, text } of paragraphs) {
  if (!text) continue;
  if (style === 'Heading1') {
    const m = /^(\d+)\s+(.+) SOP$/.exec(text);
    family = null;
    section = null;
    if (m && FAMILY_IDS[Number(m[1]) - 1]) {
      familyIndex = Number(m[1]) - 1;
      family = {
        familyNumber: Number(m[1]),
        purpose: '',
        scope: '',
        policy: '',
        roles: [],
        references: [],
        sections: {},
      };
      content[FAMILY_IDS[familyIndex]] = family;
    }
    continue;
  }
  if (!family) continue;

  if (style === 'Heading2') {
    const m = /^(\d+)\.(\d+)\s+(.+)$/.exec(text);
    const kind = m && SECTION_KINDS.find(([, re]) => re.test(m[3]))?.[0];
    section = kind ?? null;
    if (kind) family.sections[kind] = Number(m[2]);
    role = null;
    continue;
  }

  if (section === 'purpose' || section === 'scope' || section === 'policy') {
    family[section] = `${family[section]} ${text}`.trim();
  } else if (section === 'roles') {
    const header = /^(\d+\.\d+\.\d+)\s+(.+)$/.exec(text);
    if (header) {
      role = { name: header[2].trim(), responsibilities: [] };
      family.roles.push(role);
    } else if (role && text.startsWith('»')) {
      role.responsibilities.push(bullet(text));
    } else if (role && role.responsibilities.length) {
      role.responsibilities[role.responsibilities.length - 1] += ` ${text}`;
    }
  } else if (section === 'references') {
    if (text.startsWith('»')) family.references.push(bullet(text));
    else if (family.references.length) family.references[family.references.length - 1] += ` ${text}`;
  }
}

const out = path.join(import.meta.dirname, '..', 'catalog', 'sop-family-content.json');
fs.writeFileSync(out, `${JSON.stringify(content, null, 2)}\n`);
for (const [id, f] of Object.entries(content)) {
  console.log(`${id}: sections ${JSON.stringify(f.sections)}, ${f.roles.length} roles, ${f.references.length} references`);
}
console.log(`Wrote ${out}`);
