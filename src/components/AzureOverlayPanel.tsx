import { useState } from 'react';
import { Box, Button, Chip, Collapse, Paper, Stack, Typography } from '@mui/material';
import type { AzureOverlay, EvidenceRecord } from '@shared/types';
import { AZURE_HELP, AZURE_LABEL, AZURE_ORIGINATION, isAutomatedPolicy } from '@/domain/azureOverlay';

/** Azure Policy overlay for one control: ownership, the origination it implies, and the mapped policies. */
export function AzureOverlayPanel({
  overlay,
  origination,
  applied,
  onApply,
  onUndo,
}: {
  overlay: AzureOverlay;
  origination: EvidenceRecord['origination'];
  applied: boolean;
  onApply: () => void;
  onUndo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const target = AZURE_ORIGINATION[overlay.ownership];
  const automated = overlay.policies.filter((p) => isAutomatedPolicy(p.effects));

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="subtitle2">Azure overlay</Typography>
        <Chip label={AZURE_LABEL[overlay.ownership]} size="small" variant="outlined" />
        <Typography variant="caption" sx={{ color: 'text.secondary', flexGrow: 1 }}>
          {overlay.policies.length} policy definition(s), {automated.length} evaluated by Azure
        </Typography>
        <Button size="small" disabled={origination === target} onClick={onApply}>
          {origination === target ? 'Applied' : `Apply (${target.replace(/_/g, ' ')})`}
        </Button>
        {applied && (
          <Button size="small" color="warning" onClick={onUndo}>
            Undo
          </Button>
        )}
        {overlay.policies.length > 0 && (
          <Button size="small" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide policies' : 'Show policies'}
          </Button>
        )}
      </Stack>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
        {AZURE_HELP[overlay.ownership]}
      </Typography>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          {overlay.policies.map((policy) => (
            <Box key={policy.id}>
              <Typography variant="body2">
                {policy.name}
                <Chip label={policy.effects} size="small" variant="outlined" sx={{ height: 18, fontSize: 10, ml: 1 }} />
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {policy.description}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Collapse>
    </Paper>
  );
}
