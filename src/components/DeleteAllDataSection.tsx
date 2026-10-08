import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { api } from '@/api/client';
import { queryKeys, useEvidence } from '@/api/queries';
import { useAppState } from '@/state/AppState';
import { LinkButton } from './routerLinks';

const CONFIRM_WORD = 'DELETE';

/** Destructive reset of attachments and control data; settings, roles and the catalog are kept. */
export function DeleteAllDataSection() {
  const client = useQueryClient();
  const { data: evidence } = useEvidence();
  const { notify } = useAppState();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const controls = Object.keys(evidence ?? {}).length;

  const close = () => {
    if (busy) return;
    setOpen(false);
    setTyped('');
  };

  const wipe = async () => {
    setBusy(true);
    try {
      const result = await api.wipeControlData(typed);
      await client.invalidateQueries({ queryKey: queryKeys.evidence });
      notify(`Deleted ${result.recordsDeleted} control record(s) and ${result.filesDeleted} attachment file(s)`, 'success');
      setOpen(false);
      setTyped('');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Deletion failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3, borderColor: 'error.main' }}>
      <Typography variant="h6" color="error" gutterBottom>
        Delete all attachments and control data
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Permanently removes every attachment file and everything recorded against every control, so the workspace starts
        empty. Settings, responsible roles, the AI connection and the control catalog are kept. Export an OSCAL SSP
        package first if you may need this data again.
      </Typography>
      <Button color="error" variant="outlined" startIcon={<DeleteForeverIcon />} onClick={() => setOpen(true)}>
        Delete all attachments and control data…
      </Button>

      <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>Delete all attachments and control data?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Alert severity="error">
              This is destructive and cannot be undone. It deletes every attachment file and all data entered for{' '}
              {controls} control(s): narratives, status, organization-defined values, artifacts, POA&amp;M entries,
              review dates and change history.
            </Alert>
            <Alert
              severity="warning"
              action={
                <LinkButton color="inherit" size="small" to="/export" onClick={close}>
                  Go to Export
                </LinkButton>
              }
            >
              Export an OSCAL SSP package before continuing. It is the only way to get this data back.
            </Alert>
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Type <strong>{CONFIRM_WORD}</strong> to confirm.
              </Typography>
              <TextField
                autoFocus
                fullWidth
                size="small"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={CONFIRM_WORD}
                disabled={busy}
              />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button color="error" variant="contained" disabled={typed !== CONFIRM_WORD || busy} onClick={() => void wipe()}>
            {busy ? 'Deleting…' : 'Delete everything'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
