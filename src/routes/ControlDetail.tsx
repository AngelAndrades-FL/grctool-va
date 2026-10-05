import { useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import { Box, Chip, Divider, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { useAppState } from '@/state/AppState';
import { useWorkspaceData } from '@/api/queries';
import { isNodeInBaseline } from '@/domain/catalogIndex';
import { computeCompleteness } from '@/domain/completeness';
import { scoreColour } from '@/theme';
import { ReferencePane } from '@/components/ReferencePane';
import { EvidenceForm } from '@/components/EvidenceForm';
import { LinkChip } from '@/components/routerLinks';

/** Chips for the parent control and every sibling enhancement, so an assessor can walk the family. */
function EnhancementStrip({ controlId }: { controlId: string }) {
  const { index, evidence } = useWorkspaceData();
  const { baseline, mode, filters } = useAppState();

  const siblings = useMemo(() => {
    if (!index) return [];
    const node = index.nodeById.get(controlId);
    if (!node) return [];
    const parentId = node.parentId ?? node.id;
    const parent = index.nodeById.get(parentId);
    if (!parent) return [];
    const enhancements = (parent.control.control_enhancements ?? [])
      .map((e) => index.nodeById.get(e.enhancement_id))
      .filter((n): n is NonNullable<typeof n> => Boolean(n));
    return [parent, ...enhancements];
  }, [index, controlId]);

  if (siblings.length <= 1) return null;

  return (
    <Stack direction="row" spacing={0.75} sx={{ px: 2, py: 1, flexWrap: 'wrap', gap: 0.75 }}>
      {siblings.map((node) => {
        const inBaseline = isNodeInBaseline(node, baseline, mode);
        if (!inBaseline && !filters.showOutOfBaseline && node.id !== controlId) return null;
        const score = computeCompleteness(node, evidence[node.id]);
        return (
          <Tooltip key={node.id} title={`${node.name} — ${score}% complete`}>
            <LinkChip
              to="/control/$controlId"
              params={{ controlId: node.id }}
              clickable
              size="small"
              label={node.id}
              variant={node.id === controlId ? 'filled' : 'outlined'}
              color={node.id === controlId ? 'primary' : 'default'}
              sx={{
                height: 24,
                opacity: inBaseline ? 1 : 0.5,
                borderLeft: 3,
                borderLeftColor: scoreColour(score),
              }}
            />
          </Tooltip>
        );
      })}
    </Stack>
  );
}

export function ControlDetail() {
  const { controlId } = useParams({ from: '/control/$controlId' });
  const { index, evidence } = useWorkspaceData();
  const { baseline, mode } = useAppState();

  const node = index?.nodeById.get(controlId);

  if (!index) return null;

  if (!node) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography sx={{ color: 'text.secondary' }}>
          No control found for “{controlId}”.
        </Typography>
      </Box>
    );
  }

  const inBaseline = isNodeInBaseline(node, baseline, mode);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <EnhancementStrip controlId={node.id} />
      <Divider />
      {!inBaseline && (
        <Box sx={{ px: 2, py: 0.75, bgcolor: 'action.hover' }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {node.id} is not selected in the {baseline} baseline under{' '}
            {mode === 'va' ? 'the VA overlay' : 'NIST 800-53B'}. Evidence captured here is kept but excluded from
            coverage metrics.
          </Typography>
        </Box>
      )}

      <Box sx={{ display: 'flex', flexGrow: 1, minHeight: 0 }}>
        <Paper
          variant="outlined"
          square
          sx={{ width: '42%', minWidth: 380, flexShrink: 0, borderTop: 0, borderBottom: 0, borderLeft: 0 }}
        >
          <ReferencePane node={node} />
        </Paper>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          {/* Remount on control change so the form re-seeds from the new record. */}
          <EvidenceForm key={node.id} node={node} record={evidence[node.id]} />
        </Box>
      </Box>
    </Box>
  );
}
