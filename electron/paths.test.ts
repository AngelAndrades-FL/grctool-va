import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { isInside } from './paths';

describe('isInside', () => {
  const root = path.resolve('ws');

  it('accepts descendants', () => {
    expect(isInside(root, path.join(root, 'attachments', 'AC', 'a.pdf'))).toBe(true);
  });

  it('rejects the directory itself, parents and traversal', () => {
    expect(isInside(root, root)).toBe(false);
    expect(isInside(root, path.dirname(root))).toBe(false);
    expect(isInside(root, path.join(root, '..', 'other'))).toBe(false);
  });

  it('rejects a sibling that shares the name prefix', () => {
    expect(isInside(root, `${root}-evil${path.sep}a.txt`)).toBe(false);
  });
});
