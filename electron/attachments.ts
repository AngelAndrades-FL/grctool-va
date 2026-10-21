/** Attachment files inside the workspace: import, naming, safe path resolution, rename, delete and SSP back-matter collection. */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Artifact, AttachmentRenameRequest, WorkspaceInfo } from '../shared/types.js';
import type { OscalSsp } from '../shared/oscal.js';
import { buildArtifactFileName, buildAttachmentName, buildPoamFileName, familyOf } from '../shared/ids.js';
import { isInside } from './paths.js';
import { ensureWorkspace } from './storage.js';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.bmp': 'image/bmp',
  '.ps1': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function mimeForFile(fileName: string): string {
  return MIME_BY_EXT[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Copy a picked file into the workspace, renamed to
 * `<CONTROL>__<timestamp>__<original>` and filed under its control family.
 */
export async function importAttachment(
  sourcePath: string,
  controlId: string,
): Promise<Pick<Artifact, 'filePath' | 'fileName' | 'mimeType' | 'sizeBytes' | 'sha256'>> {
  const bytes = await fs.readFile(sourcePath);
  return writeAttachment(bytes, path.basename(sourcePath), controlId);
}

/** Store bytes the app produced itself (e.g. script output) using the same naming and hashing rules. */
export async function writeAttachment(
  bytes: Buffer,
  originalName: string,
  controlId: string,
): Promise<Pick<Artifact, 'filePath' | 'fileName' | 'mimeType' | 'sizeBytes' | 'sha256'>> {
  const ws = await ensureWorkspace();
  const family = familyOf(controlId);
  const targetDir = path.join(ws.attachmentsDir, family);
  await fs.mkdir(targetDir, { recursive: true });

  const fileName = buildAttachmentName(controlId, originalName, new Date());
  await fs.writeFile(path.join(targetDir, fileName), bytes);

  return {
    filePath: path.posix.join('attachments', family, fileName),
    fileName,
    mimeType: mimeForFile(originalName),
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** Resolves a workspace-relative path that must land inside the attachments folder, following symlinks. */
async function resolveAttachment(ws: WorkspaceInfo, relPath: string): Promise<string | null> {
  if (typeof relPath !== 'string' || relPath.includes('\0')) return null;
  const absolute = path.resolve(ws.root, relPath);
  if (!isInside(ws.attachmentsDir, absolute)) return null;
  try {
    const real = await fs.realpath(absolute);
    return isInside(await fs.realpath(ws.attachmentsDir), real) ? real : null;
  } catch {
    return null;
  }
}

/**
 * Rename a stored attachment in place (same family folder) to the artifact naming convention.
 * Appends `-2`, `-3`, … if another file already holds the name.
 */
export async function renameAttachment(
  req: AttachmentRenameRequest,
): Promise<Pick<Artifact, 'filePath' | 'fileName'>> {
  const ws = await ensureWorkspace();
  const current = await resolveAttachment(ws, req.filePath);
  if (!current) throw new Error('Attachment is outside the workspace attachments folder.');

  const dir = path.dirname(current);
  const ext = path.extname(current);
  const base =
    req.scheme === 'poam' || req.scheme === 'poam-archive'
      ? buildPoamFileName({ ...req, extension: ext, archived: req.scheme === 'poam-archive' })
      : buildArtifactFileName({ ...(req as Extract<AttachmentRenameRequest, { title: string }>), extension: ext });
  const stem = base.slice(0, base.length - path.extname(base).length);
  const finalExt = base.slice(stem.length);

  let fileName = base;
  for (let n = 2; ; n++) {
    const candidate = path.join(dir, fileName);
    if (candidate === current) break;
    try {
      await fs.access(candidate);
      fileName = `${stem}-${n}${finalExt}`;
    } catch {
      await fs.rename(current, candidate);
      break;
    }
  }

  return {
    filePath: path.relative(await fs.realpath(ws.root), path.join(dir, fileName)).split(path.sep).join('/'),
    fileName,
  };
}

/** Delete stored attachments; paths outside the attachments folder and already-missing files are skipped. */
export async function deleteAttachments(relPaths: string[]): Promise<{ deleted: number }> {
  const ws = await ensureWorkspace();
  let deleted = 0;
  for (const relPath of relPaths) {
    const absolute = await resolveAttachment(ws, relPath);
    if (!absolute) continue;
    try {
      await fs.unlink(absolute);
      deleted++;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return { deleted };
}

/** Workspace files referenced by an SSP's back-matter, keyed by their relative href; web links are skipped. */
export async function collectSspAttachments(
  ssp: OscalSsp,
): Promise<{ files: Array<{ href: string; absolute: string }>; missing: string[] }> {
  const ws = await ensureWorkspace();
  const hrefs = new Set<string>();
  for (const resource of ssp['system-security-plan']['back-matter']?.resources ?? []) {
    for (const rlink of resource.rlinks ?? []) {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(rlink.href) && !rlink.href.startsWith('#')) hrefs.add(rlink.href);
    }
  }

  const files: Array<{ href: string; absolute: string }> = [];
  const missing: string[] = [];
  for (const href of hrefs) {
    const resolved = await resolveAttachment(ws, href);
    if (!resolved) {
      missing.push(href);
      continue;
    }
    const absolute = path.resolve(ws.root, href);
    try {
      if ((await fs.stat(resolved)).isFile()) files.push({ href: path.relative(ws.root, absolute).split(path.sep).join('/'), absolute: resolved });
      else missing.push(href);
    } catch {
      missing.push(href);
    }
  }
  return { files, missing };
}

/** Absolute path of a stored attachment, or null when the path escapes the attachments folder. */
export async function resolveAttachmentPath(relPath: string): Promise<string | null> {
  return resolveAttachment(await ensureWorkspace(), relPath);
}
