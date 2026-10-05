import { useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import LinkIcon from '@mui/icons-material/Link';
import AddLinkIcon from '@mui/icons-material/AddLink';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import NotesIcon from '@mui/icons-material/Notes';
import TerminalIcon from '@mui/icons-material/Terminal';
import { DateTime } from 'luxon';
import type { Artifact, ArtifactKind, EvidenceRequirement } from '@shared/types';
import {
  EVIDENCE_CATEGORY_LABEL,
  FREQUENCY_LABEL,
  STATUS_LABEL,
  activeCycleLabels,
  newRecurrence,
  nextDueDate,
  recurringStatus,
  seedTemplatesFor,
  statusSeverity,
  type RecurringSeedTemplate,
} from '@shared/recurring';
import { useSettings } from '@/api/queries';
import { api } from '@/api/client';
import { cycleSettingsOf } from '@/domain/recurringRollup';
import { useAppState } from '@/state/AppState';
import { ArtifactDialog } from './ArtifactDialog';
import { ScriptArtifactDialog } from './ScriptArtifactDialog';

const KIND_ICON: Record<ArtifactKind, React.ReactNode> = {
  file: <AttachFileIcon fontSize="small" />,
  url: <LinkIcon fontSize="small" />,
  diagram: <AccountTreeIcon fontSize="small" />,
  text: <NotesIcon fontSize="small" />,
};

function blankArtifact(kind: ArtifactKind, evidenceType: string, collectedBy: string): Artifact {
  return {
    id: crypto.randomUUID(),
    evidenceType,
    title: '',
    description: '',
    kind,
    collectedAt: DateTime.now().toISO(),
    collectedBy,
  };
}

export interface ArtifactsPanelProps {
  controlId: string;
  familyId: string;
  evidenceRequired: EvidenceRequirement[];
  artifacts: Artifact[];
  /** Artifacts owned by other controls and linked here (read-only), each with `sharedFrom` set. */
  linkedArtifacts?: Artifact[];
  /** Artifacts in other controls that could be linked here. */
  linkCandidates?: Array<{ owner: string; artifact: Artifact }>;
  /** Every control id, for the "Also applies to" picker. */
  controlOptions?: string[];
  /** Controls (other than this one) that link the given artifact. */
  linkedBy?: (artifactId: string) => string[];
  onLink?: (artifactIds: string[]) => void;
  onUnlink?: (artifactId: string) => void;
  onShare?: (artifactId: string, controlIds: string[]) => void;
  currentUser: string;
  /** The control's text reads like evidence must be re-collected on a cadence. */
  suggestRecurring?: boolean;
  onChange: (artifacts: Artifact[]) => void;
}

export function ArtifactsPanel({
  controlId,
  familyId,
  evidenceRequired,
  artifacts,
  linkedArtifacts = [],
  linkCandidates = [],
  controlOptions = [],
  linkedBy,
  onLink,
  onUnlink,
  onShare,
  currentUser,
  suggestRecurring = false,
  onChange,
}: ArtifactsPanelProps) {
  const { notify } = useAppState();
  const { data: settings } = useSettings();
  const dueSoonDays = settings?.recurringDueSoonDays ?? 30;
  const cycleSettings = cycleSettingsOf(settings);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState<Artifact | null>(null);
  const [scripting, setScripting] = useState<{ artifact: Artifact | null } | null>(null);
  const [linking, setLinking] = useState<string[] | null>(null);
  const rows = useMemo(() => [...artifacts, ...linkedArtifacts], [artifacts, linkedArtifacts]);

  const satisfiedIndexes = useMemo(() => {
    const types = new Set(rows.map((a) => a.evidenceType.toLowerCase()));
    const set = new Set<number>();
    evidenceRequired.forEach((req, index) => {
      if (types.has(req.evidence_type.toLowerCase())) set.add(index);
    });
    return set;
  }, [rows, evidenceRequired]);

  const missing = evidenceRequired.filter((_req, index) => !satisfiedIndexes.has(index));

  const upsert = (artifact: Artifact, shareWith: string[] = []) => {
    const index = artifacts.findIndex((a) => a.id === artifact.id);
    onChange(index === -1 ? [...artifacts, artifact] : artifacts.map((a) => (a.id === artifact.id ? artifact : a)));
    if (shareWith.length) onShare?.(artifact.id, shareWith);
  };

  const firstMissingType = () => (missing[0] ?? evidenceRequired[0])?.evidence_type ?? 'Other';

  const recurring = artifacts.filter((a) => a.recurrence);
  const needingAttention = recurring.filter((a) => recurringStatus(a, dueSoonDays) !== 'current').length;
  const unusedTemplates = seedTemplatesFor(controlId).filter(
    (t) => !artifacts.some((a) => a.recurrence && a.title.trim().toLowerCase() === t.requirementLabel.toLowerCase()),
  );

  const startFromTemplate = (template: RecurringSeedTemplate) => {
    const evidenceType = evidenceRequired.length ? firstMissingType() : EVIDENCE_CATEGORY_LABEL[template.evidenceType];
    setEditing({
      ...blankArtifact('file', evidenceType, currentUser),
      title: template.requirementLabel,
      recurrence: newRecurrence(template),
    });
  };

  const remove = async (artifact: Artifact) => {
    const earlier = artifact.recurrence?.history.length ?? 0;
    const filesOf = (a: Artifact) =>
      [a.filePath, ...(a.recurrence?.history.map((c) => c.filePath) ?? [])].filter((p): p is string => Boolean(p));
    const stillUsed = new Set(artifacts.filter((a) => a.id !== artifact.id).flatMap(filesOf));
    const files = filesOf(artifact).filter((p) => !stillUsed.has(p));
    const what = earlier > 0 ? `"${artifact.title}" and its ${earlier} earlier cycle(s)` : `"${artifact.title}"`;
    const fileNote = files.length ? ` ${files.length} file(s) will be permanently deleted from the workspace.` : '';
    const sharedWith = linkedBy?.(artifact.id) ?? [];
    const sharedNote = sharedWith.length ? ` It is also used by ${sharedWith.join(', ')}, which will lose it.` : '';
    if ((earlier > 0 || files.length > 0 || sharedWith.length > 0) && !window.confirm(`Remove ${what}?${fileNote}${sharedNote}`)) {
      return;
    }
    onChange(artifacts.filter((a) => a.id !== artifact.id));
    if (files.length) {
      try {
        await api.deleteAttachments(files);
      } catch (err) {
        notify(`Artifact removed, but deleting its file failed: ${err instanceof Error ? err.message : String(err)}`, 'warning');
        return;
      }
    }
    notify('Artifact removed', 'info');
  };

  const columns: GridColDef<Artifact>[] = [
    {
      field: 'kind',
      headerName: '',
      width: 48,
      sortable: false,
      renderCell: (params) => (
        <Tooltip title={params.row.script ? 'powershell script output' : params.row.kind}>
          <Stack sx={{ height: '100%', justifyContent: 'center', color: 'text.secondary' }}>
            {params.row.script ? <TerminalIcon fontSize="small" /> : KIND_ICON[params.row.kind]}
          </Stack>
        </Tooltip>
      ),
    },
    { field: 'title', headerName: 'Title', flex: 1, minWidth: 180,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.75} sx={{ height: '100%', alignItems: 'center', minWidth: 0 }}>
          <Typography variant="body2" noWrap>{params.row.title}</Typography>
          {params.row.sharedFrom && (
            <Chip size="small" variant="outlined" icon={<LinkIcon />} label={`Shared from ${params.row.sharedFrom}`} sx={{ height: 20, fontSize: 11 }} />
          )}
        </Stack>
      ),
    },
    { field: 'evidenceType', headerName: 'Evidence type', width: 170 },
    {
      field: 'recurrence',
      headerName: 'Recurrence',
      width: 190,
      sortable: false,
      renderCell: (params) => {
        const artifact = params.row;
        if (!artifact.recurrence) {
          return (
            <Stack sx={{ height: '100%', justifyContent: 'center' }}>
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                One-time
              </Typography>
            </Stack>
          );
        }
        const status = recurringStatus(artifact, dueSoonDays);
        const due = nextDueDate(artifact);
        const cycles = activeCycleLabels(artifact, cycleSettings);
        return (
          <Tooltip
            title={`${FREQUENCY_LABEL[artifact.recurrence.frequencyType]} · next due ${due ?? '—'} · cycles on file: ${cycles.join(', ') || 'none'}`}
          >
            <Stack direction="row" spacing={0.5} sx={{ height: '100%', alignItems: 'center' }}>
              <Chip
                label={FREQUENCY_LABEL[artifact.recurrence.frequencyType]}
                size="small"
                variant="outlined"
                sx={{ height: 20, fontSize: 11 }}
              />
              <Chip label={STATUS_LABEL[status]} size="small" color={statusSeverity(status)} sx={{ height: 20, fontSize: 11 }} />
            </Stack>
          </Tooltip>
        );
      },
    },
    {
      field: 'collectedAt',
      headerName: 'Collected',
      width: 120,
      valueFormatter: (value: string | undefined) =>
        value ? DateTime.fromISO(value).toFormat('dd LLL yyyy') : '—',
    },
    {
      field: 'actions',
      headerName: '',
      width: 90,
      sortable: false,
      renderCell: (params) =>
        params.row.sharedFrom ? (
          <Stack direction="row" sx={{ height: '100%', alignItems: 'center' }}>
            <Tooltip title={`Unlink (edit it in ${params.row.sharedFrom})`}>
              <IconButton size="small" onClick={() => onUnlink?.(params.row.id)}>
                <LinkOffIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ) : (
        <Stack direction="row" sx={{ height: '100%', alignItems: 'center' }}>
          <IconButton
            size="small"
            onClick={() =>
              params.row.script ? setScripting({ artifact: params.row }) : setEditing(params.row)
            }
          >
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => void remove(params.row)}
          >
            <DeleteOutlinedIcon fontSize="small" />
          </IconButton>
        </Stack>
        ),
    },
  ];

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={(e) => setMenuAnchor(e.currentTarget)}
        >
          Add artifact
        </Button>
        {onLink && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddLinkIcon />}
            disabled={linkCandidates.length === 0}
            onClick={() => setLinking([])}
          >
            Link existing artifact
          </Button>
        )}
        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              setEditing(blankArtifact('file', firstMissingType(), currentUser));
            }}
          >
            <AttachFileIcon fontSize="small" sx={{ mr: 1 }} /> Attach file…
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              setScripting({ artifact: null });
            }}
          >
            <TerminalIcon fontSize="small" sx={{ mr: 1 }} /> Run PowerShell script…
          </MenuItem>
          {(['url', 'diagram', 'text'] as ArtifactKind[]).map((kind) => (
            <MenuItem
              key={kind}
              onClick={() => {
                setMenuAnchor(null);
                setEditing(blankArtifact(kind, firstMissingType(), currentUser));
              }}
            >
              <Box sx={{ mr: 1, display: 'flex' }}>{KIND_ICON[kind]}</Box>
              {kind === 'url' ? 'Add link' : kind === 'diagram' ? 'Draw diagram' : 'Write note'}
            </MenuItem>
          ))}
        </Menu>

        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {satisfiedIndexes.size}/{evidenceRequired.length} required evidence types covered
          {recurring.length > 0 &&
            ` · ${recurring.length} recurring${needingAttention ? ` (${needingAttention} need attention)` : ''}`}
        </Typography>
      </Stack>

      {(unusedTemplates.length > 0 || (suggestRecurring && recurring.length === 0)) && (
        <Alert severity="info" variant="outlined" sx={{ py: 0.25 }}>
          <Stack spacing={0.75}>
            <Typography variant="caption">
              {unusedTemplates.length > 0
                ? 'Evidence for this control is usually re-collected on a cadence. Start a recurring artifact:'
                : 'This control’s language suggests evidence may need re-collecting on a cadence. Turn on “Recurring evidence” when adding or editing an artifact.'}
            </Typography>
            {unusedTemplates.length > 0 && (
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                {unusedTemplates.map((template) => (
                  <Button
                    key={template.requirementLabel}
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => startFromTemplate(template)}
                  >
                    {template.requirementLabel} ({FREQUENCY_LABEL[template.frequencyType].toLowerCase()})
                  </Button>
                ))}
              </Stack>
            )}
          </Stack>
        </Alert>
      )}

      {missing.length > 0 && (
        <Alert severity="warning" variant="outlined" sx={{ py: 0.25 }}>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
            <Typography variant="caption">Not yet evidenced:</Typography>
            {missing.map((req) => (
              <Chip key={req.evidence_type} size="small" label={req.evidence_type} sx={{ height: 18, fontSize: 10 }} />
            ))}
          </Stack>
        </Alert>
      )}

      {rows.length > 0 && (
        <Paper variant="outlined">
          <DataGrid<Artifact>
            rows={rows}
            columns={columns}
            density="compact"
            hideFooter={rows.length <= 10}
            disableRowSelectionOnClick
            autoHeight
            sx={{ border: 0 }}
          />
        </Paper>
      )}

      <ArtifactDialog
        open={Boolean(editing)}
        artifact={editing}
        controlId={controlId}
        familyId={familyId}
        evidenceRequired={evidenceRequired}
        controlOptions={controlOptions}
        onClose={() => setEditing(null)}
        onSave={upsert}
      />

      <Dialog open={linking !== null} onClose={() => setLinking(null)} fullWidth maxWidth="sm">
        <DialogTitle>Link existing artifact</DialogTitle>
        <DialogContent dividers>
          <Autocomplete
            multiple
            options={linkCandidates.map((c) => c.artifact.id)}
            value={linking ?? []}
            onChange={(_e, next) => setLinking(next)}
            groupBy={(id) => linkCandidates.find((c) => c.artifact.id === id)?.owner ?? ''}
            getOptionLabel={(id) => {
              const c = linkCandidates.find((x) => x.artifact.id === id);
              return c ? `${c.artifact.title || c.artifact.fileName || 'Untitled'} (${c.artifact.evidenceType})` : id;
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Artifacts from other controls"
                helperText="A linked artifact counts toward this control's evidence types when its type matches."
              />
            )}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinking(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!linking?.length}
            onClick={() => {
              if (linking?.length) onLink?.(linking);
              setLinking(null);
            }}
          >
            Link
          </Button>
        </DialogActions>
      </Dialog>

      <ScriptArtifactDialog
        open={Boolean(scripting)}
        controlId={controlId}
        artifact={scripting?.artifact ?? null}
        evidenceRequired={evidenceRequired}
        currentUser={currentUser}
        onClose={() => setScripting(null)}
        onSave={(artifact) => {
          upsert(artifact);
          notify(`Saved script output for ${controlId}`, 'success');
        }}
      />
    </Stack>
  );
}
