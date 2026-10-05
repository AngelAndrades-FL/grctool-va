/**
 * Runs a user-authored PowerShell collection script and captures its output as an
 * evidence file in the workspace.
 *
 * The script is written to a private temp file and executed directly (never through a
 * shell), with no profile, no interactive prompts, a hard timeout and capped output.
 * The script is arbitrary code by design, so `main.ts` asks the user to confirm each
 * run before this module is reached.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ScriptRunRequest, ScriptRunResult } from '../shared/types.js';
import { slugifyFileName } from '../shared/ids.js';
import { writeAttachment } from './storage.js';

const MAX_SCRIPT_CHARS = 200_000;
const MAX_CAPTURED_BYTES = 8 * 1024 * 1024;
/** Enough for an assessor to read the run log without blowing up the renderer. */
const MAX_DISPLAYED_CHARS = 20_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 10 * 60_000;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']);

function candidateHosts(): string[] {
  return process.platform === 'win32' ? ['pwsh.exe', 'powershell.exe'] : ['pwsh'];
}

interface RunOutcome {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  spawnError?: NodeJS.ErrnoException;
}

function runHost(
  exe: string,
  scriptPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const child = spawn(
      exe,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const collect = (target: Buffer[], counter: 'out' | 'err') => (chunk: Buffer) => {
      const used = counter === 'out' ? stdoutBytes : stderrBytes;
      if (used >= MAX_CAPTURED_BYTES) return;
      const slice = chunk.subarray(0, MAX_CAPTURED_BYTES - used);
      target.push(slice);
      if (counter === 'out') stdoutBytes += slice.byteLength;
      else stderrBytes += slice.byteLength;
    };

    child.stdout.on('data', collect(stdout, 'out'));
    child.stderr.on('data', collect(stderr, 'err'));

    const finish = (outcome: RunOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    child.on('error', (err: NodeJS.ErrnoException) =>
      finish({ exitCode: -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), timedOut, spawnError: err }),
    );
    child.on('close', (code) =>
      finish({
        exitCode: code ?? (timedOut ? 124 : -1),
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        timedOut,
      }),
    );
  });
}

function decodeBase64Image(stdout: string): Buffer | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const dataUrl = /^data:image\/[\w+.-]+;base64,([\s\S]+)$/.exec(trimmed);
  const payload = dataUrl ? dataUrl[1] : trimmed;
  const compact = payload.replace(/\s+/g, '');
  if (compact.length < 32 || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  return Buffer.from(compact, 'base64');
}

function baseName(hint: string | undefined, controlId: string): string {
  const slug = slugifyFileName(hint?.trim() || `${controlId}-script-output`);
  return slug || 'script-output';
}

function truncate(text: string): string {
  return text.length > MAX_DISPLAYED_CHARS
    ? `${text.slice(0, MAX_DISPLAYED_CHARS)}\n… output truncated …`
    : text;
}

export async function runScript(req: ScriptRunRequest): Promise<ScriptRunResult> {
  const ranAt = new Date().toISOString();
  const host = os.hostname();
  const base: ScriptRunResult = {
    cancelled: false,
    ok: false,
    exitCode: -1,
    durationMs: 0,
    ranAt,
    host,
    stdout: '',
    stderr: '',
    timedOut: false,
  };

  if (!req.script.trim()) return { ...base, error: 'The script is empty.' };
  if (req.script.length > MAX_SCRIPT_CHARS) {
    return { ...base, error: `The script exceeds the ${MAX_SCRIPT_CHARS} character limit.` };
  }

  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, req.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grc-evidence-'));
  const scriptPath = path.join(tempDir, `${randomUUID()}.ps1`);
  const outputPath = path.join(tempDir, req.outputMode === 'image' ? 'output.png' : 'output.txt');

  try {
    // BOM so Windows PowerShell 5.1 reads non-ASCII script text correctly.
    await fs.writeFile(scriptPath, `\ufeff${req.script}`, 'utf8');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GRC_OUTPUT_FILE: outputPath,
      GRC_OUTPUT_MODE: req.outputMode,
      GRC_CONTROL_ID: req.controlId,
    };

    const started = Date.now();
    let outcome: RunOutcome | null = null;
    for (const exe of candidateHosts()) {
      outcome = await runHost(exe, scriptPath, tempDir, env, timeoutMs);
      if (outcome.spawnError?.code !== 'ENOENT') break;
    }
    const durationMs = Date.now() - started;

    if (!outcome || outcome.spawnError) {
      return {
        ...base,
        durationMs,
        error:
          outcome?.spawnError?.code === 'ENOENT'
            ? 'No PowerShell host was found on this machine (looked for pwsh and powershell).'
            : (outcome?.spawnError?.message ?? 'The script host could not be started.'),
      };
    }

    const stdout = truncate(outcome.stdout.toString('utf8'));
    const stderr = truncate(outcome.stderr.toString('utf8'));
    const result: ScriptRunResult = {
      ...base,
      durationMs,
      exitCode: outcome.exitCode,
      stdout,
      stderr,
      timedOut: outcome.timedOut,
    };

    if (outcome.timedOut) {
      return { ...result, error: `The script was stopped after ${Math.round(timeoutMs / 1000)}s.` };
    }
    if (outcome.exitCode !== 0) {
      return { ...result, error: `The script exited with code ${outcome.exitCode}.` };
    }

    // Preferred contract: the script writes its evidence to $env:GRC_OUTPUT_FILE.
    let bytes: Buffer | null = null;
    let fileName = `${baseName(req.fileNameHint, req.controlId)}${req.outputMode === 'image' ? '.png' : '.txt'}`;
    const produced = await findProducedFile(tempDir, outputPath, req.outputMode);
    if (produced) {
      bytes = await fs.readFile(produced);
      fileName = `${baseName(req.fileNameHint, req.controlId)}${path.extname(produced).toLowerCase()}`;
    } else if (req.outputMode === 'image') {
      bytes = decodeBase64Image(outcome.stdout.toString('utf8'));
      if (!bytes) {
        return {
          ...result,
          error:
            'No image was produced. Write the image to $env:GRC_OUTPUT_FILE, or emit it to stdout as base64.',
        };
      }
    } else {
      bytes = outcome.stdout;
      if (bytes.byteLength === 0) {
        return { ...result, error: 'The script produced no output to save as evidence.' };
      }
    }

    const artifact = await writeAttachment(bytes, fileName, req.controlId);
    return { ...result, ok: true, artifact };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : 'The script run failed.' };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Accepts the declared output path, or any sibling image the script chose to write instead. */
async function findProducedFile(
  tempDir: string,
  outputPath: string,
  outputMode: ScriptRunRequest['outputMode'],
): Promise<string | null> {
  const declared = await fs.stat(outputPath).catch(() => null);
  if (declared?.isFile() && declared.size > 0) return outputPath;
  if (outputMode !== 'image') return null;

  const entries = await fs.readdir(tempDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(tempDir, entry.name);
    if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const stat = await fs.stat(full).catch(() => null);
    if (stat?.size) return full;
  }
  return null;
}
