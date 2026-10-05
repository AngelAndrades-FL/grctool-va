import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Alert,
  Box,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef, type GridRowParams } from '@mui/x-data-grid';
import { BarChart } from '@mui/x-charts/BarChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { Gauge, gaugeClasses } from '@mui/x-charts/Gauge';
import { DateTime } from 'luxon';
import type { ImplementationStatus } from '@shared/types';
import { useWorkspaceData } from '@/api/queries';
import { useAppState } from '@/state/AppState';
import { isNodeInBaseline } from '@/domain/catalogIndex';
import { buildGapReport, computeCompleteness, evidenceTypeCoverage, isDocumentedNa } from '@/domain/completeness';
import { allRecurringRows } from '@/domain/recurringRollup';
import { STATUS_LABEL as RECURRING_STATUS_LABEL, statusSeverity } from '@shared/recurring';
import { scoreColour, statusColour } from '@/theme';

const STATUS_LABEL: Record<ImplementationStatus, string> = {
  not_started: 'Not started',
  planned: 'Planned',
  partially_implemented: 'Partial',
  implemented: 'Implemented',
  inherited: 'Inherited',
  not_applicable: 'N/A',
  alternative_implementation: 'Alternative',
};

const COMPLETE_THRESHOLD = 80;

interface MissingEvidenceRow {
  id: string;
  name: string;
  familyId: string;
  status: ImplementationStatus;
  completeness: number;
  artifacts: number;
  missingTypes: string;
  missingCount: number;
}

