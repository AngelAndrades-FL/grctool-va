import { useEffect, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { DateTime } from 'luxon';
import type {
  Artifact,
  ArtifactRecurrence,
  EvidenceRequirement,
  ScriptOutputMode,
  ScriptRunResult,
} from '@shared/types';
import { hasEvidence, snapshotCycle } from '@shared/recurring';
import { useRunScript, useSettings } from '@/api/queries';
import { api } from '@/api/client';
import { cycleSettingsOf } from '@/domain/recurringRollup';
import { RecurrenceSection } from './RecurrenceSection';

const MAX_PREVIEW_CHARS = 20_000;

/** Shows the evidence file as saved, so file-based output ($env:GRC_OUTPUT_FILE, images) is visible too. */
function EvidencePreview({ filePath, mimeType, label }: { filePath: string; mimeType?: string; label: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.readAttachment(filePath).then((url) => {
      if (cancelled) return;
      setDataUrl(url);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (loading) return <CircularProgress size={16} />;
  if (!dataUrl) {
    return (
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        The evidence file could not be read.
      </Typography>
    );
  }

  const mime = mimeType ?? dataUrl.slice(5, dataUrl.indexOf(';'));
  if (mime.startsWith('image/')) {
    return (
      <Stack spacing={0.5}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {label}
        </Typography>
        <Box
          component="img"
          src={dataUrl}
          alt={label}
          sx={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain', border: 1, borderColor: 'divider', borderRadius: 1 }}
        />
      </Stack>
    );
  }

  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  const text = new TextDecoder().decode(bytes);
  return (
    <TextField
      fullWidth
      multiline
      maxRows={14}
      label={label}
      value={text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS)}\n… preview truncated …` : text}
      slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: 12 } } }}
    />
  );
}

const EXAMPLES: Record<ScriptOutputMode, string> = {
  text: `# Anything written to stdout is saved as the evidence file.
Get-LocalGroupMember -Group 'Administrators' |
  Select-Object Name, ObjectClass, PrincipalSource |
  Format-Table -AutoSize | Out-String -Width 200
`,
  image: `# Write the image to $env:GRC_OUTPUT_FILE and it is saved as the evidence file.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save($env:GRC_OUTPUT_FILE, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose()
`,
};

const MODE_HINT: Record<ScriptOutputMode, string> = {
  text: 'Standard output is saved as a .txt evidence file. Writing to $env:GRC_OUTPUT_FILE takes precedence.',
  image: 'Save the image to the path in $env:GRC_OUTPUT_FILE, or emit it to standard output as base64.',
};

export interface ScriptArtifactDialogProps {
  open: boolean;
  controlId: string;
  /** Existing script artifact being edited or re-run, or null to collect a new one. */
  artifact: Artifact | null;
  evidenceRequired: EvidenceRequirement[];
  currentUser: string;
  onClose: () => void;
  onSave: (artifact: Artifact) => void;
}

export function ScriptArtifactDialog({
  open,
  controlId,
  artifact,
  evidenceRequired,
  currentUser,
  onClose,
  onSave,
}: ScriptArtifactDialogProps) {
  const runScript = useRunScript();
  const { data: settings } = useSettings();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [evidenceType, setEvidenceType] = useState('Other');
  const [recurrence, setRecurrence] = useState<ArtifactRecurrence | undefined>(undefined);
  const [source, setSource] = useState('');
  const [outputMode, setOutputMode] = useState<ScriptOutputMode>('text');
  const [timeoutSec, setTimeoutSec] = useState(60);
  const [result, setResult] = useState<ScriptRunResult | null>(null);
  const [captured, setCaptured] = useState<Artifact | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(artifact?.title ?? '');
    setDescription(artifact?.description ?? '');
    setEvidenceType(artifact?.evidenceType ?? evidenceRequired[0]?.evidence_type ?? 'Other');
    setRecurrence(artifact?.recurrence);
    setSource(artifact?.script?.source ?? '');
    setOutputMode(artifact?.script?.outputMode ?? 'text');
    setResult(null);
    setCaptured(null);
    setSaveError(null);
  }, [open, artifact, evidenceRequired]);

  const run = async () => {
    setResult(null);
    setCaptured(null);
    const outcome = await runScript.mutateAsync({
      controlId,
      script: source,
      outputMode,
      fileNameHint: title,
      timeoutMs: timeoutSec * 1000,
    });
    if (outcome.cancelled) return;
    setResult(outcome);
    if (!outcome.ok || !outcome.artifact) return;

    setCaptured({
      id: artifact?.id ?? crypto.randomUUID(),
      evidenceType,
      title: title.trim() || `${controlId} script output`,
      description,
      kind: 'file',
      ...outcome.artifact,
      collectedAt: outcome.ranAt,
      collectedBy: currentUser,
      script: {
        language: 'powershell',
        source,
        outputMode,
        ranAt: outcome.ranAt,
        exitCode: outcome.exitCode,
        durationMs: outcome.durationMs,
        host: outcome.host,
        runBy: currentUser,
        stderr: outcome.stderr,
      },
    });
  };

  const priorRun = artifact?.script;
  // Evidence must match the script that produced it, so a changed script has to be re-run before saving.
  const scriptChanged = !artifact?.script || source !== artifact.script.source;
  const freshCapture = captured?.script?.source === source ? captured : null;
  const base = freshCapture ?? (scriptChanged ? null : artifact);

  const save = async () => {
    if (!base) return;
    // A fresh run of a recurring artifact starts a new cycle; the previous output is kept as history.
    const history =
      recurrence && freshCapture && artifact && hasEvidence(artifact)
        ? [snapshotCycle(artifact, cycleSettingsOf(settings)), ...recurrence.history]
        : recurrence?.history;
    const { recurrence: _previous, ...rest } = base;
    const finalTitle = title.trim() || base.title || `${controlId} script output`;
    let file: Pick<Artifact, 'filePath' | 'fileName'> = {};
    if (base.filePath) {
      setSaving(true);
      setSaveError(null);
      try {
        const collectedOn = (base.collectedAt ? DateTime.fromISO(base.collectedAt) : DateTime.now()).toISODate() ?? '';
        file = await api.renameAttachment({ filePath: base.filePath, controlId, evidenceType, title: finalTitle, collectedOn });
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setSaving(false);
      }
    }
    onSave({
      ...rest,
      ...file,
      title: finalTitle,
      description,
      evidenceType,
      ...(recurrence ? { recurrence: { ...recurrence, history: history ?? [] } } : {}),
    });
    onClose();
  };

  const recurrenceView: Artifact = {
    ...(freshCapture ?? artifact ?? { id: 'new', kind: 'file', title, description, evidenceType }),
    recurrence,
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pb: 1 }}>
        {artifact ? 'Re-run collection script' : 'Collect evidence with a PowerShell script'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Alert severity="warning" variant="outlined">
            The script runs on this machine with your privileges. You will be asked to confirm each run.
          </Alert>

          {priorRun && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Last run {DateTime.fromISO(priorRun.ranAt).toFormat('dd LLL yyyy HH:mm')} on {priorRun.host} by{' '}
              {priorRun.runBy || 'unknown'} (exit {priorRun.exitCode}).
            </Typography>
          )}

          <Stack direction="row" spacing={2}>
            <TextField
              fullWidth
              label="Title"
              placeholder="Local administrators listing"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <TextField
              select
              fullWidth
              label="Evidence type"
              value={evidenceType}
              onChange={(e) => setEvidenceType(e.target.value)}
              helperText="Choosing a required type marks that requirement as evidenced."
              slotProps={{ select: { renderValue: (value) => String(value) } }}
            >
              {evidenceRequired.map((req) => (
                <MenuItem key={req.evidence_type} value={req.evidence_type} sx={{ display: 'block', whiteSpace: 'normal', maxWidth: 420 }}>
                  <Typography variant="body2">{req.evidence_type}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {req.description}
                  </Typography>
                </MenuItem>
              ))}
              {evidenceType &&
                evidenceType !== 'Other' &&
                !evidenceRequired.some((r) => r.evidence_type === evidenceType) && (
                  <MenuItem value={evidenceType}>{evidenceType}</MenuItem>
                )}
              <MenuItem value="Other">
                <Typography variant="body2">Other</Typography>
              </MenuItem>
            </TextField>
          </Stack>

          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Description"
            placeholder="What does this collection prove, and what should an assessor look at?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={outputMode}
              onChange={(_e, next: ScriptOutputMode | null) => next && setOutputMode(next)}
            >
              <ToggleButton value="text" sx={{ px: 2 }}>
                Text output
              </ToggleButton>
              <ToggleButton value="image" sx={{ px: 2 }}>
                Image output
              </ToggleButton>
            </ToggleButtonGroup>
            <TextField
              label="Timeout (s)"
              type="number"
              size="small"
              value={timeoutSec}
              onChange={(e) => setTimeoutSec(Math.min(600, Math.max(1, Number(e.target.value) || 60)))}
              sx={{ width: 130 }}
            />
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" onClick={() => setSource(EXAMPLES[outputMode])}>
              Insert example
            </Button>
          </Stack>

          <TextField
            fullWidth
            multiline
            minRows={10}
            label="PowerShell script"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            helperText={MODE_HINT[outputMode]}
            slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
          />

          {runScript.isPending && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={16} />
              <Typography variant="caption">Waiting for the script to finish…</Typography>
            </Stack>
          )}

          {result && (
            <>
              <Divider />
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Chip
                    size="small"
                    color={result.ok ? 'success' : 'error'}
                    label={result.ok ? 'Succeeded' : `Exit ${result.exitCode}`}
                  />
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {result.durationMs} ms on {result.host}
                  </Typography>
                </Stack>

                {result.error && (
                  <Alert severity="error" variant="outlined">
                    <AlertTitle>Nothing was saved</AlertTitle>
                    {result.error}
                  </Alert>
                )}

                {captured?.filePath && (
                  <Alert severity="success" variant="outlined">
                    Saved as{' '}
                    <Box component="span" sx={{ fontFamily: 'monospace' }}>
                      {captured.filePath}
                    </Box>{' '}
                    ({((captured.sizeBytes ?? 0) / 1024).toFixed(1)} KB)
                  </Alert>
                )}

                {result.stdout && (
                  <TextField
                    fullWidth
                    multiline
                    maxRows={12}
                    label="Standard output"
                    value={result.stdout}
                    slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: 12 } } }}
                  />
                )}
                {result.stderr && (
                  <TextField
                    fullWidth
                    multiline
                    maxRows={8}
                    label="Standard error"
                    value={result.stderr}
                    slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: 12 } } }}
                  />
                )}
              </Stack>
            </>
          )}

          {captured?.filePath ? (
            <EvidencePreview
              key={captured.filePath}
              filePath={captured.filePath}
              mimeType={captured.mimeType}
              label="Captured evidence"
            />
          ) : (
            !result &&
            artifact?.filePath && (
              <>
                <Divider />
                <EvidencePreview
                  key={artifact.filePath}
                  filePath={artifact.filePath}
                  mimeType={artifact.mimeType}
                  label="Evidence from last run"
                />
              </>
            )
          )}

          <Divider />

          <RecurrenceSection
            artifact={recurrenceView}
            onChange={(next) => setRecurrence(next.recurrence)}
            currentUser={currentUser}
            newCycleHint="Re-run the script to collect a new cycle — when saved, the previous output moves into the history below."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        {artifact && scriptChanged && !freshCapture && (
          <Typography variant="caption" sx={{ color: 'text.secondary', mr: 'auto', pl: 1 }}>
            The script was changed — run it to capture new evidence before saving.
          </Typography>
        )}
        {saveError && (
          <Typography variant="caption" sx={{ color: 'error.main', mr: 'auto', pl: 1 }}>
            {saveError}
          </Typography>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button
          startIcon={<PlayArrowIcon />}
          onClick={() => void run()}
          disabled={!source.trim() || runScript.isPending}
        >
          Run script
        </Button>
        <Button variant="contained" disabled={!base || saving} onClick={() => void save()}>
          Save artifact
        </Button>
      </DialogActions>
    </Dialog>
  );
}
