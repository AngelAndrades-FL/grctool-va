import { describe, expect, it } from 'vitest';
import * as check from './validate';

describe('validate', () => {
  it('accepts catalog control ids and rejects path-like ones', () => {
    expect(check.controlId('AC-2')).toBe('AC-2');
    expect(check.controlId('AC-2(1)')).toBe('AC-2(1)');
    expect(() => check.controlId('..\\..\\evil')).toThrow();
    expect(() => check.controlId('AC-2/../x')).toThrow();
    expect(() => check.controlId(42)).toThrow();
  });

  it('rejects malformed rename requests', () => {
    const base = { filePath: 'attachments/AC/a.pdf', controlId: 'AC-2', collectedOn: '2026-10-01' };
    expect(() => check.renameRequest({ ...base, evidenceType: 'Screenshot', title: 'Review' })).not.toThrow();
    expect(() => check.renameRequest({ ...base, scheme: 'poam' })).not.toThrow();
    expect(() => check.renameRequest({ ...base, collectedOn: 'yesterday', title: 't', evidenceType: 'e' })).toThrow();
    expect(() => check.renameRequest({ ...base, scheme: 'other' })).toThrow();
    expect(() => check.renameRequest(null)).toThrow();
  });

  it('validates script requests', () => {
    const ok = { controlId: 'AC-2', script: 'Get-Date', outputMode: 'text' };
    expect(check.scriptRequest(ok)).toBe(ok);
    expect(() => check.scriptRequest({ ...ok, outputMode: 'video' })).toThrow();
    expect(() => check.scriptRequest({ ...ok, script: 5 })).toThrow();
    expect(() => check.scriptRequest({ ...ok, timeoutMs: 'soon' })).toThrow();
  });

  it('validates file path lists', () => {
    expect(check.relPaths(['a', 'b'])).toEqual(['a', 'b']);
    expect(() => check.relPaths('a')).toThrow();
    expect(() => check.relPaths([1])).toThrow();
  });

  it('requires evidence records to carry a valid control id', () => {
    expect(() => check.evidenceRecords([{ controlId: 'AC-2' }])).not.toThrow();
    expect(() => check.evidenceRecords([{ controlId: 'nope' }])).toThrow();
    expect(() => check.evidenceRecords({})).toThrow();
  });
});
