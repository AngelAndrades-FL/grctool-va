// Scrapes the verbatim Control Statement and Supplemental Guidance for every catalog
// control/enhancement from csf.tools into catalog/csf-guidance.json.
// Usage: node scripts/fetch-csf-guidance.mjs
import fs from 'node:fs';

const BASE = 'https://csf.tools/reference/nist-sp-800-53/r5';
const OUT = 'catalog/csf-guidance.json';
const DELAY_MS = 400;

const catalog = JSON.parse(fs.readFileSync('catalog/800-53.json', 'utf8'));

function urlFor(id) {
  const m = /^([A-Z]{2})-(\d+)(?:\((\d+)\))?$/.exec(id);
  if (!m) throw new Error(`Unrecognised control id ${id}`);
  const [, fam, num, enh] = m;
  const f = fam.toLowerCase();
  return enh ? `${BASE}/${f}/${f}-${num}/${f}-${num}-${enh}/` : `${BASE}/${f}/${f}-${num}/`;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026' };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

function label(style, depth, n) {
  const alpha = (upper) => {
    const c = String.fromCharCode(96 + ((n - 1) % 26) + 1);
    return upper ? c.toUpperCase() : c;
  };
  const roman = () => ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'][n - 1] ?? String(n);
  switch (style ?? ['lower-alpha', 'decimal', 'lower-alpha'][depth % 3]) {
    case 'lower-alpha': return `${alpha(false)}.`;
    case 'upper-alpha': return `${alpha(true)}.`;
    case 'lower-roman': return `${roman()}.`;
    case 'upper-roman': return `${roman().toUpperCase()}.`;
    default: return `${n}.`;
  }
}

/** Flattens a fragment of csf.tools HTML into lines, numbering and indenting nested lists. */
function htmlToLines(html) {
  const lines = [];
  const lists = [];
  let buf = null;
  const flush = () => {
    if (buf) {
      const text = decode(buf.text).replace(/\s+/g, ' ').trim();
      if (text) lines.push('  '.repeat(buf.depth) + (buf.prefix ? `${buf.prefix} ` : '') + text);
    }
    buf = null;
  };
  const depth = () => Math.max(lists.length - 1, 0);

  for (const tok of html.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (tok[0] !== '<') {
      buf ??= { depth: depth(), prefix: '', text: '' };
      buf.text += tok;
      continue;
    }
    const tag = /^<\/?\s*([a-z0-9]+)/i.exec(tok)?.[1]?.toLowerCase();
    const closing = tok[1] === '/';
    if (tag === 'ol' || tag === 'ul') {
      flush();
      if (closing) lists.pop();
      else lists.push({ style: tag === 'ul' ? 'bullet' : /list-style-type:\s*([a-z-]+)/i.exec(tok)?.[1], n: 0 });
    } else if (tag === 'li' && !closing) {
      flush();
      const list = lists.at(-1);
      if (list) list.n += 1;
      buf = { depth: depth(), prefix: list ? (list.style === 'bullet' ? '-' : label(list.style, depth(), list.n)) : '', text: '' };
    } else if (tag === 'li' || tag === 'p' || tag === 'br' || tag === 'div') {
      flush();
    } else if (tag === 'h2' || tag === 'h3') {
      if (!closing) flush();
    }
  }
  flush();
  return lines;
}

function section(html, cls) {
  const m = new RegExp(`<section class="${cls}">([\\s\\S]*?)</section>\\s*<!-- \\.${cls} -->`).exec(html);
  return m ? m[1].replace(/<h2[^>]*>[\s\S]*?<\/h2>/i, '') : null;
}

async function fetchPage(url) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'grctool-catalog-builder' } });
      if (res.status === 404) return null;
      if (res.ok) return await res.text();
    } catch (err) {
      console.warn(`  retry ${attempt} for ${url}: ${err.cause?.code ?? err.message}`);
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw new Error(`Failed to fetch ${url}`);
}

const ids = catalog.control_families.flatMap((f) =>
  f.controls.flatMap((c) => [c.control_id, ...(c.control_enhancements ?? []).map((e) => e.enhancement_id)]),
);

// Resume from a previous partial run; delete the output file to force a full refresh.
const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
const controls = previous?.controls ?? {};
const missing = [];

function save() {
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        source: 'CSF Tools — NIST SP 800-53 Revision 5 (https://csf.tools/reference/nist-sp-800-53/r5/)',
        retrieved: new Date().toISOString().slice(0, 10),
        missing,
        controls,
      },
      null,
      2,
    ) + '\n',
  );
}

for (const [i, id] of ids.entries()) {
  if (controls[id]) continue;
  const url = urlFor(id);
  const html = await fetchPage(url);
  const stmt = html && section(html, 'reference-content');
  const guide = html && section(html, 'supplemental-guidance');
  if (!stmt && !guide) {
    missing.push(id);
    console.log(`[${i + 1}/${ids.length}] ${id}  -- not found`);
  } else {
    controls[id] = {
      url,
      control_statement: stmt ? htmlToLines(stmt).join('\n') : '',
      supplemental_guidance: guide ? htmlToLines(guide).join('\n\n') : '',
    };
    console.log(`[${i + 1}/${ids.length}] ${id}`);
  }
  if (i % 20 === 0) save();
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

save();
console.log(`\nWrote ${Object.keys(controls).length} entries to ${OUT}; ${missing.length} not found: ${missing.join(', ')}`);
