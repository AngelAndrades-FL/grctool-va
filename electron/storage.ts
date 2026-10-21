/** Workspace persistence: SQLite for the OSCAL SSP + supplemental data, a JSON config file for settings, files for attachments. */
import { app } from 'electron';
import Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  AiProvider,
  AppSettings,
  AzureOwnership,
  AzurePolicyRef,
  Catalog,
  EvidenceMap,
  EvidenceRecord,
  WorkspaceInfo,
} from '../shared/types.js';
import { DEFAULT_PROMPT_TEMPLATE } from '../shared/ai.js';
import { LEGACY_COMMON_CONTROL_PROVIDER, defaultResponsibleRoles } from '../shared/roles.js';
import {
  oscalToRecords,
  readAtoDates,
  recordsToOscal,
  type OscalSsp,
  type SupplementalFile,
} from '../shared/oscal.js';

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
  responsibleRoles: defaultResponsibleRoles(),
  ai: {
    provider: 'tanstack-openai',
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
    relatedNarrativeMaxChars: 12000,
    jsonMode: true,
    openaiModel: 'gpt-5.2',
    openaiService: 'azure',
    openaiOrganization: '',
    openaiBaseUrl: '',
  },
};

/** Fixed-location pointer to the workspace folder; the workspace itself can't hold it. */
function locationFile(): string {
  return path.join(app.getPath('userData'), 'workspace-location.json');
}

function defaultRoot(): string {
  return path.join(app.getPath('userData'), 'workspace');
}

let rootOverride: string | null | undefined;

function currentRoot(): string {
  if (rootOverride === undefined) {
    try {
      const stored = (JSON.parse(readFileSync(locationFile(), 'utf8')) as { root?: unknown }).root;
      rootOverride = typeof stored === 'string' && path.isAbsolute(stored) ? stored : null;
    } catch {
      rootOverride = null;
    }
  }
  return rootOverride ?? defaultRoot();
}

export function workspace(): WorkspaceInfo {
  const root = currentRoot();
  return {
    root,
    defaultRoot: defaultRoot(),
    dbPath: path.join(root, 'grctool.db'),
    settingsPath: path.join(root, 'settings.json'),
    attachmentsDir: path.join(root, 'attachments'),
  };
}

let db: Database.Database | null = null;

function openDb(file: string): Database.Database {
  const handle = new Database(file);
  handle.exec('CREATE TABLE IF NOT EXISTS documents (name TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL)');
  return handle;
}

async function database(): Promise<Database.Database> {
  await ensureWorkspace();
  return db!;
}

function readDoc<T>(handle: Database.Database, name: string): T | null {
  const row = handle.prepare('SELECT json FROM documents WHERE name = ?').get(name) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as T) : null;
}

/** Write several documents atomically. */
function writeDocs(handle: Database.Database, docs: Record<string, unknown>): void {
  const upsert = handle.prepare(
    'INSERT INTO documents (name, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at',
  );
  const now = new Date().toISOString();
  handle.transaction(() => {
    for (const [name, value] of Object.entries(docs)) upsert.run(name, JSON.stringify(value), now);
  })();
}

const SSP_DOC = 'ssp';
const SUPPLEMENTAL_DOC = 'supplemental';

let displayNamePromise: Promise<string> | null = null;

function runForOutput(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 8000, windowsHide: true }, (err, stdout) => resolve(err ? '' : stdout.trim()));
  });
}

/** The signed-in OS user's full name, falling back to the login name. */
function currentUserName(): Promise<string> {
  displayNamePromise ??= (async () => {
    const login = os.userInfo().username;
    let full = '';
    if (process.platform === 'win32') {
      // UserPrincipal reads the AD display name for domain accounts and the full name for local ones.
      full = await runForOutput('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -AssemblyName System.DirectoryServices.AccountManagement; [System.DirectoryServices.AccountManagement.UserPrincipal]::Current.DisplayName',
      ]);
    } else if (process.platform === 'darwin') {
      full = await runForOutput('id', ['-F']);
    } else {
      full = (await runForOutput('getent', ['passwd', login])).split(':')[4]?.split(',')[0] ?? '';
    }
    return full || login;
  })();
  return displayNamePromise;
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

export function bundledCatalogFile(name: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'catalog', name)
    : path.join(app.getAppPath(), 'catalog', name);
}

async function initWorkspace(): Promise<WorkspaceInfo> {
  const ws = workspace();
  await fs.mkdir(ws.attachmentsDir, { recursive: true });
  db = openDb(ws.dbPath);
  return ws;
}

