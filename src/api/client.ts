/**
 * Thin typed wrapper over the preload bridge. Every call the UI makes to the
 * main process goes through here, so swapping the Electron IPC for an HTTP
 * backend later is a single-file change.
 */
import type {
  AiEvaluateRequest,
  AiEvaluation,
  AiRelatedDraft,
  AiRelatedDraftRequest,
  AiReviseRequest,
  AiRevision,
  AiConnectionTestResult,
  AiSettings,
  AppSettings,
  AttachmentRenameRequest,
  AttachmentRequest,
  AttachmentResult,
  Catalog,
  EvidenceMap,
  EvidenceRecord,
  ExportRequest,
  OscalPackageRequest,
  ScriptRunRequest,
  ScriptRunResult,
  WorkspaceInfo,
} from '@shared/types';

function bridge() {
  if (typeof window === 'undefined' || !window.grc) {
    throw new Error('The desktop bridge is unavailable. Run the app through Electron.');
  }
  return window.grc;
}

export const api = {
  getWorkspace: (): Promise<WorkspaceInfo> => bridge().getWorkspace(),
  openWorkspaceFolder: (): Promise<void> => bridge().openWorkspaceFolder(),
  loadCatalog: (): Promise<Catalog> => bridge().loadCatalog(),
  loadEvidence: (): Promise<EvidenceMap> => bridge().loadEvidence(),
  saveEvidence: (records: EvidenceRecord[]) => bridge().saveEvidence(records),
  deleteEvidence: (controlId: string) => bridge().deleteEvidence(controlId),
  loadSettings: (): Promise<AppSettings> => bridge().loadSettings(),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => bridge().saveSettings(settings),
  addAttachments: (req: AttachmentRequest): Promise<AttachmentResult> => bridge().addAttachments(req),
  readAttachment: (relPath: string): Promise<string | null> => bridge().readAttachment(relPath),
  revealAttachment: (relPath: string): Promise<void> => bridge().revealAttachment(relPath),
  renameAttachment: (req: AttachmentRenameRequest) => bridge().renameAttachment(req),
  deleteAttachments: (relPaths: string[]) => bridge().deleteAttachments(relPaths),
  runScript: (req: ScriptRunRequest): Promise<ScriptRunResult> => bridge().runScript(req),
  aiEvaluate: (req: AiEvaluateRequest): Promise<AiEvaluation> => bridge().aiEvaluate(req),
  aiRevise: (req: AiReviseRequest): Promise<AiRevision> => bridge().aiRevise(req),
  aiRelatedDraft: (req: AiRelatedDraftRequest): Promise<AiRelatedDraft> => bridge().aiRelatedDraft(req),
  aiTestConnection: (settings: AiSettings): Promise<AiConnectionTestResult> => bridge().aiTestConnection(settings),
  aiSignOut: (): Promise<void> => bridge().aiSignOut(),
  aiSignIn: (settings: AiSettings): Promise<string | null> => bridge().aiSignIn(settings),
  aiSignedInAccount: (settings: AiSettings): Promise<string | null> => bridge().aiSignedInAccount(settings),
  aiSetApiKey: (apiKey: string): Promise<void> => bridge().aiSetApiKey(apiKey),
  aiClearApiKey: (): Promise<void> => bridge().aiClearApiKey(),
  aiHasApiKey: (): Promise<boolean> => bridge().aiHasApiKey(),
  exportFile: (req: ExportRequest) => bridge().exportFile(req),
  exportOscalPackage: (req: OscalPackageRequest) => bridge().exportOscalPackage(req),
  backupConfig: () => bridge().backupConfig(),
  restoreConfig: () => bridge().restoreConfig(),
  backupDatabase: () => bridge().backupDatabase(),
  restoreDatabase: () => bridge().restoreDatabase(),
  chooseWorkspaceLocation: () => bridge().chooseWorkspaceLocation(),
  resetWorkspaceLocation: () => bridge().resetWorkspaceLocation(),
  importOscalSsp: () => bridge().importOscalSsp(),
};
