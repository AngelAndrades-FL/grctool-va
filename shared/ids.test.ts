import { describe, expect, it } from 'vitest';
import {
  buildArtifactFileName,
  buildAttachmentName,
  buildPoamFileName,
  controlSortKey,
  familyOf,
  fromOscalId,
  idToFileToken,
  slugifyFileName,
  toOscalId,
} from './ids';

describe('control ids', () => {
  it('converts between catalog and OSCAL forms', () => {
    expect(toOscalId('AC-2(1)')).toBe('ac-2.1');
    expect(toOscalId('AC-2')).toBe('ac-2');
    expect(fromOscalId('ac-2.1')).toBe('AC-2(1)');
    expect(fromOscalId('ac-2')).toBe('AC-2');
  });

  it('derives the family and a filesystem-safe token', () => {
    expect(familyOf('ac-2(1)')).toBe('AC');
    expect(idToFileToken('AC-2(1)')).toBe('AC-2_1');
  });

  it('sorts AC-2 before AC-2(1) before AC-10', () => {
    const ids = ['AC-10', 'AC-2(1)', 'AC-2'];
    expect(ids.sort((a, b) => controlSortKey(a).localeCompare(controlSortKey(b)))).toEqual(['AC-2', 'AC-2(1)', 'AC-10']);
  });
});

describe('file names', () => {
  it('slugifies unsafe characters', () => {
    expect(slugifyFileName('../my file?.png')).toBe('..-my-file-.png');
    expect(slugifyFileName('a/b\\c')).not.toMatch(/[\\/]/);
  });

  it('builds attachment names with a timestamp', () => {
    const name = buildAttachmentName('AC-2(1)', 'network diagram.png', new Date('2026-09-24T15:30:00Z'));
    expect(name).toBe('AC-2_1__20260924T1530__network-diagram.png');
  });

  it('builds artifact names and drops unsafe extensions', () => {
    const parts = { controlId: 'AC-2(1)', evidenceType: 'Access Review', title: 'Quarterly review', collectedOn: '2026-10-01' };
    expect(buildArtifactFileName({ ...parts, extension: '.PDF' })).toBe('AC-2_1_Access-Review_Quarterly-review_2026-10-01.pdf');
    expect(buildArtifactFileName({ ...parts, extension: '.p/../f' })).toBe('AC-2_1_Access-Review_Quarterly-review_2026-10-01');
  });

  it('builds POA&M names, archived or not', () => {
    const parts = { controlId: 'AC-2', collectedOn: '2026-10-01', extension: '.pdf' };
    expect(buildPoamFileName({ ...parts, archived: false })).toBe('AC-2_2026-10-01_poam.pdf');
    expect(buildPoamFileName({ ...parts, archived: true })).toBe('archive_AC-2_2026-10-01_poam.pdf');
  });
});
