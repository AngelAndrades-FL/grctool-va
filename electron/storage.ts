/** File-backed persistence for the workspace: catalog, OSCAL SSP, supplemental sidecar, settings, attachments. */
import { app } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AiProvider,
  AppSettings,
  Artifact,
  AttachmentRenameRequest,
  Catalog,
  EvidenceMap,
  EvidenceRecord,
  WorkspaceInfo,
} from '../shared/types.js';
import { DEFAULT_PROMPT_TEMPLATE } from '../shared/ai.js';
import {
  oscalToRecords,
  readAtoDates,
  recordsToOscal,
  type OscalSsp,
  type SupplementalFile,
} from '../shared/oscal.js';
import { buildArtifactFileName, buildAttachmentName, buildPoamFileName, familyOf } from '../shared/ids.js';

const DEFAULT_SETTINGS: AppSettings = {
  systemName: 'Unnamed System',
  systemId: 'system-001',
  organization: 'Department of Veterans Affairs',
  currentUser: '',
  baseline: 'Moderate',
  frameworkMode: 'va',
  lastAtoDate: null,
  nextAtoDate: null,
  evidenceStaleAfterDays: 365,
  recurringDueSoonDays: 30,
  cycleBasis: 'fiscal',
  fiscalYearStartMonth: 10,
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  promptVersion: 1,
  promptHistory: [],
  themeMode: 'light',
  ai: {
    provider: 'azure-openai',
    endpoint: '',
    deployment: '',
    apiVersion: '2024-10-21',
    clientId: '',
    tokenScope: '',
    cloud: 'commercial',
    tenantId: '',
    temperature: 0.2,
    maxOutputTokens: 4000,
    timeoutSeconds: 120,
    jsonMode: true,
    openaiModel: 'gpt-5.2',
    openaiService: 'openai',
    openaiOrganization: '',
    openaiBaseUrl: '',
  },
};

export function workspace(): WorkspaceInfo {
  const root = path.join(app.getPath('userData'), 'workspace');
  return {
    root,
    catalogPath: path.join(root, 'catalog', '800-53.json'),
    sspPath: path.join(root, 'oscal', 'system-security-plan.json'),
    supplementalPath: path.join(root, 'oscal', 'supplemental.json'),
    attachmentsDir: path.join(root, 'attachments'),
  };
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Write via a temp file + rename so a crash mid-write cannot corrupt the store. */
async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

let ensurePromise: Promise<WorkspaceInfo> | null = null;

/**
 * Seed the workspace on first launch, copying the bundled catalog in.
 * Memoised because several IPC handlers race to initialise on startup.
 */
export function ensureWorkspace(): Promise<WorkspaceInfo> {
  ensurePromise ??= initWorkspace();
  return ensurePromise;
}

function bundledCatalogFile(name: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'catalog', name)
    : path.join(app.getAppPath(), 'catalog', name);
}

async function initWorkspace(): Promise<WorkspaceInfo> {
  const ws = workspace();
  await fs.mkdir(path.join(ws.root, 'catalog'), { recursive: true });
  await fs.mkdir(path.join(ws.root, 'oscal'), { recursive: true });
  await fs.mkdir(ws.attachmentsDir, { recursive: true });

  try {
    await fs.access(ws.catalogPath);
  } catch {
    const bundled = bundledCatalogFile('800-53.json');
    const staging = `${ws.catalogPath}.seed`;
    await fs.copyFile(bundled, staging);
    await fs.rename(staging, ws.catalogPath);
  }
  return ws;
}

export async function loadCatalog(): Promise<Catalog> {
  const ws = await ensureWorkspace();
  const catalog = await readJson<Catalog>(ws.catalogPath);
  if (!catalog?.control_families?.length) {
    throw new Error(`Catalog missing or unreadable at ${ws.catalogPath}`);
  }
  // Read from the app bundle, not the workspace, so upgrades apply to existing workspaces.
  const guidance = await readJson<CsfGuidanceFile>(bundledCatalogFile('csf-guidance.json'));
  if (guidance) {
    for (const family of catalog.control_families) {
      for (const control of family.controls) {
        for (const item of [control, ...(control.control_enhancements ?? [])]) {
          const id = 'enhancement_id' in item ? item.enhancement_id : control.control_id;
          const entry = guidance.controls[id];
          if (!entry) continue;
          item.nist_800_53.control_statement_verbatim = entry.control_statement;
          item.nist_800_53.supplemental_guidance = entry.supplemental_guidance;
        }
      }
    }
  }
  return catalog;
}

interface CsfGuidanceFile {
  controls: Record<string, { control_statement: string; supplemental_guidance: string }>;
}

export async function loadSettings(): Promise<AppSettings> {
  const ws = await ensureWorkspace();
  const stored = await readJson<Partial<AppSettings>>(path.join(ws.root, 'settings.json'));
  const provider: AiProvider = stored?.ai?.provider === 'tanstack-openai' ? 'tanstack-openai' : 'azure-openai';
  const settings = { ...DEFAULT_SETTINGS, ...stored, ai: { ...DEFAULT_SETTINGS.ai, ...stored?.ai, provider } };
  // The SSP is authoritative for authorization dates.
  const ssp = await readJson<OscalSsp>(ws.sspPath);
  const ato = readAtoDates(ssp);
  if (ato.lastAtoDate) settings.lastAtoDate = ato.lastAtoDate;
  if (ato.nextAtoDate) settings.nextAtoDate = ato.nextAtoDate;
  return settings;
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const ws = await ensureWorkspace();
  await writeJson(path.join(ws.root, 'settings.json'), settings);
  // Mirror the authorization dates and system identity into the SSP.
  const existing = await readJson<OscalSsp>(ws.sspPath);
  if (existing) {
    const records = oscalToRecords(existing, await readJson<SupplementalFile>(ws.supplementalPath));
    const { ssp, supplemental } = recordsToOscal(records, settings, existing);
    await writeJson(ws.sspPath, ssp);
    await writeJson(ws.supplementalPath, supplemental);
  }
  return settings;
}

