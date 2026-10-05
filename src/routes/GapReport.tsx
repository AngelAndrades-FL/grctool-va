import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Alert,
  Box,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef, type GridRowParams } from '@mui/x-data-grid';
import { useAppState } from '@/state/AppState';
import { useWorkspaceData } from '@/api/queries';
import { FilterSwitch } from '@/components/FilterSwitch';
import { isNodeInBaseline } from '@/domain/catalogIndex';
import { buildGapReport, computeCompleteness } from '@/domain/completeness';
import { scoreColour, statusColour } from '@/theme';
import type { ImplementationStatus } from '@shared/types';

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
  familyId: string;
  familyName: string;
  isEnhancement: boolean;
  status: ImplementationStatus;
  completeness: number;
  stale: boolean;
  staleByDays: number | null;
  reasons: string[];
  gapCount: number;
  inBaseline: boolean;
}

export function GapReport() {  const navigate = useNavigate();
  const { index, evidence, settings } = useWorkspaceData();
  const { baseline, mode, filters, setFilters } = useAppState();

  const rows = useMemo<Row[]>(() => {
    if (!index) return [];

    return index.nodes
      .filter((node) => filters.showWithdrawn || node.status === 'active')
      .filter((node) => filters.showOutOfBaseline || isNodeInBaseline(node, baseline, mode))
      .map((node) => {
        const record = evidence[node.id];
        const gaps = buildGapReport(node, record, {
          staleAfterDays: settings?.evidenceStaleAfterDays ?? 365,
          lastAtoDate: settings?.lastAtoDate ?? null,
        });
        return {
          id: node.id,
          name: node.name,
          familyId: node.familyId,
          familyName: node.familyName,
          isEnhancement: node.isEnhancement,
          status: record?.implementationStatus ?? 'not_started',
          completeness: computeCompleteness(node, record),
          stale: gaps.stale,
          staleByDays: gaps.staleByDays,
          reasons: gaps.reasons,
          gapCount: gaps.reasons.length,
          inBaseline: isNodeInBaseline(node, baseline, mode),
        };
      })
      .filter((row) => row.gapCount > 0)
      .filter((row) => !filters.onlyStale || row.stale)
      .sort((a, b) => a.completeness - b.completeness);
  }, [index, evidence, settings, baseline, mode, filters]);

  const columns = useMemo<GridColDef<Row>[]>(
    () => [
      {
        field: 'id',
        headerName: 'Control',
        width: 130,
        renderCell: (params) => (
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
        ),
      },
      { field: 'familyId', headerName: 'Family', width: 90 },
      { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
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
      {
        field: 'stale',
        headerName: 'Stale',
        width: 90,
        renderCell: (params) =>
          params.row.stale ? (
            <Chip
              label={params.row.staleByDays !== null ? `${params.row.staleByDays}d` : 'pre-ATO'}
              size="small"
              color="warning"
              variant="outlined"
              sx={{ height: 20, fontSize: 11 }}
            />
          ) : null,
      },
      {
        field: 'reasons',
        headerName: 'Gap reasons',
        flex: 1.5,
        minWidth: 280,
        sortable: false,
        renderCell: (params) => (
          <Tooltip title={<Box component="ul" sx={{ m: 0, pl: 2 }}>{params.row.reasons.map((r) => <li key={r}>{r}</li>)}</Box>}>
            <Typography variant="caption" noWrap sx={{ display: 'block' }}>
              {params.row.reasons.join(' · ')}
            </Typography>
          </Tooltip>
        ),
      },
      { field: 'gapCount', headerName: 'Gaps', width: 70, type: 'number' },
    ],
    [],
  );

  const staleCount = rows.filter((r) => r.stale).length;

  return (
    <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h6">Gap report</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Every in-baseline control with missing narrative, evidence, objectives, ODP values or stale dates.
          </Typography>
        </Box>
        <Stack>
          <FilterSwitch
            label="Show out of baseline"
            checked={filters.showOutOfBaseline}
            onChange={(v) => setFilters({ showOutOfBaseline: v })}
            help="By default this report only lists controls allocated at your selected impact level and framework (set in the toolbar). Turn this on to also include controls that are not required there — they will show gaps simply because you have never worked them. Useful when weighing a move up a baseline, or comparing NIST 800-53B against the VA overlay, which allocate some controls differently. Out-of-baseline rows are dimmed, and their evidence is always kept but excluded from coverage metrics."
          />
          <FilterSwitch
            label="Show withdrawn"
            checked={filters.showWithdrawn}
            onChange={(v) => setFilters({ showWithdrawn: v })}
            help="Withdrawn controls are ones NIST has retired from the catalog, usually because they were folded into another control (AC-13, for example, was incorporated into AC-2 and AU-6). They can never be in scope at any baseline, so they are hidden by default. Turn this on when reconciling against an older SSP that still cites a withdrawn control, or to confirm evidence you captured previously is still on file."
          />
          <FilterSwitch
            label="Only stale evidence"
            checked={filters.onlyStale}
            onChange={(v) => setFilters({ onlyStale: v })}
            help={`Narrows the report to controls whose evidence is out of date, ignoring every other kind of gap. Evidence counts as stale when its "evidence as of" date (or last reviewed date, if that is blank) is more than ${settings?.evidenceStaleAfterDays ?? 365} days old, or falls before your last ATO date. Both thresholds are set in Settings. Controls with no date recorded at all are not counted as stale — they show up as ordinary gaps instead.`}
          />
        </Stack>
      </Stack>

      {rows.length === 0 ? (
        <Alert severity="success">No gaps found for the current baseline and filters.</Alert>
      ) : (
        <Alert severity="warning" sx={{ py: 0 }}>
          {rows.length} control{rows.length === 1 ? '' : 's'} with gaps, {staleCount} with stale evidence.
        </Alert>
      )}

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
