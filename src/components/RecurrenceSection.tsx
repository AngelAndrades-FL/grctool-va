import { DateTime } from 'luxon';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  Link,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import UnarchiveOutlinedIcon from '@mui/icons-material/UnarchiveOutlined';
import { RECURRING_FREQUENCIES, type Artifact, type RecurringFrequency } from '@shared/types';
import {
  FREQUENCY_LABEL,
  STATUS_LABEL,
  artifactCycleLabel,
  cyclesBeyondRetention,
  hasEvidence,
  newRecurrence,
  nextDueDate,
  recurringStatus,
  startNewCycle,
  statusSeverity,
} from '@shared/recurring';
import { api } from '@/api/client';
import { useSettings } from '@/api/queries';
import { cycleSettingsOf } from '@/domain/recurringRollup';

export interface RecurrenceSectionProps {
  artifact: Artifact;
  onChange: (artifact: Artifact) => void;
  currentUser: string;
  /** Set when a new cycle is collected some other way (e.g. re-running a script). */
  newCycleHint?: string;
}

/** Optional cadence facet of an artifact: frequency, retention, and the history of earlier cycles. */
export function RecurrenceSection({ artifact, onChange, currentUser, newCycleHint }: RecurrenceSectionProps) {
  const { data: settings } = useSettings();
  const cycleSettings = cycleSettingsOf(settings);
  const recurrence = artifact.recurrence;

  const toggle = (enabled: boolean) => {
    if (enabled) {
      onChange({ ...artifact, recurrence: newRecurrence() });
      return;
    }
    if (
      recurrence?.history.length &&
      !window.confirm(
        `Stop tracking this artifact as recurring? The ${recurrence.history.length} earlier cycle(s) will no longer be listed (their files stay in the workspace).`,
      )
    ) {
      return;
    }
    const { recurrence: _removed, ...rest } = artifact;
    onChange(rest);
  };

  const header = (
    <FormControlLabel
      control={<Switch checked={Boolean(recurrence)} onChange={(e) => toggle(e.target.checked)} />}
      label={
        <Box>
          <Typography variant="body2">Recurring evidence</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Re-collected on a cadence; earlier cycles are kept, never overwritten.
          </Typography>
        </Box>
      }
    />
  );

  if (!recurrence) return header;

  const patch = (update: Partial<typeof recurrence>) => onChange({ ...artifact, recurrence: { ...recurrence, ...update } });
  const status = recurringStatus(artifact, settings?.recurringDueSoonDays ?? 30);
  const due = nextDueDate(artifact);
  const currentLabel = artifactCycleLabel(artifact, cycleSettings);
  const beyond = cyclesBeyondRetention(artifact, cycleSettings);
  const setArchived = (id: string, archived: boolean) =>
    patch({ history: recurrence.history.map((c) => (c.id === id ? { ...c, archived } : c)) });

  return (
    <Stack spacing={1.5}>
      {header}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
            <Chip label={STATUS_LABEL[status]} size="small" color={statusSeverity(status)} sx={{ height: 20, fontSize: 11 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {currentLabel ? `Current cycle ${currentLabel}` : 'No evidence for the current cycle yet'}
              {' · '}Next due {due ?? (recurrence.frequencyType === 'org_defined' ? 'organization-defined' : '—')}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              select
              size="small"
              label="Frequency"
              sx={{ minWidth: 180 }}
              value={recurrence.frequencyType}
              onChange={(e) => patch({ frequencyType: e.target.value as RecurringFrequency })}
            >
              {RECURRING_FREQUENCIES.map((f) => (
                <MenuItem key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              type="number"
              label="Retention (cycles)"
              helperText="Including the current cycle"
              sx={{ width: 170 }}
              value={recurrence.retentionPeriods}
              onChange={(e) => patch({ retentionPeriods: Math.max(1, Number(e.target.value) || 1) })}
            />
            <TextField
              size="small"
              fullWidth
              label="Frequency detail"
              placeholder='e.g. "every 365 days" or "per FISMA minimum"'
              required={recurrence.frequencyType === 'org_defined'}
              value={recurrence.frequencyDetail}
              onChange={(e) => patch({ frequencyDetail: e.target.value })}
            />
          </Stack>

          <TextField
            size="small"
            fullWidth
            multiline
            minRows={1}
            label="Recurrence notes"
            value={recurrence.notes}
            onChange={(e) => patch({ notes: e.target.value })}
          />

          {hasEvidence(artifact) &&
            (newCycleHint ? (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {newCycleHint}
              </Typography>
            ) : (
              <Box>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AutorenewIcon />}
                  onClick={() => onChange(startNewCycle(artifact, cycleSettings, currentUser))}
                >
                  Start new collection cycle
                </Button>
                <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
                  Moves {currentLabel ?? 'the current evidence'} into history so you can add this cycle&apos;s evidence.
                </Typography>
              </Box>
            ))}

          {beyond.length > 0 && (
            <Alert severity="info" sx={{ py: 0 }}>
              {beyond.length} cycle(s) beyond the {recurrence.retentionPeriods}-cycle retention window ({beyond.join(', ')}).
              Archive them if they are no longer needed — nothing is removed automatically.
            </Alert>
          )}

          {recurrence.history.length > 0 && (
            <Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                Earlier cycles
              </Typography>
              <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                {recurrence.history.map((cycle) => (
                  <Stack
                    key={cycle.id}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', opacity: cycle.archived ? 0.55 : 1 }}
                  >
                    <Chip label={cycle.cycleLabel} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                    <Typography variant="caption" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                      {cycle.fileName?.split('__').slice(2).join('__') || cycle.fileName || cycle.url || 'Recorded content'}
                      {cycle.collectedAt ? ` · ${DateTime.fromISO(cycle.collectedAt).toISODate()}` : ''}
                      {cycle.collectedBy ? ` · ${cycle.collectedBy}` : ''}
                    </Typography>
                    {cycle.archived && <Chip label="archived" size="small" sx={{ height: 18, fontSize: 10 }} />}
                    {cycle.filePath && (
                      <Link
                        component="button"
                        type="button"
                        variant="caption"
                        onClick={() => void api.revealAttachment(cycle.filePath!)}
                      >
                        Show in folder
                      </Link>
                    )}
                    <Tooltip title={cycle.archived ? 'Restore' : 'Archive (keeps the file)'}>
                      <IconButton size="small" onClick={() => setArchived(cycle.id, !cycle.archived)}>
                        {cycle.archived ? (
                          <UnarchiveOutlinedIcon fontSize="small" />
                        ) : (
                          <Inventory2OutlinedIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                  </Stack>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