export async function loadEvidence(): Promise<EvidenceMap> {
  const ws = await ensureWorkspace();
  const ssp = await readJson<OscalSsp>(ws.sspPath);
  const supplemental = await readJson<SupplementalFile>(ws.supplementalPath);
  const records = oscalToRecords(ssp, supplemental);
  return Object.fromEntries(records.map((r) => [r.controlId, r]));
}

/** Upsert records, then rewrite both halves of the store. */
export async function saveEvidence(incoming: EvidenceRecord[]): Promise<{ savedAt: string }> {
  const ws = await ensureWorkspace();
  const settings = await loadSettings();
  const existingSsp = await readJson<OscalSsp>(ws.sspPath);
  const current = await loadEvidence();

  for (const rec of incoming) current[rec.controlId] = rec;

  const merged = Object.values(current).sort((a, b) => a.controlId.localeCompare(b.controlId));
  const { ssp, supplemental } = recordsToOscal(merged, settings, existingSsp ?? undefined);
  await writeJson(ws.sspPath, ssp);
  await writeJson(ws.supplementalPath, supplemental);
  return { savedAt: new Date().toISOString() };
}

export async function deleteEvidence(controlId: string): Promise<void> {
  const ws = await ensureWorkspace();
  const settings = await loadSettings();
  const current = await loadEvidence();
  delete current[controlId];
  const { ssp, supplemental } = recordsToOscal(Object.values(current), settings);
  await writeJson(ws.sspPath, ssp);
  await writeJson(ws.supplementalPath, supplemental);
}

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
    mimeType: MIME_BY_EXT[path.extname(originalName).toLowerCase()] ?? 'application/octet-stream',
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** Returns a data URL so the renderer can preview an attachment under a strict CSP. */
export async function readAttachment(relPath: string): Promise<string | null> {
  const ws = await ensureWorkspace();
  const absolute = path.resolve(ws.root, relPath);
  if (!absolute.startsWith(path.resolve(ws.root))) return null; // no path traversal
  try {
    const bytes = await fs.readFile(absolute);
    const mime = MIME_BY_EXT[path.extname(absolute).toLowerCase()] ?? 'application/octet-stream';
    return `data:${mime};base64,${bytes.toString('base64')}`;
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
  const attachmentsRoot = path.resolve(ws.attachmentsDir);
  const current = path.resolve(ws.root, req.filePath);
  const rel = path.relative(attachmentsRoot, current);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Attachment is outside the workspace attachments folder.');

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
    filePath: path.relative(ws.root, path.join(dir, fileName)).split(path.sep).join('/'),
    fileName,
  };
}

/** Delete stored attachments; paths outside the attachments folder and already-missing files are skipped. */
export async function deleteAttachments(relPaths: string[]): Promise<{ deleted: number }> {
  const ws = await ensureWorkspace();
  const attachmentsRoot = path.resolve(ws.attachmentsDir);
  let deleted = 0;
  for (const relPath of relPaths) {
    const absolute = path.resolve(ws.root, relPath);
    const rel = path.relative(attachmentsRoot, absolute);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
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
  const attachmentsRoot = path.resolve(ws.attachmentsDir);
  const hrefs = new Set<string>();
  for (const resource of ssp['system-security-plan']['back-matter']?.resources ?? []) {
    for (const rlink of resource.rlinks ?? []) {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(rlink.href) && !rlink.href.startsWith('#')) hrefs.add(rlink.href);
    }
  }

  const files: Array<{ href: string; absolute: string }> = [];
  const missing: string[] = [];
  for (const href of hrefs) {
    const absolute = path.resolve(ws.root, href);
    const rel = path.relative(attachmentsRoot, absolute);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      missing.push(href);
      continue;
    }
    try {
      if ((await fs.stat(absolute)).isFile()) files.push({ href: path.relative(ws.root, absolute).split(path.sep).join('/'), absolute });
      else missing.push(href);
    } catch {
      missing.push(href);
    }
  }
  return { files, missing };
}

export function resolveInWorkspace(relPath: string): string | null {
  const ws = workspace();
  const absolute = path.resolve(ws.root, relPath);
  return absolute.startsWith(path.resolve(ws.root)) ? absolute : null;
}

export async function readRawSsp(): Promise<OscalSsp | null> {
  const ws = await ensureWorkspace();
  return readJson<OscalSsp>(ws.sspPath);
}

export async function replaceEvidence(records: EvidenceRecord[]): Promise<void> {
  const ws = await ensureWorkspace();
  const settings = await loadSettings();
  const { ssp, supplemental } = recordsToOscal(records, settings);
  await writeJson(ws.sspPath, ssp);
  await writeJson(ws.supplementalPath, supplemental);
}
