import { useEffect, useState } from 'react';
import { Box, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import SaveIcon from '@mui/icons-material/Save';
import { DateTime, Info } from 'luxon';
import { RESPONSIBLE_ROLES, type AppSettings } from '@shared/types';
import { useSaveSettings, useSettings } from '@/api/queries';
import { useAppState } from '@/state/AppState';
import { atoMinDate } from '@/domain/completeness';
import { AiSettingsSection } from '@/components/AiSettingsSection';

const MONTHS = Info.months('long');

function isoToDate(value: string | null): DateTime | null {
  return value ? DateTime.fromISO(value) : null;
}

export function Settings() {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const { notify } = useAppState();
  const [draft, setDraft] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  if (!draft) return null;

  const patch = (update: Partial<AppSettings>) => setDraft({ ...draft, ...update });

  const handleSave = () => {
    saveSettings.mutate(draft, {
      onSuccess: () => notify('Settings saved', 'success'),
      onError: (error) => notify(error instanceof Error ? error.message : 'Save failed', 'error'),
    });
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>
      <Stack spacing={3} sx={{ flex: 1, minWidth: 0, width: '100%' }}>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            System identity
          </Typography>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="System name"
              fullWidth
              value={draft.systemName}
              onChange={(e) => patch({ systemName: e.target.value })}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="System id"
                fullWidth
                value={draft.systemId}
                onChange={(e) => patch({ systemId: e.target.value })}
              />
              <TextField
                label="Organization"
                fullWidth
                value={draft.organization}
                onChange={(e) => patch({ organization: e.target.value })}
              />
            </Stack>
            <TextField
              label="Current user"
              value={draft.currentUser}
              onChange={(e) => patch({ currentUser: e.target.value })}
            />
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Authorization dates
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            The last ATO date is the basis date for the whole workspace: evidence dated before it is flagged as
            stale, and every evidence date picker refuses to go earlier than it.
          </Typography>
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
            <DatePicker
              label="Last ATO date"
              value={isoToDate(draft.lastAtoDate)}
              onChange={(value) => patch({ lastAtoDate: value?.isValid ? value.toISODate() : null })}
              slotProps={{ textField: { size: 'small', sx: { minWidth: 200 } }, field: { clearable: true } }}
            />
            <DatePicker
              label="Next ATO due"
              value={isoToDate(draft.nextAtoDate)}
              onChange={(value) => patch({ nextAtoDate: value?.isValid ? value.toISODate() : null })}
              minDate={atoMinDate(draft.lastAtoDate)}
              slotProps={{ textField: { size: 'small', sx: { minWidth: 200 } }, field: { clearable: true } }}
            />
            <TextField
              label="Evidence stale after (days)"
              type="number"
              size="small"
              sx={{ minWidth: 200 }}
              value={draft.evidenceStaleAfterDays}
              onChange={(e) => patch({ evidenceStaleAfterDays: Number(e.target.value) || 0 })}
            />
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Recurring evidence
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            Controls the cycle labels applied to recurring evidence and how far ahead a recurring artifact is flagged
            as due soon.
          </Typography>
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
            <TextField
              select
              label="Due soon threshold"
              size="small"
              sx={{ minWidth: 200 }}
              value={draft.recurringDueSoonDays}
              onChange={(e) => patch({ recurringDueSoonDays: Number(e.target.value) })}
            >
              {[30, 60, 90].map((days) => (
                <MenuItem key={days} value={days}>
                  {days} days before due
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Cycle labels"
              size="small"
              sx={{ minWidth: 200 }}
              value={draft.cycleBasis}
              onChange={(e) => patch({ cycleBasis: e.target.value as AppSettings['cycleBasis'] })}
            >
              <MenuItem value="fiscal">Fiscal year (FY2026)</MenuItem>
              <MenuItem value="calendar">Calendar year (2026)</MenuItem>
            </TextField>
            <TextField
              select
              label="Fiscal year starts"
              size="small"
              disabled={draft.cycleBasis !== 'fiscal'}
              sx={{ minWidth: 200 }}
              value={draft.fiscalYearStartMonth}
              onChange={(e) => patch({ fiscalYearStartMonth: Number(e.target.value) })}
            >
              {MONTHS.map((month, i) => (
                <MenuItem key={month} value={i + 1}>
                  {month}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </Paper>
      </Stack>

        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          <Stack spacing={3}>
            <AiSettingsSection value={draft.ai} onChange={(ai) => patch({ ai })} />
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Responsible role contacts
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                Default name and email for each role. Choosing a role on a control fills in these values.
              </Typography>
              <Stack spacing={2}>
                {RESPONSIBLE_ROLES.map((role) => {
                  const contact = draft.roleContacts?.[role.id] ?? { name: '', email: '' };
                  const update = (change: Partial<typeof contact>) =>
                    patch({ roleContacts: { ...draft.roleContacts, [role.id]: { ...contact, ...change } } });
                  return (
                    <Box key={role.id}>
                      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                        {role.label}
                      </Typography>
                      <Stack direction="row" spacing={2}>
                        <TextField
                          size="small"
                          fullWidth
                          label="Name"
                          value={contact.name}
                          onChange={(e) => update({ name: e.target.value })}
                        />
                        <TextField
                          size="small"
                          fullWidth
                          label="Email"
                          type="email"
                          value={contact.email}
                          onChange={(e) => update({ email: e.target.value })}
                        />
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            </Paper>
          </Stack>
        </Box>
      </Stack>

        <Box>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={saveSettings.isPending}
          >
            Save settings
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}
