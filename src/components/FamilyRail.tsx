import { useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import {
  Box,
  Chip,
  Divider,
  LinearProgress,
  List,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useAppState } from '@/state/AppState';
import { useWorkspaceData } from '@/api/queries';
import { isNodeInBaseline } from '@/domain/catalogIndex';
import { computeCompleteness } from '@/domain/completeness';
import { LinkListItemButton } from './routerLinks';

interface FamilyStat {
  id: string;
  name: string;
  inBaseline: number;
  complete: number;
  progress: number;
}

export function FamilyRail() {
  const { index, evidence } = useWorkspaceData();
  const { baseline, mode } = useAppState();
  const { familyId } = useParams({ strict: false });

  const stats = useMemo<FamilyStat[]>(() => {
    if (!index) return [];
    return index.families.map((family) => {
      const nodes = (index.controlsByFamily.get(family.family_id) ?? []).filter((node) =>
        isNodeInBaseline(node, baseline, mode),
      );
      const complete = nodes.filter((node) => computeCompleteness(node, evidence[node.id]) >= 80).length;
      return {
        id: family.family_id,
        name: family.family_name,
        inBaseline: nodes.length,
        complete,
        progress: nodes.length === 0 ? 0 : (complete / nodes.length) * 100,
      };
    });
  }, [index, evidence, baseline, mode]);

  return (
    <Box sx={{ width: 268, flexShrink: 0, borderRight: 1, borderColor: 'divider', overflowY: 'auto' }}>
      <Stack spacing={0.5} sx={{ px: 2, pt: 2, pb: 1 }}>
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>
          Control families
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {baseline === 'All' ? 'All controls' : `${baseline} baseline`} ·{' '}
          {mode === 'va' ? 'VA overlay' : 'NIST 800-53B'}
        </Typography>
      </Stack>
      <Divider />
      <List dense disablePadding>
        {stats.map((stat) => (
          <LinkListItemButton
            key={stat.id}
            to="/family/$familyId"
            params={{ familyId: stat.id }}
            selected={familyId === stat.id}
            sx={{ alignItems: 'flex-start', py: 1 }}
          >
            <ListItemText
              disableTypography
              primary={
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                    {stat.id}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${stat.complete}/${stat.inBaseline}`}
                    sx={{ height: 20, fontSize: 11 }}
                  />
                </Stack>
              }
              secondary={
                <Box sx={{ mt: 0.25 }}>
                  <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.secondary' }}>
                    {stat.name}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={stat.progress}
                    sx={{ mt: 0.75, height: 4, borderRadius: 2 }}
                  />
                </Box>
              }
            />
          </LinkListItemButton>
        ))}
      </List>
    </Box>
  );
}