function StatCard({
  label,
  value,
  caption,
  colour,
}: {
  label: string;
  value: string;
  caption?: string;
  colour?: string;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Typography variant="overline" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="h4" sx={{ fontWeight: 600, color: colour ?? 'text.primary', lineHeight: 1.2 }}>
        {value}
      </Typography>
      {caption && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {caption}
        </Typography>
      )}
    </Paper>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Typography variant="subtitle2">{title}</Typography>
      {subtitle && (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
          {subtitle}
        </Typography>
      )}
      {children}
    </Paper>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { index, evidence, settings, isLoading } = useWorkspaceData();
  const { baseline, mode } = useAppState();

  const stats = useMemo(() => {
    if (!index) return null;

    const nodes = index.nodes.filter((node) => isNodeInBaseline(node, baseline, mode));
    const staleAfterDays = settings?.evidenceStaleAfterDays ?? 365;
    const lastAtoDate = settings?.lastAtoDate ?? null;

    const statusCounts = new Map<ImplementationStatus, number>();
    const familyTotals = new Map<string, { complete: number; incomplete: number }>();
    const missingEvidence: MissingEvidenceRow[] = [];
    const reviewBuckets = { overdue: 0, in30: 0, in90: 0, later: 0, unscheduled: 0 };

    let complete = 0;
    let notStarted = 0;
    let stale = 0;
    let openFindings = 0;
    let scoreTotal = 0;
    let notApplicable = 0;
    let naMissingRationale = 0;

    for (const node of nodes) {
      const record = evidence[node.id];
      const status = record?.implementationStatus ?? 'not_started';
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
      if (status === 'not_applicable') {
        notApplicable += 1;
        if (!isDocumentedNa(record)) naMissingRationale += 1;
      }
      // Documented N/A controls are out of every coverage, gap, staleness and review metric.
      if (isDocumentedNa(record)) continue;

      const score = computeCompleteness(node, record);
      const gaps = buildGapReport(node, record, { staleAfterDays, lastAtoDate });

      scoreTotal += score;
      if (score >= COMPLETE_THRESHOLD) complete += 1;
      if (!record || status === 'not_started') notStarted += 1;
      if (gaps.stale) stale += 1;
      if (record?.poam.hasFinding) openFindings += 1;

      const bucket = familyTotals.get(node.familyId) ?? { complete: 0, incomplete: 0 };
      if (score >= COMPLETE_THRESHOLD) bucket.complete += 1;
      else bucket.incomplete += 1;
      familyTotals.set(node.familyId, bucket);

      const coverage = evidenceTypeCoverage(node, record);
      const artifacts = record?.artifacts.length ?? 0;
      if (coverage.missing.length > 0 || (node.evidenceRequired.length === 0 && artifacts === 0)) {
        missingEvidence.push({
          id: node.id,
          name: node.name,
          familyId: node.familyId,
          status,
          completeness: score,
          artifacts,
          missingTypes: coverage.missing.join(', ') || 'No artifacts attached',
          missingCount: coverage.missing.length,
        });
      }

      const due = record?.dates.nextReviewDue;
      if (!due) reviewBuckets.unscheduled += 1;
      else {
        const days = Math.ceil(DateTime.fromISO(due).diffNow('days').days);
        if (days < 0) reviewBuckets.overdue += 1;
        else if (days <= 30) reviewBuckets.in30 += 1;
        else if (days <= 90) reviewBuckets.in90 += 1;
        else reviewBuckets.later += 1;
      }
    }

    const daysToAto = settings?.nextAtoDate
      ? Math.ceil(DateTime.fromISO(settings.nextAtoDate).diffNow('days').days)
      : null;

    const applicable = nodes.length - (notApplicable - naMissingRationale);

    return {
      total: applicable,
      notApplicable,
      naMissingRationale,
      complete,
      incomplete: applicable - complete,
      notStarted,
      stale,
      openFindings,
      averageScore: applicable === 0 ? 0 : Math.round(scoreTotal / applicable),
      coveragePercent: applicable === 0 ? 0 : Math.round((complete / applicable) * 100),
      daysToAto,
      statusCounts,
      familyTotals,
      // Worst-covered families first: that is where the remaining work actually is.
      familyRows: [...familyTotals.entries()]
        .map(([familyId, v]) => ({ familyId, ...v }))
        .filter((f) => f.incomplete > 0)
        .sort((a, b) => b.incomplete - a.incomplete)
        .slice(0, 12),
      missingEvidence: missingEvidence.sort((a, b) => a.completeness - b.completeness),
      reviewBuckets,
    };
  }, [index, evidence, settings, baseline, mode]);

  const recurring = useMemo(() => {
    const rows = allRecurringRows(evidence, settings);
    return {
      rows,
      overdue: rows.filter((r) => r.status === 'overdue').length,
      dueSoon: rows.filter((r) => r.status === 'due_soon').length,
      missing: rows.filter((r) => r.status === 'no_evidence_on_file').length,
      current: rows.filter((r) => r.status === 'current').length,
      upcoming: rows.filter((r) => r.status !== 'current').slice(0, 8),
    };
  }, [evidence, settings]);

  const columns = useMemo<GridColDef<MissingEvidenceRow>[]>(
    () => [
      { field: 'id', headerName: 'Control', width: 120 },
      { field: 'familyId', headerName: 'Family', width: 90 },
      { field: 'name', headerName: 'Name', flex: 1, minWidth: 180 },
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
        width: 110,
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
        field: 'missingTypes',
        headerName: 'Missing evidence',
        flex: 1.4,
        minWidth: 220,
        sortable: false,
        renderCell: (params) => (
          <Tooltip title={params.row.missingTypes}>
            <Typography variant="caption" noWrap sx={{ display: 'block' }}>
              {params.row.missingTypes}
            </Typography>
          </Tooltip>
        ),
      },
    ],
    [],
  );

  if (isLoading || !stats) {
    return (
      <Box sx={{ p: 3 }}>
        <LinearProgress />
      </Box>
    );
  }

  const atoColour =
    stats.daysToAto === null
      ? undefined
      : stats.daysToAto < 0
        ? '#ef5350'
        : stats.daysToAto <= 60
          ? '#ef5350'
          : stats.daysToAto <= 180
            ? '#ffa726'
            : '#43a047';

  const statusSlices = [...stats.statusCounts.entries()]
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({
      id: status,
      value: count,
      label: STATUS_LABEL[status],
      color: statusColour(status),
    }));

  return (
    <Box sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6">Dashboard</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            NIST SP 800-53 Rev 5 ·{' '}
            {baseline === 'All' ? 'All controls' : `${baseline} baseline`} ·{' '}
            {mode === 'va' ? 'VA 6500 overlay' : 'NIST 800-53B'} · {stats.total} applicable controls
            {stats.notApplicable > 0 && ` · ${stats.notApplicable} not applicable`}
          </Typography>
        </Box>

        {stats.daysToAto !== null && stats.daysToAto <= 180 && (
          <Alert severity={stats.daysToAto <= 60 ? 'error' : 'warning'} sx={{ py: 0 }}>
            {stats.daysToAto < 0
              ? `Authorization expired ${Math.abs(stats.daysToAto)} days ago.`
              : `Next ATO in ${stats.daysToAto} days.`}{' '}
            {stats.incomplete} control{stats.incomplete === 1 ? '' : 's'} are still below{' '}
            {COMPLETE_THRESHOLD}% completeness.
          </Alert>
        )}

        <Grid container spacing={2}>
          <Grid size={12}>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' } }}>
            <StatCard
              label="Days to next ATO"
              value={stats.daysToAto === null ? '—' : String(stats.daysToAto)}
              caption={settings?.nextAtoDate ?? 'Set the next ATO date in Settings'}
              colour={atoColour}
            />
            <StatCard
              label="Controls complete"
              value={`${stats.complete} / ${stats.total}`}
              caption={`${stats.incomplete} below ${COMPLETE_THRESHOLD}% · ${stats.notStarted} not started`}
              colour={scoreColour(stats.coveragePercent)}
            />
            <StatCard
              label="Not applicable"
              value={String(stats.notApplicable)}
              caption={
                stats.naMissingRationale > 0
                  ? `${stats.naMissingRationale} still need a rationale (see Gaps)`
                  : 'Excluded from coverage; rationale documented'
              }
              colour={stats.naMissingRationale > 0 ? '#ffa726' : undefined}
            />
            <StatCard
              label="Stale evidence"
              value={String(stats.stale)}
              caption={`Older than ${settings?.evidenceStaleAfterDays ?? 365} days or predating the last ATO`}
              colour={stats.stale > 0 ? '#ffa726' : '#43a047'}
            />
            <StatCard
              label="Open findings"
              value={String(stats.openFindings)}
              caption="Controls carrying an open POA&M item"
              colour={stats.openFindings > 0 ? '#ef5350' : '#43a047'}
            />
            </Box>
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <ChartCard
              title="Overall coverage"
              subtitle={`Controls at ${COMPLETE_THRESHOLD}%+ completeness`}
            >
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
                <Gauge
                  width={200}
                  height={180}
                  value={stats.coveragePercent}
                  startAngle={-110}
                  endAngle={110}
                  text={({ value }) => `${value}%`}
                  sx={{
                    [`& .${gaugeClasses.valueText}`]: { fontSize: 28, fontWeight: 600 },
                    [`& .${gaugeClasses.valueArc}`]: { fill: scoreColour(stats.coveragePercent) },
                  }}
                />
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', textAlign: 'center' }}>
                Average completeness across all applicable controls: {stats.averageScore}%
              </Typography>
            </ChartCard>
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            <ChartCard title="Implementation status" subtitle="Every applicable control by recorded status, plus those marked N/A">
              <PieChart
                height={230}
                series={[
                  {
                    data: statusSlices,
                    innerRadius: 50,
                    paddingAngle: 2,
                    cornerRadius: 3,
                    highlightScope: { fade: 'global', highlight: 'item' },
                  },
                ]}
              />
            </ChartCard>
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            <ChartCard
              title="Families needing the most work"
              subtitle={`Controls above and below ${COMPLETE_THRESHOLD}% completeness`}
            >
              <BarChart
                height={280}
                xAxis={[{ data: stats.familyRows.map((f) => f.familyId), scaleType: 'band' }]}
                series={[
                  {
                    data: stats.familyRows.map((f) => f.complete),
                    label: 'Complete',
                    stack: 'total',
                    color: '#43a047',
                  },
                  {
                    data: stats.familyRows.map((f) => f.incomplete),
                    label: 'Incomplete',
                    stack: 'total',
                    color: '#ef5350',
                  },
                ]}
              />
            </ChartCard>
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <ChartCard title="Review schedule" subtitle="When the next review falls due">
              <BarChart
                height={280}
                layout="horizontal"
                yAxis={[
                  {
                    data: ['Overdue', 'Next 30 days', 'Next 90 days', 'Later', 'Unscheduled'],
                    scaleType: 'band',
                  },
                ]}
                series={[
                  {
                    data: [
                      stats.reviewBuckets.overdue,
                      stats.reviewBuckets.in30,
                      stats.reviewBuckets.in90,
                      stats.reviewBuckets.later,
                      stats.reviewBuckets.unscheduled,
                    ],
                    label: 'Controls',
                    color: '#5fa8d3',
                  },
                ]}
              />
            </ChartCard>
          </Grid>

          <Grid size={12}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="subtitle2">Recurring evidence due</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    Recurring evidence artifacts across every control · due-soon threshold{' '}
                    {settings?.recurringDueSoonDays ?? 30} days
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Chip label={`${recurring.overdue} overdue`} size="small" color="error" />
                  <Chip label={`${recurring.dueSoon} due soon`} size="small" color="warning" />
                  <Chip label={`${recurring.missing} no evidence`} size="small" color="error" variant="outlined" />
                  <Chip label={`${recurring.current} current`} size="small" color="success" variant="outlined" />
                </Stack>
              </Stack>

              {recurring.rows.length === 0 ? (
                <Alert severity="info" sx={{ mt: 1.5, py: 0 }}>
                  No recurring evidence configured yet. Open a control such as AT-2, CP-4 or RA-5 and mark an
                  evidence artifact as recurring.
                </Alert>
              ) : recurring.upcoming.length === 0 ? (
                <Alert severity="success" sx={{ mt: 1.5, py: 0 }}>
                  Every recurring artifact is current.
                </Alert>
              ) : (
                <Stack divider={<Divider flexItem />} sx={{ mt: 1 }}>
                  {recurring.upcoming.map((row) => (
                    <Stack
                      key={row.id}
                      direction="row"
                      spacing={1.5}
                      sx={{ alignItems: 'center', py: 0.75, cursor: 'pointer' }}
                      onClick={() =>
                        void navigate({ to: '/control/$controlId', params: { controlId: row.controlId } })
                      }
                    >
                      <Typography variant="body2" sx={{ fontWeight: 600, width: 100, flexShrink: 0 }}>
                        {row.controlId}
                      </Typography>
                      <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                        {row.title}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', width: 110, flexShrink: 0 }}>
                        {row.nextDue ? `due ${row.nextDue}` : 'no due date'}
                      </Typography>
                      <Chip
                        label={RECURRING_STATUS_LABEL[row.status]}
                        size="small"
                        color={statusSeverity(row.status)}
                        sx={{ height: 20, fontSize: 11, flexShrink: 0 }}
                      />
                    </Stack>
                  ))}
                </Stack>
              )}
            </Paper>
          </Grid>

          <Grid size={12}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2">Controls with missing evidence files</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                {stats.missingEvidence.length} control{stats.missingEvidence.length === 1 ? '' : 's'} have a required
                evidence type with no matching artifact. Lowest completeness first.
              </Typography>
              <Box sx={{ height: 420 }}>
                <DataGrid<MissingEvidenceRow>
                  rows={stats.missingEvidence}
                  columns={columns}
                  showToolbar
                  density="compact"
                  disableRowSelectionOnClick
                  onRowClick={(params: GridRowParams<MissingEvidenceRow>) =>
                    void navigate({ to: '/control/$controlId', params: { controlId: params.row.id } })
                  }
                  initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                  pageSizeOptions={[10, 25, 50]}
                  sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
                />
              </Box>
            </Paper>
          </Grid>
        </Grid>
      </Stack>
    </Box>
  );
}
