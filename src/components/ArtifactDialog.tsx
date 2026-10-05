import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { DateTime } from 'luxon';
import type { Artifact, ArtifactKind, EvidenceRequirement } from '@shared/types';
import { MermaidDiagram } from './MermaidDiagram';
import { RecurrenceSection } from './RecurrenceSection';
import { api } from '@/api/client';
import { useSettings } from '@/api/queries';
import { atoMinDate } from '@/domain/completeness';

const KINDS: Array<{ value: ArtifactKind; label: string; hint: string }> = [
  { value: 'file', label: 'File', hint: 'A document, screenshot or export copied into the workspace.' },
  { value: 'url', label: 'Link', hint: 'A pointer to a system of record — SharePoint, a ticket, a dashboard.' },
  { value: 'diagram', label: 'Diagram', hint: 'A Mermaid diagram authored here and stored as source.' },
  { value: 'text', label: 'Note', hint: 'A short written attestation or excerpt.' },
];

function AttachmentPreview({ artifact }: { artifact: Artifact }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!artifact.filePath) return;
    let cancelled = false;
    void api.readAttachment(artifact.filePath).then((result) => {
      if (!cancelled) setDataUrl(result);
    });
    return () => {
      cancelled = true;
    };
  }, [artifact.filePath]);

  if (!artifact.filePath) return null;
  const isImage = (artifact.mimeType ?? '').startsWith('image/');

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Chip size="small" label={artifact.mimeType ?? 'file'} variant="outlined" sx={{ height: 20, fontSize: 11 }} />
        {artifact.sizeBytes !== undefined && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {(artifact.sizeBytes / 1024).toFixed(1)} KB
          </Typography>
        )}
        <Link
          component="button"
          type="button"
          variant="caption"
          onClick={() => void api.revealAttachment(artifact.filePath!)}
        >
          Show in folder
        </Link>
      </Stack>
      <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', wordBreak: 'break-all' }}>
        {artifact.filePath}
      </Typography>
      {artifact.sha256 && (
        <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', wordBreak: 'break-all' }}>
          sha256: {artifact.sha256}
        </Typography>
      )}
      {isImage && dataUrl && (
        <Box
          component="img"
          src={dataUrl}
          alt={artifact.title}
          sx={{ maxWidth: '100%', maxHeight: 280, objectFit: 'contain', border: 1, borderColor: 'divider', borderRadius: 1 }}
        />
      )}
    </Stack>
  );
}

export interface ArtifactDialogProps {
  open: boolean;
  artifact: Artifact | null;
  controlId: string;
  familyId: string;
  evidenceRequired: EvidenceRequirement[];
  onClose: () => void;
  onSave: (artifact: Artifact) => void;
}

