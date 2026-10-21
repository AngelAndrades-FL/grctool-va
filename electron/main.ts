import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type {
  AiEvaluateRequest,
  AiOdpSuggestRequest,
  AiRelatedDraftRequest,
  AiReviseRequest,
  AiSettings,
  AttachmentResult,
  FileActionResult,
  OscalImportResult,
  OscalPackageResult,
  ScriptRunResult,
  SopExportRequest,
  SopExportResult,
  WorkspaceInfo,
} from '../shared/types.js';
import { draftFromRelated, evaluate, revise } from '../shared/ai.js';
import { OSCAL_VERSION, type OscalSsp } from '../shared/oscal.js';
import { migrateSsp, sspToImportControls } from '../shared/oscalImport.js';
import { writeZip } from './zip.js';
import * as tanstackAi from './tanstackAiClient.js';
import * as store from './storage.js';
import * as attachments from './attachments.js';
import { runScript } from './scripts.js';
import { writeSopDocument } from './sopExport.js';
import * as check from './validate.js';
import { registerAttachmentProtocol, registerAttachmentScheme } from './attachmentProtocol.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(dirname, '..');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1680,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#fafafa',
    title: 'GRC Evidence Workspace',
    webPreferences: {
      preload: path.join(dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  // Surface renderer-side failures in the terminal during development.
  win.webContents.on('console-message', (event) => {
    console.log(`[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });
  win.webContents.on('did-fail-load', (_e, code, description) => {
    console.error(`[renderer] failed to load: ${description} (${code})`);
  });
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error(`[preload] ${preloadPath}:`, error);
  });

  // External links open in the user's browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });

  // The renderer must never navigate away from the bundled app.
  const appOrigin = DEV_SERVER_URL ? new URL(DEV_SERVER_URL).origin : 'file://';
  win.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    const sameApp = DEV_SERVER_URL ? target.origin === appOrigin : target.protocol === 'file:';
    if (sameApp) return;
    event.preventDefault();
    openExternalSafely(url);
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

/** Only web and mail links leave the app; file:, smb: and custom schemes are refused. */
function openExternalSafely(url: string): void {
  try {
    if (EXTERNAL_PROTOCOLS.has(new URL(url).protocol)) void shell.openExternal(url);
  } catch {
    /* malformed URL */
  }
}

/** Largest script the confirmation dialog can show in full; anything longer cannot be reviewed before running. */
const MAX_REVIEWABLE_SCRIPT_CHARS = 8000;

/** Only the app's own top-level page may call privileged handlers. */
function isTrustedSender(frame: Electron.WebFrameMain | null): boolean {
  if (!frame || !win || frame !== win.webContents.mainFrame) return false;
  try {
    const url = new URL(frame.url);
    if (DEV_SERVER_URL) return url.origin === new URL(DEV_SERVER_URL).origin;
    return url.protocol === 'file:' && path.resolve(fileURLToPath(url)) === path.join(RENDERER_DIST, 'index.html');
  } catch {
    return false;
  }
}

function handle<TArgs extends unknown[], TResult>(
  channel: string,
  fn: (...args: TArgs) => Promise<TResult> | TResult,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event.senderFrame)) throw new Error(`Blocked IPC call from an untrusted sender (${channel}).`);
    return fn(...(args as TArgs));
  });
}

function registerHandlers(): void {
  handle('workspace:get', () => store.ensureWorkspace());
  handle('workspace:open', async () => {
    const ws = await store.ensureWorkspace();
    await shell.openPath(ws.root);
  });

  handle('catalog:load', () => store.loadCatalog());

  handle('evidence:load', () => store.loadEvidence());
  handle('evidence:save', (records: unknown) => store.saveEvidence(check.evidenceRecords(records)));
  handle('evidence:delete', async (id: unknown) => {
    await store.deleteEvidence(check.controlId(id));
    return { ok: true as const };
  });

  handle('settings:load', () => store.loadSettings());
  handle('settings:save', (settings: unknown) => store.saveSettings(check.settings(settings)));

  handle('attachments:add', async (input: unknown): Promise<AttachmentResult> => {
    const req = check.attachmentRequest(input);
    if (!win) return { cancelled: true, artifacts: [] };
    const result = await dialog.showOpenDialog(win, {
      title: `Attach evidence for ${req.controlId}`,
      properties: req.single ? ['openFile'] : ['openFile', 'multiSelections'],
      filters: [
        { name: 'Evidence', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'docx', 'xlsx', 'csv', 'txt', 'md', 'json'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true, artifacts: [] };
    const artifacts = await Promise.all(
      result.filePaths.map((p) => attachments.importAttachment(p, req.controlId)),
    );
    return { cancelled: false, artifacts };
  });

  handle('attachments:rename', (req: unknown) => attachments.renameAttachment(check.renameRequest(req)));
  handle('attachments:delete', (relPaths: unknown) => attachments.deleteAttachments(check.relPaths(relPaths)));

  // Confirmed in the main process; a string supplied by the renderer cannot authorise a wipe.
  handle('data:wipe', async () => {
    if (!win) throw new Error('Deletion was not confirmed.');
    const confirmation = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Delete all data', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Delete all control data',
      message: 'Permanently delete every control record and attachment?',
      detail: 'Settings, roles and the catalog are kept. This cannot be undone.',
      noLink: true,
    });
    if (confirmation.response !== 0) throw new Error('Deletion was not confirmed.');
    return store.wipeControlData();
  });
  handle('attachments:reveal', async (relPath: unknown) => {
    const absolute = await attachments.resolveAttachmentPath(check.relPath(relPath));
    if (absolute) shell.showItemInFolder(absolute);
  });

  handle('scripts:run', async (input: unknown): Promise<ScriptRunResult> => {
    const req = check.scriptRequest(input);
    const blank: ScriptRunResult = {
      cancelled: true,
      ok: false,
      exitCode: -1,
      durationMs: 0,
      ranAt: new Date().toISOString(),
      host: os.hostname(),
      stdout: '',
      stderr: '',
      timedOut: false,
    };
    if (!win) return blank;

    // Executing a script is irreversible, so it is always confirmed out-of-band
    // from the renderer rather than trusting the UI alone.
    if (req.script.length > MAX_REVIEWABLE_SCRIPT_CHARS) {
      return {
        ...blank,
        cancelled: false,
        error: `Scripts longer than ${MAX_REVIEWABLE_SCRIPT_CHARS} characters cannot be reviewed in the confirmation dialog. Split the script into smaller ones.`,
      };
    }
    const preview = req.script;
    const confirmation = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Run script', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Run evidence collection script',
      message: `Run this PowerShell script to collect evidence for ${req.controlId}?`,
      detail: `It runs with your account's privileges on this machine.\n\n${preview}`,
      noLink: true,
    });
    if (confirmation.response !== 0) return blank;

    return runScript(req);
  });

  handle('ai:evaluate', async (req: AiEvaluateRequest) => {
    const settings = await store.loadSettings();
    if (settings.ai.provider === 'tanstack-openai') {
      return tanstackAi.evaluateWithOpenai(req, settings.ai, settings.promptTemplate, settings.promptVersion);
    }
    // Simulated model latency so the UI's pending states are exercised.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return evaluate(req, settings.promptTemplate, settings.promptVersion);
  });

  handle('ai:revise', async (req: AiReviseRequest) => {
    const settings = await store.loadSettings();
    if (settings.ai.provider === 'tanstack-openai') return tanstackAi.reviseWithOpenai(req, settings.ai);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return revise(req);
  });

  handle('ai:relatedDraft', async (input: AiRelatedDraftRequest) => {
    const settings = await store.loadSettings();
    const req = { ...input, maxNarrativeChars: settings.ai.relatedNarrativeMaxChars };
    if (settings.ai.provider === 'tanstack-openai') return tanstackAi.relatedDraftWithOpenai(req, settings.ai);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return draftFromRelated(req);
  });

  handle('ai:suggestOdp', async (req: AiOdpSuggestRequest) => {
    const settings = await store.loadSettings();
    if (settings.ai.provider === 'tanstack-openai') return tanstackAi.suggestOdpWithOpenai(req, settings.ai);
    return { suggestions: [] };
  });

  handle('ai:test', (ai: AiSettings) => tanstackAi.testConnection(ai));
  handle('ai:setApiKey', (apiKey: string) => tanstackAi.setApiKey(apiKey));
  handle('ai:clearApiKey', () => tanstackAi.clearApiKey());
  handle('ai:hasApiKey', () => tanstackAi.hasApiKey());

  handle('export:file', async (input: unknown) => {
    const req = check.exportRequest(input);
    if (!win) return { cancelled: true };
    const result = await dialog.showSaveDialog(win, {
      title: 'Export',
      defaultPath: req.suggestedName,
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    await fs.writeFile(result.filePath, req.contents, 'utf8');
    return { cancelled: false, path: result.filePath };
  });

  handle('export:oscalPackage', async (input: unknown): Promise<OscalPackageResult> => {
    const req = check.oscalPackageRequest(input);
    if (!win) return { cancelled: true };
    const result = await dialog.showSaveDialog(win, {
      title: 'Export OSCAL SSP package',
      defaultPath: req.suggestedName,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };

    const ssp = JSON.parse(req.sspJson) as OscalSsp;
    const { files, missing } = await attachments.collectSspAttachments(ssp);
    await writeZip(result.filePath, [
      { name: path.basename(req.sspFileName), data: Buffer.from(req.sspJson, 'utf8') },
      ...files.map((f) => ({ name: f.href, path: f.absolute })),
    ]);
    return { cancelled: false, path: result.filePath, fileCount: files.length, missing };
  });

  handle('export:sopWord', async (req: SopExportRequest): Promise<SopExportResult> => {
    if (!win) return { cancelled: true };
    const settings = await store.loadSettings();
    const result = await dialog.showSaveDialog(win, {
      title: 'Export POM',
      defaultPath: `${settings.systemId || 'system'}-pom.docx`,
      filters: [{ name: 'Word document', extensions: ['docx'] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    await writeSopDocument(req, result.filePath);
    return { cancelled: false, path: result.filePath, familyCount: req.families.length };
  });

  handle('config:backup', async (): Promise<FileActionResult> => {
    if (!win) return { cancelled: true };
    const result = await dialog.showSaveDialog(win, {
      title: 'Back up config file',
      defaultPath: 'grctool-settings.json',
      filters: [{ name: 'JSON config', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    await store.backupConfig(result.filePath);
    return { cancelled: false, path: result.filePath };
  });

  handle('config:restore', async (): Promise<FileActionResult> => {
    if (!win) return { cancelled: true };
    const result = await dialog.showOpenDialog(win, {
      title: 'Restore config file',
      properties: ['openFile'],
      filters: [{ name: 'JSON config', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    await store.restoreConfig(result.filePaths[0]);
    return { cancelled: false, path: result.filePaths[0] };
  });

  handle('db:backup', async (): Promise<FileActionResult> => {
    if (!win) return { cancelled: true };
    const result = await dialog.showSaveDialog(win, {
      title: 'Back up SQLite database',
      defaultPath: 'grctool-backup.db',
      filters: [{ name: 'SQLite database', extensions: ['db', 'sqlite'] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    await store.backupDatabase(result.filePath);
    return { cancelled: false, path: result.filePath };
  });

  handle('db:restore', async (): Promise<FileActionResult> => {
    if (!win) return { cancelled: true };
    const result = await dialog.showOpenDialog(win, {
      title: 'Restore SQLite database',
      properties: ['openFile'],
      filters: [{ name: 'SQLite database', extensions: ['db', 'sqlite'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    const confirmation = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Restore', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Restore database',
      message: 'Replace the current database with this backup?',
      detail: 'All evidence currently in the workspace database will be overwritten.',
      noLink: true,
    });
    if (confirmation.response !== 0) return { cancelled: true };
    await store.restoreDatabase(result.filePaths[0]);
    return { cancelled: false, path: result.filePaths[0] };
  });

  handle('workspace:choose', async (): Promise<WorkspaceInfo | null> => {
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose workspace folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return store.setWorkspaceRoot(result.filePaths[0]);
  });
  handle('workspace:reset', () => store.setWorkspaceRoot(null));

  handle('import:oscal', async (): Promise<OscalImportResult> => {
    if (!win) return { cancelled: true };
    const result = await dialog.showOpenDialog(win, {
      title: 'Import ServiceNow OSCAL SSP',
      properties: ['openFile'],
      filters: [{ name: 'OSCAL SSP (JSON)', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'));
    } catch {
      throw new Error('The file is not valid JSON. Export the SSP from ServiceNow in OSCAL JSON format.');
    }
    const { ssp, sourceVersion, notes } = migrateSsp(raw);
    const mapped = sspToImportControls(ssp);
    return {
      cancelled: false,
      fileName: path.basename(result.filePaths[0]),
      sourceVersion,
      targetVersion: OSCAL_VERSION,
      systemName: ssp['system-security-plan']['system-characteristics']?.['system-name'],
      controls: mapped.controls,
      notes: [...notes, ...mapped.notes],
    };
  });
}

registerAttachmentScheme();

app.whenReady().then(() => {
  registerAttachmentProtocol();
  registerHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
