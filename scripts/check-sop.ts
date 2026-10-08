// Renders the SOP Word template with sample data and checks that every tag was filled.
import fs from 'node:fs';
import PizZip from 'pizzip';
import { composeSopDocumentData, narrativeToBullets, type SopContentFile } from '../shared/sop.js';
import { renderSopDocx } from '../shared/sopRender.js';
import type { SopFamilyInput } from '../shared/types.js';

const template = fs.readFileSync('catalog/sop-family-template.docx');
const content = JSON.parse(fs.readFileSync('catalog/sop-family-content.json', 'utf8')) as SopContentFile;

const lexical = JSON.stringify({
  root: {
    type: 'root',
    children: [
      { type: 'paragraph', children: [{ type: 'text', text: 'The following accounts are used:' }] },
      {
        type: 'list',
        children: [
          { type: 'listitem', children: [{ type: 'text', text: 'Standard User Accounts & "SUA"' }] },
          { type: 'listitem', children: [{ type: 'text', text: 'Service Accounts – not used.' }] },
        ],
      },
      { type: 'paragraph', children: [{ type: 'text', text: 'Authorized users complete training <first>.' }] },
    ],
  },
});

const input: SopFamilyInput = {
  familyId: 'AC',
  familyName: 'Access Control',
  controls: [
    {
      id: 'AC-1',
      name: 'Access Control Policy and Procedures',
      narrative: narrativeToBullets({ json: null, text: '» VA PARS inherits the enterprise policy.\n• Sub item one\nSecond bullet.' }),
      artifacts: [],
      enhancements: [],
    },
    {
      id: 'AC-2',
      name: 'Account Management',
      narrative: narrativeToBullets({ json: lexical, text: '' }),
      artifacts: ['AC-2__20260924T1530__SecurityGroups.png', 'AC-2__20260925T0900__Access & Request.pdf'],
      enhancements: [
        { id: 'AC-2(1)', name: 'Automated System Account Management', narrative: narrativeToBullets({ json: null, text: 'Automated.' }), artifacts: ['AC-2_1__workflow.docx'] },
        { id: 'AC-2(2)', name: 'Account Management | Removal of Temporary/Emergency Accounts', narrative: narrativeToBullets({ json: null, text: 'Not applicable.' }), artifacts: [] },
        { id: 'AC-2(3)', name: 'Disable Inactive Accounts', narrative: [], artifacts: ['AC-2_3__dropped.png'] },
      ],
    },
    { id: 'AC-3', name: 'Access Enforcement', narrative: [], artifacts: ['AC-3__dropped.png'], enhancements: [] },
    {
      id: 'AC-4',
      name: 'Information Flow Enforcement',
      narrative: [],
      artifacts: [],
      enhancements: [{ id: 'AC-4(1)', name: 'Object Security Attributes', narrative: narrativeToBullets({ json: null, text: 'Attributes are bound.' }), artifacts: [] }],
    },
  ],
};

const emptyFamily: SopFamilyInput = {
  familyId: 'SI',
  familyName: 'System and Information Integrity',
  controls: [{ id: 'SI-1', name: 'Policy and Procedures', narrative: [], artifacts: [], enhancements: [] }],
};

const failures: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) failures.push(message);
};

const listOnly = narrativeToBullets({
  json: JSON.stringify({
    root: {
      type: 'root',
      children: [
        {
          type: 'list',
          children: [
            { type: 'listitem', children: [{ type: 'text', text: 'First' }] },
            { type: 'listitem', children: [{ type: 'text', text: 'Second' }] },
          ],
        },
      ],
    },
  }),
  text: '',
});
check(listOnly.length === 2 && listOnly.every((b) => b.sub_bullets.length === 0), 'a list with no leading paragraph gives one bullet per item');
const textList = narrativeToBullets({ json: null, text: '- First\n- Second' });
check(textList.length === 2 && textList.every((b) => b.sub_bullets.length === 0), 'plain-text list lines give one bullet per line');