function closeWorkspace(): void {
  db?.close();
  db = null;
  ensurePromise = null;
}

/** Point the app at a different workspace folder (null restores the default). Existing data is not moved. */
export async function setWorkspaceRoot(root: string | null): Promise<WorkspaceInfo> {
  if (root !== null && !path.isAbsolute(root)) throw new Error('The workspace location must be an absolute path.');
  if (root !== null) await fs.mkdir(root, { recursive: true });
  await writeJson(locationFile(), { root });
  closeWorkspace();
  rootOverride = root;
  return ensureWorkspace();
}

export async function backupDatabase(dest: string): Promise<void> {
  await (await database()).backup(dest);
}

/** Replace the workspace database with a backup file after checking that it is one of ours. */
export async function restoreDatabase(src: string): Promise<void> {
  const probe = new Database(src, { readonly: true, fileMustExist: true });
  try {
    const ok = probe.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'documents'").get();
    if (!ok) throw new Error('That file is not a GRC workspace database.');
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('That file')) throw err;
    throw new Error('That file is not a valid SQLite database.');
  } finally {
    probe.close();
  }
  const ws = workspace();
  closeWorkspace();
  await fs.copyFile(src, ws.dbPath);
  await ensureWorkspace();
}

export async function backupConfig(dest: string): Promise<void> {
  const ws = await ensureWorkspace();
  try {
    await fs.access(ws.settingsPath);
  } catch {
    await writeJson(ws.settingsPath, await loadSettings());
  }
  await fs.copyFile(ws.settingsPath, dest);
}

export async function restoreConfig(src: string): Promise<AppSettings> {
  const ws = await ensureWorkspace();
  const parsed = await readJson<Partial<AppSettings>>(src);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.systemName !== 'string') {
    throw new Error('That file is not a GRC settings file.');
  }
  await writeJson(ws.settingsPath, parsed);
  return loadSettings();
}

let catalogPromise: Promise<Catalog> | null = null;

/** The bundled catalog is immutable at runtime, so it is read and merged once. */
export function loadCatalog(): Promise<Catalog> {
  catalogPromise ??= readCatalog().catch((error: unknown) => {
    catalogPromise = null;
    throw error;
  });
  return catalogPromise;
}

async function readCatalog(): Promise<Catalog> {
  const bundled = bundledCatalogFile('800-53.json');
  const catalog = await readJson<Catalog>(bundled);
  if (!catalog?.control_families?.length) {
    throw new Error(`Catalog missing or unreadable at ${bundled}`);
  }
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
  const azure = await readJson<AzureOverlayFile>(bundledCatalogFile('azure-overlay.json'));
  if (azure) {
    for (const family of catalog.control_families) {
      for (const control of family.controls) {
        for (const item of [control, ...(control.control_enhancements ?? [])]) {
          const id = 'enhancement_id' in item ? item.enhancement_id : control.control_id;
          const entry = azure.controls[id];
          if (!entry) continue;
          item.azure_overlay = {
            ownership: entry.ownership,
            policies: entry.policies.flatMap((key) => {
              const policy = azure.policies[key];
              return policy ? [{ ...policy, id: key }] : [];
            }),
          };
        }
      }
    }
  }
  return catalog;
}

interface AzureOverlayFile {
  controls: Record<string, { ownership: AzureOwnership; policies: string[] }>;
  policies: Record<string, Omit<AzurePolicyRef, 'id'>>;
}

interface CsfGuidanceFile {
  controls: Record<string, { control_statement: string; supplemental_guidance: string }>;
}

