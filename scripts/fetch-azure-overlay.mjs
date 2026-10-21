// Scrapes the Azure Policy NIST SP 800-53 Rev. 5 regulatory compliance mapping from Microsoft Learn
// into catalog/azure-overlay.json: per-control ownership (Shared/Customer) and the built-in policies mapped to it.
// Usage: node --use-system-ca scripts/fetch-azure-overlay.mjs
import fs from 'node:fs';

const URL_ = 'https://learn.microsoft.com/en-us/azure/governance/policy/samples/nist-sp-800-53-r5';
const OUT = 'catalog/azure-overlay.json';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026' };

function text(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const res = await fetch(URL_);
if (!res.ok) throw new Error(`${URL_} returned ${res.status}`);
const html = await res.text();

const policies = {};
const controls = {};

const blockRe = /<p><strong>ID<\/strong>:\s*NIST SP 800-53 Rev\. 5 ([A-Z]{2}-\d+(?:\s*\(\d+\))?)\s*<strong>Ownership<\/strong>:\s*([A-Za-z]+)<\/p>\s*(?:<table>([\s\S]*?)<\/table>)?/g;

for (const m of html.matchAll(blockRe)) {
  const id = m[1].replace(/\s+/g, '');
  const ownership = m[2].toLowerCase();
  if (ownership !== 'shared' && ownership !== 'customer') continue;
  const ids = [];
  for (const row of (m[3] ?? '').match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 4) continue;
    const guid = /policyDefinitions%2F([0-9a-f-]{36})/i.exec(cells[0])?.[1] ?? /CMA_[A-Z]*\d+/.exec(cells[3])?.[0];
    const name = text(cells[0]);
    const key = guid ?? name;
    policies[key] ??= {
      name,
      description: text(cells[1]),
      effects: text(cells[2]),
      version: text(cells[3]),
    };
    ids.push(key);
  }
  controls[id] = { ownership, policies: [...new Set(ids)] };
}

if (Object.keys(controls).length < 100) throw new Error(`Only parsed ${Object.keys(controls).length} controls; the page layout may have changed.`);

fs.writeFileSync(
  OUT,
  JSON.stringify({ source: URL_, generated: new Date().toISOString().slice(0, 10), controls, policies }, null, 1) + '\n',
);
console.log(`Wrote ${OUT}: ${Object.keys(controls).length} controls, ${Object.keys(policies).length} policies.`);
