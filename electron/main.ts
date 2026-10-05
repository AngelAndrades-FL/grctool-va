import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type {
  AiEvaluateRequest,
  AiRelatedDraftRequest,
  AiReviseRequest,
  AiSettings,
  AppSettings,
  AttachmentRenameRequest,
  AttachmentRequest,
  AttachmentResult,
  EvidenceMap,
  EvidenceRecord,
  ExportRequest,
  OscalImportResult,
  OscalPackageRequest,
  OscalPackageResult,
  ScriptRunRequest,
  ScriptRunResult,
} from '../shared/types.js';
import { draftFromRelated, evaluate, revise } from '../shared/ai.js';
import { OSCAL_VERSION, type OscalSsp } from '../shared/oscal.js';
import { migrateSsp, sspToImportControls } from '../shared/oscalImport.js';
import { writeZip } from './zip.js';
import * as aiClient from './aiClient.js';
import * as tanstackAi from './tanstackAiClient.js';
import * as store from './storage.js';
import { runScript } from './scripts.js';

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
      sandbox: false,
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
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function handle<TArgs extends unknown[], TResult>(
  channel: string,
  fn: (...args: TArgs) => Promise<TResult> | TResult,
): void {
  ipcMain.handle(channel, async (_event, ...args) => fn(...(args as TArgs)));
}

function registerHandlers(): void {
  handle('workspace:get', () => store.ensureWorkspace());
  handle('workspace:open', async () => {
    const ws = await store.ensureWorkspace();
    await shell.openPath(ws.root);
  });

  handle('catalog:load', () => store.loadCatalog());

  handle('evidence:load', () => store.loadEvidence());
  handle('evidence:save', (records: EvidenceRecord[]) => store.saveEvidence(records));
  handle('evidence:delete', async (controlId: string) => {
    await store.deleteEvidence(controlId);
    return { ok: true as const };
  });

  handle('settings:load', () => store.loadSettings());
  handle('settings:save', (settings: AppSettings) => store.saveSettings(settings));

  handle('attachments:add', async (req: AttachmentRequest): Promise<AttachmentResult> => {
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
      result.filePaths.map((p) => store.importAttachment(p, req.controlId)),
    );
    return { cancelled: false, artifacts };
  });

  handle('attachments:read', (relPath: string) => store.readAttachment(relPath));
  handle('attachments:rename', (req: AttachmentRenameRequest) => store.renameAttachment(req));
  handle('attachments:delete', (relPaths: string[]) => store.deleteAttachments(relPaths));
  handle('attachments:reveal', async (relPath: string) => {
    const absolute = store.resolveInWorkspace(relPath);
    if (absolute) shell.showItemInFolder(absolute);
  });

  handle('scripts:run', async (req: ScriptRunRequest): Promise<ScriptRunResult> => {
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
    const preview = req.script.length > 1200 ? `${req.script.slice(0, 1200)}\n…` : req.script;
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
    if (settings.ai.provider === 'azure-openai') {
      return aiClient.evaluateWithAzure(req, settings.ai, settings.promptTemplate, settings.promptVersion);
    }
    if (settings.ai.provider === 'tanstack-openai') {
      return tanstackAi.evaluateWithOpenai(req, settings.ai, settings.promptTemplate, settings.promptVersion);
    }
    // Simulated model latency so the UI's pending states are exercised.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return evaluate(req, settings.promptTemplate, settings.promptVersion);
  });

  handle('ai:revise', async (req: AiReviseRequest) => {
    const settings = await store.loadSettings();
    if (settings.ai.provider === 'azure-openai') return aiClient.reviseWithAzure(req, settings.ai);
    if (settings.ai.provider === 'tanstack-openai') return tanstackAi.reviseWithOpenai(req, settings.ai);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return revise(req);
  });

  handle('ai:relatedDraft', async (req: AiRelatedDraftRequest) => {
    const settings = await store.loadSettings();
    if (settings.ai.provider === 'azure-openai') return aiClient.relatedDraftWithAzure(req, settings.ai);
    if (settings.ai.provider === 'tanstack-openai') return tanstackAi.relatedDraftWithOpenai(req, settings.ai);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return draftFromRelated(req);
  });

  handle('ai:test', (ai: AiSettings) =>
    ai.provider === 'tanstack-openai' ? tanstackAi.testConnection(ai) : aiClient.testConnection(ai),
  );
  handle('ai:signOut', () => aiClient.signOut());
  handle('ai:signIn', (ai: AiSettings) => aiClient.signIn(ai));
  handle('ai:signedInAccount', (ai: AiSettings) => aiClient.signedInAccount(ai));
  handle('ai:setApiKey', (apiKey: string) => tanstackAi.setApiKey(apiKey));
  handle('ai:clearApiKey', () => tanstackAi.clearApiKey());
  handle('ai:hasApiKey', () => tanstackAi.hasApiKey());

  handle('export:file', async (req: ExportRequest) => {
    if (!win) return { cancelled: true };
    const result = await dialog.showSaveDialog(win, {
      title: 'Export',
      defaultPath: req.suggestedName,
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    await fs.writeFile(result.filePath, req.contents, 'utf8');
    return { cancelled: false, path: result.filePath };
  });

  handle('export:oscalPackage', async (req: OscalPackageRequest): Promise<OscalPackageResult> => {
    if (!win) return { cancelled: true };
    const result = await dialog.showSaveDialog(win, {
      title: 'Export OSCAL SSP package',
      defaultPath: req.suggestedName,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };

    const ssp = JSON.parse(req.sspJson) as OscalSsp;
    const { files, missing } = await store.collectSspAttachments(ssp);
    await writeZip(result.filePath, [
      { name: path.basename(req.sspFileName), data: Buffer.from(req.sspJson, 'utf8') },
      ...files.map((f) => ({ name: f.href, path: f.absolute })),
    ]);
    return { cancelled: false, path: result.filePath, fileCount: files.length, missing };
  });

  handle('import:backup', async (): Promise<{ cancelled: boolean; evidence?: EvidenceMap }> => {
    if (!win) return { cancelled: true };
    const result = await dialog.showOpenDialog(win, {
      title: 'Import evidence backup',
      properties: ['openFile'],
      filters: [{ name: 'JSON backup', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    const raw: unknown = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'));
    const wrapper = raw as { records?: EvidenceMap };
    const evidence = wrapper.records ?? (raw as EvidenceMap);
    return { cancelled: false, evidence };
  });

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

app.whenReady().then(() => {
  registerHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