export async function loadSettings(): Promise<AppSettings> {
  const ws = await ensureWorkspace();
  const handle = db!;
  const { roleContacts: legacyContacts, ...stored } =
    (await readJson<Partial<AppSettings> & { roleContacts?: Record<string, { name: string; email: string }> }>(
      ws.settingsPath,
    )) ?? {};
  const provider: AiProvider = 'tanstack-openai';
  // Entra sign-in was removed; settings saved with it fall back to Azure OpenAI with an API key.
  const openaiService = stored?.ai?.provider === 'tanstack-openai' ? stored.ai.openaiService : 'azure';
  const settings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    ai: { ...DEFAULT_SETTINGS.ai, ...stored?.ai, provider, ...(openaiService ? { openaiService } : {}) },
    // Settings saved before roles were editable kept one contact per role id; the old single
    // Common Control Provider contact is applied to each per-family role.
    responsibleRoles:
      stored.responsibleRoles ??
      defaultResponsibleRoles().map((role) => {
        const contact =
          legacyContacts?.[role.id] ??
          (role.id.endsWith(`-${LEGACY_COMMON_CONTROL_PROVIDER}`) ? legacyContacts?.[LEGACY_COMMON_CONTROL_PROVIDER] : undefined);
        return contact ? { ...role, name: contact.name, email: contact.email } : role;
      }),
  };
  // The SSP is authoritative for authorization dates.
  const ssp = readDoc<OscalSsp>(handle, SSP_DOC);
  const ato = readAtoDates(ssp);
  if (!settings.currentUser.trim()) settings.currentUser = await currentUserName();
  if (ato.lastAtoDate) settings.lastAtoDate = ato.lastAtoDate;
  if (ato.nextAtoDate) settings.nextAtoDate = ato.nextAtoDate;
  return settings;
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const ws = await ensureWorkspace();
  await writeJson(ws.settingsPath, settings);
  // Mirror the authorization dates and system identity into the SSP.
  const handle = db!;
  const existing = readDoc<OscalSsp>(handle, SSP_DOC);
  if (existing) {
    const records = oscalToRecords(existing, readDoc<SupplementalFile>(handle, SUPPLEMENTAL_DOC));
    const { ssp, supplemental } = recordsToOscal(records, settings, existing);
    writeDocs(handle, { [SSP_DOC]: ssp, [SUPPLEMENTAL_DOC]: supplemental });
  }
  return settings;
}

export async function loadEvidence(): Promise<EvidenceMap> {
  const handle = await database();
  const ssp = readDoc<OscalSsp>(handle, SSP_DOC);
  const supplemental = readDoc<SupplementalFile>(handle, SUPPLEMENTAL_DOC);
  const records = oscalToRecords(ssp, supplemental);
  return Object.fromEntries(records.map((r) => [r.controlId, r]));
}

/** Upsert records, then rewrite both halves of the store. */
export async function saveEvidence(incoming: EvidenceRecord[]): Promise<{ savedAt: string }> {
  const handle = await database();
  const settings = await loadSettings();
  const existingSsp = readDoc<OscalSsp>(handle, SSP_DOC);
  const current = await loadEvidence();

  for (const rec of incoming) current[rec.controlId] = rec;

  const merged = Object.values(current).sort((a, b) => a.controlId.localeCompare(b.controlId));
  const { ssp, supplemental } = recordsToOscal(merged, settings, existingSsp ?? undefined);
  writeDocs(handle, { [SSP_DOC]: ssp, [SUPPLEMENTAL_DOC]: supplemental });
  return { savedAt: new Date().toISOString() };
}

export async function deleteEvidence(controlId: string): Promise<void> {
  const handle = await database();
  const settings = await loadSettings();
  const current = await loadEvidence();
  delete current[controlId];
  const { ssp, supplemental } = recordsToOscal(Object.values(current), settings);
  writeDocs(handle, { [SSP_DOC]: ssp, [SUPPLEMENTAL_DOC]: supplemental });
}

export async function readRawSsp(): Promise<OscalSsp | null> {
  return readDoc<OscalSsp>(await database(), SSP_DOC);
}

async function countFiles(dir: string): Promise<number> {
  let count = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    count += entry.isDirectory() ? await countFiles(path.join(dir, entry.name)) : 1;
  }
  return count;
}

/** Delete every attachment file and every control record; settings, roles and the catalog are kept. */
export async function wipeControlData(): Promise<{ recordsDeleted: number; filesDeleted: number }> {
  const ws = await ensureWorkspace();
  const handle = await database();
  const attachmentsRoot = path.resolve(ws.attachmentsDir);
  if (path.basename(attachmentsRoot) !== 'attachments' || path.dirname(attachmentsRoot) !== path.resolve(ws.root)) {
    throw new Error('The attachments folder is not where it was expected, so nothing was deleted.');
  }

  const recordsDeleted = Object.keys(await loadEvidence()).length;
  const filesDeleted = await countFiles(attachmentsRoot);
  await fs.rm(attachmentsRoot, { recursive: true, force: true });
  await fs.mkdir(attachmentsRoot, { recursive: true });
  handle.prepare('DELETE FROM documents WHERE name IN (?, ?)').run(SSP_DOC, SUPPLEMENTAL_DOC);
  return { recordsDeleted, filesDeleted };
}

export async function replaceEvidence(records: EvidenceRecord[]): Promise<void> {
  const handle = await database();
  const settings = await loadSettings();
  const { ssp, supplemental } = recordsToOscal(records, settings);
  writeDocs(handle, { [SSP_DOC]: ssp, [SUPPLEMENTAL_DOC]: supplemental });
}
