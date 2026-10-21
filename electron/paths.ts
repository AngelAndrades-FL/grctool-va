import path from 'node:path';

/** True when `target` is a strict descendant of `dir`; compares whole path segments, so `C:\ws-evil` is not inside `C:\ws`. */
export function isInside(dir: string, target: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
