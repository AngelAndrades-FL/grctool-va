/**
 * Builds catalog/sop-family-template.docx from an existing POM .docx.
 *
 * Everything outside the control-family SOPs (cover page, table of contents, front matter, appendices,
 * styles, headers, footers) is kept as is. The SOP sections, from "1 ... SOP" up to the first appendix,
 * are replaced by one {#families} block written with docxtemplater tags (see shared/sop.ts).
 *
 * Usage: node scripts/build-sop-template.mjs "<path to POM.docx>"
 */
import fs from 'node:fs';
import path from 'node:path';
import PizZip from 'pizzip';

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/build-sop-template.mjs "<path to POM.docx>"');
  process.exit(1);
}

const run = (text, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const tab = '<w:r><w:tab/></w:r>';
const para = (pPr, ...runs) => `<w:p><w:pPr>${pPr}</w:pPr>${runs.join('')}</w:p>`;
/** A paragraph holding only a loop/conditional tag; docxtemplater (paragraphLoop) drops it from the output. */
const control = (tag) => `<w:p><w:r><w:t>${tag}</w:t></w:r></w:p>`;

const H1 = '<w:pStyle w:val="Heading1"/><w:tabs><w:tab w:val="center" w:pos="1989"/></w:tabs><w:spacing w:after="48"/><w:ind w:left="-15" w:firstLine="0"/>';
const H2 = '<w:pStyle w:val="Heading2"/><w:tabs><w:tab w:val="center" w:pos="2098"/></w:tabs><w:spacing w:after="0"/><w:ind w:left="-15" w:firstLine="0"/>';
const H4 = '<w:pStyle w:val="Heading4"/><w:ind w:left="-5"/>';
const BODY = '<w:spacing w:after="230" w:line="246" w:lineRule="auto"/><w:ind w:left="-5"/><w:jc w:val="both"/>';
// Word's own bullet list (numId 1); only the indent differs between the two levels.
const LIST = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
const BULLET = `${LIST}<w:spacing w:after="96"/><w:ind w:left="360" w:right="1" w:hanging="360"/>`;
const NARRATIVE = `${LIST}<w:ind w:left="360" w:right="1" w:hanging="360"/>`;
const SUB_BULLET = `${LIST}<w:ind w:left="720" w:right="1" w:hanging="360"/>`;
const ENHANCEMENT = '<w:spacing w:after="12"/><w:ind w:left="-5"/>';
const BLUE = '<w:color w:val="1F5392"/>';
const BLACK = '<w:color w:val="000000"/>';
const ARIAL = '<w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/>';
const TNR = '<w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>';

const h2 = (numberTag, title) => para(H2, run(numberTag), run(' ', ARIAL), tab, run(title));
const h4 = (numberTag, titleTag) => para(H4, run(numberTag, BLACK), run(' ', ARIAL + BLACK), run(titleTag));

const narrative = [
  control('{#narrative}'),
  para(NARRATIVE, run('{bullet_text}')),
  control('{#sub_bullets}'),
  para(SUB_BULLET, run('{text}')),
  control('{/sub_bullets}'),
  control('{/narrative}'),
  control('{#has_artifacts}'),
  para('<w:keepNext/><w:spacing w:before="60" w:after="20"/><w:ind w:left="-5"/>', run('Evidence artifacts:', '<w:b/>')),
  control('{#artifacts}'),
  para(BULLET, run('{file_name}')),
  control('{/artifacts}'),
  control('{/has_artifacts}'),
];

const body = [
  control('{#families}'),
  para(H1, run('{family_number}'), run(' ', ARIAL), tab, run('{family_name} SOP')),

  h2('{family_number}.{purpose_num}', '{family_name} Purpose'),
  para(BODY, run('{purpose_text}')),

  control('{#has_scope}'),
  h2('{family_number}.{scope_num}', '{family_name} Scope'),
  para(BODY, run('{scope_text}')),
  control('{/has_scope}'),

  control('{#has_policy}'),
  h2('{family_number}.{policy_num}', '{family_name} Policy'),
  para(BODY, run('{policy_text}')),
  control('{/has_policy}'),

  h2('{family_number}.{roles_num}', '{family_name} Roles and Responsibilities'),
  control('{#roles}'),
  h4('{role_number}', '{role_name}'),
  control('{#responsibilities}'),
  para(BULLET, run('{text}')),
  control('{/responsibilities}'),
  control('{/roles}'),

  h2('{family_number}.{procedures_num}', '{family_name} Procedures'),
  control('{#base_controls}'),
  h4('{heading_number}', '{heading_text}'),
  ...narrative,
  control('{#enhancements}'),
  para(ENHANCEMENT, run('{heading_number}', TNR + BLUE), run(' ', ARIAL + BLUE), run('{heading_text}', BLUE)),
  ...narrative,
  control('{/enhancements}'),
  control('{/base_controls}'),

  control('{#has_references}'),
  h2('{family_number}.{references_num}', '{family_name} References'),
  control('{#references}'),
  para(BULLET, run('{text}')),
  control('{/references}'),
  control('{/has_references}'),
  control('{/families}'),
].join('');

const zip = new PizZip(fs.readFileSync(source));
const xml = zip.file('word/document.xml').asText();

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const textOf = (p) =>
  decode((p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')).trim();

/** Offset of the first Heading1 paragraph whose text matches, searching from `from`. */
function headingOffset(pattern, from = 0) {
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    if (m.index < from || !m[0].includes('<w:pStyle w:val="Heading1"/>')) continue;
    if (pattern.test(textOf(m[0]))) return m.index;
  }
  throw new Error(`No Heading1 matching ${pattern}`);
}

const start = headingOffset(/^1\s+.+ SOP$/);
const end = headingOffset(/^Appendix A\b/, start);

const count = (s, re) => (s.match(re) ?? []).length;
const removed = xml.slice(start, end);
const balanced = (s) =>
  count(s, /<w:tbl>/g) === count(s, /<\/w:tbl>/g) && count(s, /<w:sdt>/g) === count(s, /<\/w:sdt>/g);
if (!balanced(removed) || !balanced(xml.slice(0, start))) {
  throw new Error('The SOP sections are not whole top-level elements; adjust the cut points.');
}
console.log(`Replacing ${count(removed, /<w:p[ >]/g)} paragraphs of SOP sections; keeping the rest of the document.`);

// The title page carries the POM's publication date; it becomes the export date.
const TITLE_DATE = 'July 24, 2024,';
const composed = `${xml.slice(0, start)}${body}${xml.slice(end)}`;
if (!composed.includes(TITLE_DATE)) throw new Error(`Title page date "${TITLE_DATE}" not found.`);
zip.file('word/document.xml', composed.replaceAll(TITLE_DATE, '{export_date},'));

// The table of contents lists the SOP sections, so ask Word to refresh fields when the file is opened.
const settingsXml = zip.file('word/settings.xml').asText();
if (!settingsXml.includes('<w:updateFields')) {
  const before = ['<w:hdrShapeDefaults', '<w:footnotePr', '<w:endnotePr', '<w:compat'].find((t) => settingsXml.includes(t));
  zip.file('word/settings.xml', settingsXml.replace(before, `<w:updateFields w:val="true"/>${before}`));
}

const out = path.join(import.meta.dirname, '..', 'catalog', 'sop-family-template.docx');
fs.writeFileSync(out, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`Wrote ${out}`);
