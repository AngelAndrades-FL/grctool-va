/** Runtime checks for IPC payloads; the renderer is not trusted to send well-formed data. */
import type {
  AppSettings,
  AttachmentRenameRequest,
  AttachmentRequest,
  EvidenceRecord,
  ExportRequest,
  OscalPackageRequest,
  ScriptRunRequest,
} from '../shared/types.js';

const CONTROL_ID = /^[A-Za-z]{2}-\d{1,3}(\s*\(\d{1,3}\))?$/;
const COLLECTED_ON = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT_CHARS = 200 * 1024 * 1024;

function fail(what: string): never {
  throw new Error(`Invalid request: ${what}.`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, what: string, max = MAX_TEXT_CHARS): string {
  if (typeof value !== 'string' || value.length > max) fail(what);
  return value;
}

export function controlId(value: unknown): string {
  if (typeof value !== 'string' || !CONTROL_ID.test(value)) fail('control id');
  return value;
}

export function relPath(value: unknown): string {
  return text(value, 'file path', 1024);
}

export function relPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10_000) fail('file path list');
  return value.map(relPath);
}

export function evidenceRecords(value: unknown): EvidenceRecord[] {
  if (!Array.isArray(value)) fail('evidence records');
  for (const record of value) {
    if (!isObject(record)) fail('evidence record');
    controlId(record.controlId);
  }
  return value as EvidenceRecord[];
}

export function settings(value: unknown): AppSettings {
  if (!isObject(value) || typeof value.systemName !== 'string' || !isObject(value.ai)) fail('settings');
  return value as unknown as AppSettings;
}

export function attachmentRequest(value: unknown): AttachmentRequest {
  if (!isObject(value)) fail('attachment request');
  controlId(value.controlId);
  return value as unknown as AttachmentRequest;
}

export function renameRequest(value: unknown): AttachmentRenameRequest {
  if (!isObject(value)) fail('rename request');
  relPath(value.filePath);
  controlId(value.controlId);
  if (typeof value.collectedOn !== 'string' || !COLLECTED_ON.test(value.collectedOn)) fail('collection date');
  if (value.scheme === 'poam' || value.scheme === 'poam-archive') return value as unknown as AttachmentRenameRequest;
  if (value.scheme !== undefined && value.scheme !== 'artifact') fail('rename scheme');
  text(value.evidenceType, 'evidence type', 200);
  text(value.title, 'title', 500);
  return value as unknown as AttachmentRenameRequest;
}

export function scriptRequest(value: unknown): ScriptRunRequest {
  if (!isObject(value)) fail('script request');
  controlId(value.controlId);
  text(value.script, 'script', 1_000_000);
  if (value.outputMode !== 'image' && value.outputMode !== 'text') fail('output mode');
  if (value.fileNameHint !== undefined) text(value.fileNameHint, 'file name', 200);
  if (value.timeoutMs !== undefined && !Number.isFinite(value.timeoutMs)) fail('timeout');
  return value as unknown as ScriptRunRequest;
}

export function exportRequest(value: unknown): ExportRequest {
  if (!isObject(value)) fail('export request');
  text(value.contents, 'export contents');
  text(value.suggestedName, 'file name', 260);
  return value as unknown as ExportRequest;
}

export function oscalPackageRequest(value: unknown): OscalPackageRequest {
  if (!isObject(value)) fail('package request');
  text(value.sspJson, 'SSP JSON');
  text(value.sspFileName, 'SSP file name', 260);
  text(value.suggestedName, 'file name', 260);
  return value as unknown as OscalPackageRequest;
}
