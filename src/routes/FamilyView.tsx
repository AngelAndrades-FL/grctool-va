import { useMemo } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import {
  Box,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef, type GridRowParams } from '@mui/x-data-grid';
import { DateTime } from 'luxon';
import { useAppState } from '@/state/AppState';
import { useWorkspaceData } from '@/api/queries';
import { FilterSwitch } from '@/components/FilterSwitch';
import { isNodeInBaseline, type ControlNode } from '@/domain/catalogIndex';
import { baselineLabel, overlayDivergence } from '@/domain/baseline';
import { buildGapReport, computeCompleteness } from '@/domain/completeness';
import { rollupRecurring } from '@/domain/recurringRollup';
import { STATUS_LABEL as RECURRING_STATUS_LABEL, statusSeverity } from '@shared/recurring';
import { scoreColour, statusColour } from '@/theme';
import type { ImplementationStatus, RecurringStatus } from '@shared/types';

const STATUS_LABEL: Record<ImplementationStatus, string> = {
  not_started: 'Not started',
  planned: 'Planned',
  partially_implemented: 'Partial',
  implemented: 'Implemented',
  inherited: 'Inherited',
  not_applicable: 'N/A',
  alternative_implementation: 'Alternative',
};

interface Row {
  id: string;
  name: string;
  isEnhancement: boolean;
  types: string[];
  baseline: string;
  divergent: boolean;
  priority: string;
  designation: string;
  status: ImplementationStatus;
  completeness: number;
  artifacts: number;
  lastReviewed: string | null;
  nextReview: string | null;
  aiScore: number | null;
  gapCount: number;
  inBaseline: boolean;
  recurringCount: number;
  recurringStatus: RecurringStatus | null;
  recurringNextDue: string | null;
}