export function ArtifactDialog({
  open,
  artifact,
  controlId,
  familyId,
  evidenceRequired,
  onClose,
  onSave,
}: ArtifactDialogProps) {
  const [draft, setDraft] = useState<Artifact | null>(artifact);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const { data: settings } = useSettings();
  const minCollectedDate = atoMinDate(settings?.lastAtoDate);

  useEffect(() => {
    setDraft(artifact);
    setPickError(null);
  }, [artifact]);

  if (!draft) return null;
  const patch = (update: Partial<Artifact>) => setDraft({ ...draft, ...update });
  const kindHint = KINDS.find((k) => k.value === draft.kind)?.hint;
  const needsFile = draft.kind === 'file' && !draft.filePath;

  const chooseFile = async () => {
    setPicking(true);
    setPickError(null);
    try {
      const result = await api.addAttachments({ controlId, familyId, single: true });
      const file = result.artifacts[0];
      if (result.cancelled || !file) return;
      const originalName = file.fileName?.split('__').slice(2).join('__') ?? '';
      setDraft((d) => d && { ...d, ...file, title: d.title.trim() ? d.title : originalName.replace(/\.[^.]+$/, '') });
    } catch (err) {
      setPickError(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(false);
    }
  };

  const save = async () => {
    let next = draft;
    if (draft.kind === 'file' && draft.filePath) {
      setSaving(true);
      setPickError(null);
      try {
        const collectedOn = (draft.collectedAt ? DateTime.fromISO(draft.collectedAt) : DateTime.now()).toISODate() ?? '';
        const renamed = await api.renameAttachment({
          filePath: draft.filePath,
          controlId,
          evidenceType: draft.evidenceType,
          title: draft.title,
          collectedOn,
        });
        next = { ...draft, ...renamed };
      } catch (err) {
        setPickError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setSaving(false);
      }
    }
    onSave(next);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pb: 1 }}>{artifact?.title ? 'Edit artifact' : 'Add artifact'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Box>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={draft.kind}
              onChange={(_e, next: ArtifactKind | null) => next && patch({ kind: next })}
              disabled={Boolean(draft.filePath)}
            >
              {KINDS.map((k) => (
                <ToggleButton key={k.value} value={k.value} sx={{ px: 2 }}>
                  {k.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
              {kindHint}
            </Typography>
          </Box>

          <Stack direction="row" spacing={2}>
            <TextField
              fullWidth
              label="Title"
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
            <TextField
              select
              fullWidth
              label="Evidence type"
              value={draft.evidenceType}
              onChange={(e) => patch({ evidenceType: e.target.value })}
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
              {draft.evidenceType &&
                draft.evidenceType !== 'Other' &&
                !evidenceRequired.some((r) => r.evidence_type === draft.evidenceType) && (
                  <MenuItem value={draft.evidenceType}>{draft.evidenceType}</MenuItem>
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
            placeholder="What does this artifact prove, and what should an assessor look at?"
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />

          {draft.kind === 'url' && (
            <TextField
              fullWidth
              label="URL"
              placeholder="https://"
              value={draft.url ?? ''}
              onChange={(e) => patch({ url: e.target.value })}
            />
          )}

          {draft.kind === 'text' && (
            <TextField
              fullWidth
              multiline
              minRows={5}
              label="Note content"
              value={draft.body ?? ''}
              onChange={(e) => patch({ body: e.target.value })}
            />
          )}

          {draft.kind === 'diagram' && (
            <Stack spacing={1.5}>
              <TextField
                fullWidth
                multiline
                minRows={6}
                label="Mermaid source"
                placeholder={'graph LR\n  User-->|VPN|TIC\n  TIC-->App'}
                value={draft.mermaid ?? ''}
                onChange={(e) => patch({ mermaid: e.target.value })}
                slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
              />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Live preview
              </Typography>
              <MermaidDiagram code={draft.mermaid ?? ''} />
            </Stack>
          )}

          {draft.kind === 'file' && (
            <Stack spacing={1}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Button
                  variant={draft.filePath ? 'outlined' : 'contained'}
                  size="small"
                  startIcon={picking ? <CircularProgress size={16} /> : <AttachFileIcon />}
                  disabled={picking}
                  onClick={() => void chooseFile()}
                >
                  {draft.filePath ? 'Replace file…' : 'Choose file…'}
                </Button>
                {needsFile && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    The file is copied into the workspace and renamed control_evidence type_title_collected on when saved.
                  </Typography>
                )}
              </Stack>
              {pickError && (
                <Typography variant="caption" sx={{ color: 'error.main' }}>
                  {pickError}
                </Typography>
              )}
              <AttachmentPreview key={draft.filePath} artifact={draft} />
            </Stack>
          )}

          <Divider />

          <Stack direction="row" spacing={2}>
            <DatePicker
              label="Collected on"
              value={draft.collectedAt ? DateTime.fromISO(draft.collectedAt) : null}
              onChange={(value) => patch({ collectedAt: value?.isValid ? value.toISO() ?? undefined : undefined })}
              minDate={minCollectedDate}
              slotProps={{ textField: { size: 'small', sx: { minWidth: 200 } } }}
            />
            <TextField
              fullWidth
              label="Collected by"
              value={draft.collectedBy ?? ''}
              onChange={(e) => patch({ collectedBy: e.target.value })}
            />
          </Stack>

          <Divider />

          <RecurrenceSection artifact={draft} onChange={setDraft} currentUser={settings?.currentUser ?? ''} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!draft.title.trim() || needsFile || saving}
          onClick={() => void save()}
        >
          Save artifact
        </Button>
      </DialogActions>
    </Dialog>
  );
}
