// Throwaway check of the VA/NIST baseline logic against the real catalog.
import fs from 'node:fs';
import {
  isControlInBaseline,
  isEnhancementInBaseline,
  selectedEnhancements,
  parseVaAllocation,
} from '../src/domain/baseline.ts';

const catalog = JSON.parse(fs.readFileSync('catalog/800-53.json', 'utf8'));
const all = catalog.control_families.flatMap((f) => f.controls);
const byId = new Map(all.map((c) => [c.control_id, c]));

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

console.log('--- parseVaAllocation ---');
check('"AC-2 (1)(2)(3)(4)"', parseVaAllocation('AC-2 (1)(2)(3)(4)'), { selected: true, enhancements: [1, 2, 3, 4] });
check('"Not Selected"', parseVaAllocation('Not Selected'), { selected: false, enhancements: [] });
check('"AC-1"', parseVaAllocation('AC-1'), { selected: true, enhancements: [] });
check('"AC-19(5)"', parseVaAllocation('AC-19(5)'), { selected: true, enhancements: [5] });
check('undefined', parseVaAllocation(undefined), { selected: false, enhancements: [] });

console.log('\n--- plan step 2: Low + NIST excludes AC-4/AC-5/AC-6, includes AC-1/AC-2 ---');
for (const id of ['AC-4', 'AC-5', 'AC-6']) {
  check(`${id} not in NIST Low`, isControlInBaseline(byId.get(id), 'Low', 'nist'), false);
}
for (const id of ['AC-1', 'AC-2', 'AC-3', 'AC-7', 'AC-8']) {
  check(`${id} in NIST Low`, isControlInBaseline(byId.get(id), 'Low', 'nist'), true);
}

console.log('\n--- plan step 2: VA pulls AC-19(5) down to Low (800-53B says Moderate) ---');
const ac19 = byId.get('AC-19');
const ac19e5 = ac19.control_enhancements.find((e) => e.enhancement_id === 'AC-19(5)');
check('AC-19(5) NOT in NIST Low', isEnhancementInBaseline(ac19, ac19e5, 'Low', 'nist'), false);
check('AC-19(5) IS in VA Low', isEnhancementInBaseline(ac19, ac19e5, 'Low', 'va'), true);

console.log('\n--- plan step 3: Moderate + VA on AC-2 yields exactly (1)(2)(3)(4) ---');
const ac2 = byId.get('AC-2');
check(
  'AC-2 VA Moderate enhancements',
  selectedEnhancements(ac2, 'Moderate', 'va').map((e) => e.enhancement_id),
  ['AC-2(1)', 'AC-2(2)', 'AC-2(3)', 'AC-2(4)'],
);
check(
  'AC-2 VA High enhancements',
  selectedEnhancements(ac2, 'High', 'va').map((e) => e.enhancement_id),
  ['AC-2(1)', 'AC-2(2)', 'AC-2(3)', 'AC-2(4)', 'AC-2(5)', 'AC-2(11)', 'AC-2(12)', 'AC-2(13)'],
);
check('AC-2 VA Low enhancements', selectedEnhancements(ac2, 'Low', 'va').map((e) => e.enhancement_id), []);

console.log('\n--- withdrawn / not-selected controls are never in baseline ---');
check('AC-13 (withdrawn) VA High', isControlInBaseline(byId.get('AC-13'), 'High', 'va'), false);
check('AC-13 (withdrawn) All', isControlInBaseline(byId.get('AC-13'), 'All', 'va'), false);
check('AC-9 (not_selected) NIST High', isControlInBaseline(byId.get('AC-9'), 'High', 'nist'), false);
check('AC-18(3) (no VA allocation) VA High', isEnhancementInBaseline(
  byId.get('AC-18'),
  byId.get('AC-18').control_enhancements.find((e) => e.enhancement_id === 'AC-18(3)'),
  'High',
  'va',
), false);

console.log('\n--- corpus sweep: counts per baseline/mode ---');
for (const mode of ['nist', 'va']) {
  for (const level of ['Low', 'Moderate', 'High']) {
    const controls = all.filter((c) => isControlInBaseline(c, level, mode)).length;
    const enh = all.reduce((n, c) => n + selectedEnhancements(c, level, mode).length, 0);
    console.log(`  ${mode.padEnd(4)} ${level.padEnd(8)} controls=${String(controls).padStart(3)}  enhancements=${String(enh).padStart(3)}`);
  }
}

console.log('\n--- unparsed allocation strings (should be empty) ---');
const odd = new Set();
for (const c of all) {
  for (const v of Object.values(c.va_overlay?.va_baseline_allocation ?? {})) {
    if (typeof v === 'string' && v.trim() && !/^not\s*selected$/i.test(v) && !/^[A-Z]{2}-\d+/.test(v.trim())) {
      odd.add(v);
    }
  }
}
console.log(odd.size === 0 ? '  none' : [...odd].map((s) => `  ${JSON.stringify(s)}`).join('\n'));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