export function FamilyView() {
  const { familyId } = useParams({ from: '/family/$familyId' });
  const navigate = useNavigate();
  const { index, evidence, settings } = useWorkspaceData();
  const { baseline, mode, filters, setFilters } = useAppState();

  const family = index?.familyById.get(familyId);

  const rows = useMemo<Row[]>(() => {
    if (!index || !familyId) return [];
    const nodes: ControlNode[] = index.controlsByFamily.get(familyId) ?? [];

    return nodes
      .filter((node) => filters.showWithdrawn || node.status === 'active')
      .filter((node) => filters.showOutOfBaseline || isNodeInBaseline(node, baseline, mode))
      .map((node) => {
        const record = evidence[node.id];
        const gaps = buildGapReport(node, record, {
          staleAfterDays: settings?.evidenceStaleAfterDays ?? 365,
          lastAtoDate: settings?.lastAtoDate ?? null,
        });
        const latestAi = record?.aiEvaluations.at(-1);
        const recurring = rollupRecurring(record?.artifacts ?? [], settings?.recurringDueSoonDays ?? 30);
        return {
          id: node.id,
          name: node.name,
          isEnhancement: node.isEnhancement,
          types: node.controlTypes,
          baseline: baselineLabel(node.control, mode),
          divergent: overlayDivergence(node.control).length > 0,
          priority: node.priorityCode,
          designation: node.designation.replace(/_/g, ' '),
          status: record?.implementationStatus ?? 'not_started',
          completeness: computeCompleteness(node, record),
          artifacts: record?.artifacts.length ?? 0,
          lastReviewed: record?.dates.lastReviewedOn ?? null,
          nextReview: record?.dates.nextReviewDue ?? null,
          aiScore: latestAi?.score ?? null,
          gapCount: gaps.reasons.length,
          inBaseline: isNodeInBaseline(node, baseline, mode),
          recurringCount: recurring.count,
          recurringStatus: recurring.status,
          recurringNextDue: recurring.nextDue,
        };
      })
      .filter((row) => (filters.onlyGaps ? row.gapCount > 0 : true));
  }, [index, familyId, evidence, settings, baseline, mode, filters]);

  const columns = useMemo<GridColDef<Row>[]>(
    () => [
      {
        field: 'id',
        headerName: 'Control',
        width: 130,
        renderCell: (params) => (
          <Stack direction="row" spacing={0.75} sx={{ height: '100%', alignItems: 'center' }}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: params.row.isEnhancement ? 400 : 600,
                pl: params.row.isEnhancement ? 1.5 : 0,
                opacity: params.row.inBaseline ? 1 : 0.5,
              }}
            >
              {params.row.id}
            </Typography>
            {params.row.divergent && (
              <Tooltip title="VA overlay and 800-53B allocate this control differently">
                <Chip label="Δ" size="small" color="warning" variant="outlined" sx={{ height: 16, fontSize: 10 }} />
              </Tooltip>
            )}
          </Stack>
        ),
      },
      { field: 'name', headerName: 'Name', flex: 1, minWidth: 220 },
      {
        field: 'types',
        headerName: 'Type',
        width: 150,
        sortable: false,
        renderCell: (params) => (
          <Stack direction="row" spacing={0.5} sx={{ height: '100%', alignItems: 'center' }}>
            {params.row.types.map((t) => (
              <Chip key={t} label={t.slice(0, 5)} size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
            ))}
          </Stack>
        ),
      },
      { field: 'baseline', headerName: 'Baseline', width: 90 },
      { field: 'priority', headerName: 'Priority', width: 80 },
      { field: 'designation', headerName: 'Origination', width: 130 },
      {
        field: 'status',
        headerName: 'Status',
        width: 130,
        renderCell: (params) => (
          <Chip
            label={STATUS_LABEL[params.row.status]}
            size="small"
            sx={{ bgcolor: statusColour(params.row.status), color: '#fff', height: 20, fontSize: 11 }}
          />
        ),
      },
      {
        field: 'completeness',
        headerName: 'Complete',
        width: 120,
        renderCell: (params) => (
          <Stack sx={{ width: '100%', height: '100%', justifyContent: 'center' }} spacing={0.25}>
            <Typography variant="caption">{params.row.completeness}%</Typography>
            <LinearProgress
              variant="determinate"
              value={params.row.completeness}
              sx={{
                height: 4,
                borderRadius: 2,
                '& .MuiLinearProgress-bar': { bgcolor: scoreColour(params.row.completeness) },
              }}
            />
          </Stack>
        ),
      },
      { field: 'artifacts', headerName: 'Artifacts', width: 85, type: 'number' },
      {
        field: 'aiScore',
        headerName: 'AI',
        width: 70,
        renderCell: (params) =>
          params.row.aiScore === null ? (
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              —
            </Typography>
          ) : (
            <Chip
              label={params.row.aiScore}
              size="small"
              sx={{ bgcolor: scoreColour(params.row.aiScore), color: '#fff', height: 20, fontSize: 11 }}
            />
          ),
      },
      {
        field: 'lastReviewed',
        headerName: 'Last reviewed',
        width: 120,
        valueFormatter: (value: string | null) =>
          value ? DateTime.fromISO(value).toFormat('dd LLL yyyy') : '—',
      },
      {
        field: 'nextReview',
        headerName: 'Next due',
        width: 120,
        valueFormatter: (value: string | null) =>
          value ? DateTime.fromISO(value).toFormat('dd LLL yyyy') : '—',
      },
      {
        field: 'recurringStatus',
        headerName: 'Recurring evidence',
        width: 170,
        renderCell: (params) =>
          params.row.recurringStatus === null ? (
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              Not required
            </Typography>
          ) : (
            <Stack direction="row" spacing={0.5} sx={{ height: '100%', alignItems: 'center' }}>
              <Chip
                label={RECURRING_STATUS_LABEL[params.row.recurringStatus]}
                size="small"
                color={statusSeverity(params.row.recurringStatus)}
                sx={{ height: 20, fontSize: 11 }}
              />
              {params.row.recurringCount > 1 && (
                <Chip
                  label={`\u00d7${params.row.recurringCount}`}
                  size="small"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 11 }}
                />
              )}
            </Stack>
          ),
      },
      {
        field: 'recurringNextDue',
        headerName: 'Recurring due',
        width: 120,
        valueFormatter: (value: string | null) =>
          value ? DateTime.fromISO(value).toFormat('dd LLL yyyy') : '\u2014',
      },
      { field: 'gapCount', headerName: 'Gaps', width: 70, type: 'number' },
    ],
    [],
  );

  if (!family) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography sx={{ color: 'text.secondary' }}>Select a control family from the left.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h6">
            {family.family_id} — {family.family_name}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 900 }}>
            {family.family_description}
          </Typography>
        </Box>
        <Stack>
          <FilterSwitch
            label="Show out of baseline"
            checked={filters.showOutOfBaseline}
            onChange={(v) => setFilters({ showOutOfBaseline: v })}
            help="By default this family only lists controls allocated at your selected impact level and framework (set in the toolbar). Turn this on to also include controls that are not required there. Useful when weighing a move up a baseline, or comparing NIST 800-53B against the VA overlay, which allocate some controls differently. Out-of-baseline rows are dimmed, and their evidence is always kept but excluded from coverage metrics."
          />
          <FilterSwitch
            label="Show withdrawn"
            checked={filters.showWithdrawn}
            onChange={(v) => setFilters({ showWithdrawn: v })}
            help="Withdrawn controls are ones NIST has retired from the catalog, usually because they were folded into another control (AC-13, for example, was incorporated into AC-2 and AU-6). They can never be in scope at any baseline, so they are hidden by default. Turn this on when reconciling against an older SSP that still cites a withdrawn control, or to confirm evidence you captured previously is still on file."
          />
          <FilterSwitch
            label="Only with gaps"
            checked={filters.onlyGaps}
            onChange={(v) => setFilters({ onlyGaps: v })}
            help="Narrows the list to controls that still need work — a missing or thin narrative, no evidence artifacts, unanswered assessment objectives, blank organization-defined parameter values, or stale dates. Controls that are fully documented drop out of the list. Use the Gap report for the same view across every family at once."
          />
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ flexGrow: 1, minHeight: 0 }}>
        <DataGrid<Row>
          rows={rows}
          columns={columns}
          showToolbar
          density="compact"
          disableRowSelectionOnClick
          onRowClick={(params: GridRowParams<Row>) =>
            void navigate({ to: '/control/$controlId', params: { controlId: params.row.id } })
          }
          initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
          pageSizeOptions={[25, 50, 100]}
          getRowClassName={(params) => (params.row.inBaseline ? '' : 'out-of-baseline')}
          sx={{
            border: 0,
            '& .MuiDataGrid-row': { cursor: 'pointer' },
            '& .out-of-baseline': { opacity: 0.55 },
          }}
        />
      </Paper>
    </Box>
  );
}