function render(families: SopFamilyInput[]): string[] {
  const data = composeSopDocumentData(families, content, 'October 7, 2026');
  const xml = new PizZip(renderSopDocx(template, data)).file('word/document.xml')!.asText();
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) =>
    (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
      .map((t) => t.replace(/<[^>]+>/g, ''))
      .join('')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&'),
  );
}

// Listed out of order on purpose: the document must come out in POM order, with uncovered families last.
const doc = render([
  { ...input, familyId: 'PM', familyName: 'Program Management' },
  { ...input, familyId: 'AT', familyName: 'Awareness and Training' },
  input,
  emptyFamily,
]);
const ac = doc;
check(doc.indexOf('1 Access Control SOP') > 0, 'AC section present, after the front matter');
check(doc.indexOf('2 Awareness and Training SOP') > doc.indexOf('1 Access Control SOP'), 'AT follows AC');
check(doc.indexOf('18 Program Management SOP') > doc.indexOf('2 Awareness and Training SOP'), 'uncovered family comes last');
check(ac.includes('1.1 Access Control Purpose'), 'purpose heading');
check(ac.includes('1.3 Access Control Roles and Responsibilities'), 'roles heading numbering');
check(ac.includes('1.3.1 Information System Owner (ISO)'), 'role number');
check(ac.includes('1.4.1 Access Control Policy and Procedures - AC-1'), 'base control heading');
check(ac.includes('1.4.2.2 Account Management | Removal of Temporary/Emergency Accounts - AC-2(2)'), 'enhancement heading keeps its parent prefix');
check(ac.includes('1.4.2.1 Account Management | Automated System Account Management - AC-2(1)'), 'enhancement heading adds the parent prefix');
check(ac.includes('VA PARS inherits the enterprise policy.'), 'leading » typed in a narrative is dropped');
check(ac.includes('Standard User Accounts & "SUA"'), 'special characters are escaped');
check(ac.includes('Authorized users complete training <first>.'), 'angle brackets survive');
check(!doc.some((p) => p.includes('AC-2(3)')), 'enhancement without a narrative is left out');
check(!doc.some((p) => p.includes('- AC-3')), 'control without a narrative is left out');
check(doc.includes('1.4.3 Information Flow Enforcement - AC-4'), 'control kept for its enhancement, numbered without the dropped ones');
check(!doc.includes('17 System and Information Integrity SOP'), 'family without narratives is left out');
check(doc.some((p) => p.startsWith('October 7, 2026, | Veterans Affairs (VA) Product')), 'title page shows the export date');
check(!doc.some((p) => p.includes('July 24, 2024')), 'old title page date is gone');
check(doc.includes('AC-2__20260924T1530__SecurityGroups.png'), 'control artifact file name is listed');
check(doc.includes('AC-2__20260925T0900__Access & Request.pdf'), 'artifact file names are escaped');
check(doc.includes('AC-2_1__workflow.docx'), 'enhancement artifact file name is listed');
check(doc.filter((p) => p === 'Evidence artifacts:').length === 6, 'the label appears once per control or enhancement that has artifacts (two in each of the three families)');
check(!doc.some((p) => p.includes('dropped.png')), 'artifacts of controls left out of the document are not listed');
check(doc.some((p) => p.startsWith('Appendix A')), 'content after the SOP sections is kept');
check(!doc.some((p) => p.includes('issued for routine non-privileged access')), 'original SOP text is replaced');
check(!ac.some((p) => p === '1.3 Access Control Policy'), 'no policy section for AC');
check(ac.some((p) => p.includes('Access Control References')), 'references section');
check(!ac.some((p) => /[{}]/.test(p)), `unfilled tags: ${ac.filter((p) => /[{}]/.test(p)).join(' | ')}`);

check(doc.some((p) => p.includes('Awareness and Training Policy')), 'AT has a policy section');
check(doc.includes('18 Program Management SOP'), 'uncovered family numbering');
check(doc.includes('[Purpose to be written]'), 'uncovered family placeholder');

if (failures.length) {
  console.error(failures.map((f) => `FAIL ${f}`).join('\n'));
  process.exit(1);
}
console.log('SOP template checks passed');
