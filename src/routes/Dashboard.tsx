import { useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Alert,
  Box,
  Chip,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { DataGrid, type GridColDef, type GridRowParams } from '@mui/x-data-grid';
import { BarChart } from '@mui/x-charts/BarChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { GaugeContainer, GaugeValueArc, GaugeValueText, gaugeClasses, useGaugeState } from '@mui/x-charts/Gauge';
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

interface DrillRow {
  id: string;
  name: string;
  familyId: string;
  status: ImplementationStatus;
  /** Null for not-applicable controls, which have no score. */
  completeness: number | null;
  artifacts: number;
  detail: string;
}

type DrillKey = 'complete' | 'notApplicable' | 'stale' | 'findings';
type ReviewBucket = 'overdue' | 'in30' | 'in90' | 'later' | 'unscheduled';

const REVIEW_BUCKETS: Array<{ key: ReviewBucket; label: string }> = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'in30', label: 'Next 30 days' },
  { key: 'in90', label: 'Next 90 days' },
  { key: 'later', label: 'Later' },
  { key: 'unscheduled', label: 'Unscheduled' },
];

const DRILL_TITLE: Record<DrillKey, { title: string; detail: string }> = {
  complete: { title: 'Controls complete', detail: 'Missing evidence' },
  notApplicable: { title: 'Not applicable', detail: 'Rationale' },
  stale: { title: 'Stale evidence', detail: 'Why it is stale' },
  findings: { title: 'Open findings', detail: 'POA&M item' },
};

function StatCard({
  label,
  value,
  caption,
  colour,
  onClick,
  active,
}: {
  label: string;
  value: string;
  caption?: string;
  colour?: string;
  /** Makes the card a button that opens the matching list. */
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? Boolean(active) : undefined}
      sx={{
        p: 2,
        height: '100%',
        ...(onClick && {
          cursor: 'pointer',
          '&:hover': { borderColor: 'primary.main' },
          ...(active && { borderColor: 'primary.main', boxShadow: (theme) => `inset 0 0 0 1px ${theme.palette.primary.main}` }),
        }),
      }}
    >
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

const COVERAGE_BANDS = [
  { from: 0, to: 60, colour: '#9e9e9e' },
  { from: 60, to: 80, colour: '#fbc02d' },
  { from: 80, to: 100, colour: '#43a047' },
];
const COVERAGE_TICKS = [60, 80];

function coverageColour(value: number): string {
  return value >= 80 ? '#43a047' : value > 60 ? '#fbc02d' : '#9e9e9e';
}

function CoverageBands() {
  const { startAngle, endAngle, innerRadius, outerRadius, cx, cy } = useGaugeState();
  const angleOf = (value: number) => startAngle + (value / 100) * (endAngle - startAngle);
  // Gauge angles are measured clockwise from 12 o'clock.
  const point = (angle: number, radius: number) => [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)] as const;
  const sector = (from: number, to: number) => {
    const a0 = angleOf(from);
    const a1 = angleOf(to);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return [
      `M${point(a0, outerRadius).join(' ')}`,
      `A${outerRadius} ${outerRadius} 0 ${large} 1 ${point(a1, outerRadius).join(' ')}`,
      `L${point(a1, innerRadius).join(' ')}`,
      `A${innerRadius} ${innerRadius} 0 ${large} 0 ${point(a0, innerRadius).join(' ')}`,
      'Z',
    ].join(' ');
  };

  return (
    <g>
      {COVERAGE_BANDS.map((band) => (
        <path key={band.from} d={sector(band.from, band.to)} fill={band.colour} opacity={0.3} />
      ))}
      {COVERAGE_TICKS.map((tick) => {
        const angle = angleOf(tick);
        const [x1, y1] = point(angle, innerRadius - 2);
        const [x2, y2] = point(angle, outerRadius + 4);
        const [lx, ly] = point(angle, outerRadius + 13);
        return (
          <g key={tick} className="coverage-tick">
            <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={1.5} />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={11}>
              {tick}
            </text>
          </g>
        );
      })}
    </g>
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
  const [drillKey, setDrillKey] = useState<DrillKey | null>(null);
  const [completeView, setCompleteView] = useState<'complete' | 'incomplete'>('complete');
  const [reviewBucket, setReviewBucket] = useState<ReviewBucket | null>(null);
  const reviewPanelRef = useRef<HTMLDivElement>(null);
  const selectReviewBucket = (key: ReviewBucket) => {
    setReviewBucket((current) => (current === key ? null : key));
    requestAnimationFrame(() => reviewPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  const [statusFilter, setStatusFilter] = useState<ImplementationStatus | null>(null);
  const statusPanelRef = useRef<HTMLDivElement>(null);
  const selectStatus = (status: ImplementationStatus) => {
    setStatusFilter((current) => (current === status ? null : status));
    requestAnimationFrame(() => statusPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const rolePanelRef = useRef<HTMLDivElement>(null);
  const selectRole = (roleId: string) => {
    setRoleFilter((current) => (current === roleId ? null : roleId));
    requestAnimationFrame(() => rolePanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  const toggleDrill = (key: DrillKey) => setDrillKey((current) => (current === key ? null : key));

  const stats = useMemo(() => {
    if (!index) return null;

    const nodes = index.nodes.filter((node) => isNodeInBaseline(node, baseline, mode));
    const staleAfterDays = settings?.evidenceStaleAfterDays ?? 365;
    const lastAtoDate = settings?.lastAtoDate ?? null;

    const statusCounts = new Map<ImplementationStatus, number>();
    const familyTotals = new Map<string, { complete: number; incomplete: number }>();
    const missingEvidence: MissingEvidenceRow[] = [];
    const drill = {
      complete: [] as DrillRow[],
      incomplete: [] as DrillRow[],
      notApplicable: [] as DrillRow[],
      stale: [] as DrillRow[],
      findings: [] as DrillRow[],
    };
    const reviewBuckets = { overdue: 0, in30: 0, in90: 0, later: 0, unscheduled: 0 };
    const reviewDrill: Record<ReviewBucket, DrillRow[]> = { overdue: [], in30: [], in90: [], later: [], unscheduled: [] };
    const statusDrill = new Map<ImplementationStatus, DrillRow[]>();
    const pushStatusRow = (row: DrillRow) => {
      const rows = statusDrill.get(row.status) ?? [];
      rows.push(row);
      statusDrill.set(row.status, rows);
    };
    const roleDrill = new Map<string, DrillRow[]>();

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
        drill.notApplicable.push({
          id: node.id,
          name: node.name,
          familyId: node.familyId,
          status,
          completeness: null,
          artifacts: record?.artifacts.length ?? 0,
          detail: record?.naJustification.trim() || 'Rationale missing',
        });
      }
      // Documented N/A controls are out of every coverage, gap, staleness and review metric.
      if (isDocumentedNa(record)) {
        pushStatusRow(drill.notApplicable[drill.notApplicable.length - 1]);
        continue;
      }

      const score = computeCompleteness(node, record);
      const gaps = buildGapReport(node, record, { staleAfterDays, lastAtoDate });

      scoreTotal += score;
      if (score >= COMPLETE_THRESHOLD) complete += 1;
      if (!record || status === 'not_started') notStarted += 1;
      if (gaps.stale) stale += 1;
      if (record?.poam.hasFinding) openFindings += 1;

      const drillRow = (detail: string): DrillRow => ({
        id: node.id,
        name: node.name,
        familyId: node.familyId,
        status,
        completeness: score,
        artifacts: record?.artifacts.length ?? 0,
        detail,
      });
      if (gaps.stale) {
        drill.stale.push(
          drillRow(gaps.staleByDays !== null ? `Evidence is ${gaps.staleByDays} days old` : `Predates the last ATO (${lastAtoDate ?? 'not set'})`),
        );
      }
      if (record?.poam.hasFinding) {
        const { findingId, severity, dueDate } = record.poam;
        drill.findings.push(
          drillRow([findingId, severity, dueDate ? `due ${dueDate}` : ''].filter(Boolean).join(' · ') || 'Open POA&M item'),
        );
      }

      const bucket = familyTotals.get(node.familyId) ?? { complete: 0, incomplete: 0 };
      if (score >= COMPLETE_THRESHOLD) bucket.complete += 1;
      else bucket.incomplete += 1;
      familyTotals.set(node.familyId, bucket);

      const coverage = evidenceTypeCoverage(node, record);
      const artifacts = record?.artifacts.length ?? 0;
      pushStatusRow(
        drillRow(
          status === 'not_applicable'
            ? 'N/A rationale missing'
            : coverage.missing.join(', ') || gaps.reasons.join(' ') || 'None',
        ),
      );
      (score >= COMPLETE_THRESHOLD ? drill.complete : drill.incomplete).push(
        drillRow(coverage.missing.join(', ') || (score >= COMPLETE_THRESHOLD ? 'None' : gaps.reasons.join(' ') || 'None')),
      );
      const roleId = record?.ownership.responsibleRole.trim() ?? '';
      const roleRows = roleDrill.get(roleId) ?? [];
      roleRows.push(
        drillRow([record?.ownership.owner, record?.ownership.poc].filter(Boolean).join(' · ') || 'No owner recorded'),
      );
      roleDrill.set(roleId, roleRows);
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
      let bucketKey: ReviewBucket = 'unscheduled';
      let reviewDetail = 'No next review date';
      if (due) {
        const days = Math.ceil(DateTime.fromISO(due).diffNow('days').days);
        bucketKey = days < 0 ? 'overdue' : days <= 30 ? 'in30' : days <= 90 ? 'in90' : 'later';
        reviewDetail = days < 0 ? `Due ${due} · ${-days} day${days === -1 ? '' : 's'} overdue` : `Due ${due} · in ${days} day${days === 1 ? '' : 's'}`;
      }
      reviewBuckets[bucketKey] += 1;
      reviewDrill[bucketKey].push(drillRow(reviewDetail));
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
        .sort((a, b) => b.incomplete - a.incomplete || a.familyId.localeCompare(b.familyId)),
      missingEvidence: missingEvidence.sort((a, b) => a.completeness - b.completeness),
      reviewBuckets,
      reviewDrill,
      statusDrill,
      roleRows: [...roleDrill.entries()]
        .map(([roleId, rows]) => {
          const role = settings?.responsibleRoles.find((r) => r.id === roleId);
          return { roleId, label: roleId === '' ? 'Not assigned' : (role?.label ?? roleId), rows };
        })
        .sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label)),
      drill,
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

  const drillRows: DrillRow[] = drillKey ? (drillKey === 'complete' ? stats.drill[completeView] : stats.drill[drillKey]) : [];
  const drillDetailHeader =
    drillKey === 'complete' ? (completeView === 'complete' ? 'Missing evidence' : 'Gaps') : drillKey ? DRILL_TITLE[drillKey].detail : '';
  const drillColumnsFor = (detailHeader: string): GridColDef<DrillRow>[] => [
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
      width: 100,
      type: 'number',
      valueFormatter: (value: number | null) => (value === null ? '—' : `${value}%`),
    },
    { field: 'artifacts', headerName: 'Artifacts', width: 85, type: 'number' },
    {
      field: 'detail',
      headerName: detailHeader,
      flex: 1.6,
      minWidth: 240,
      sortable: false,
      renderCell: (params) => (
        <Tooltip title={params.row.detail}>
          <Typography variant="caption" noWrap sx={{ display: 'block' }}>
            {params.row.detail}
          </Typography>
        </Tooltip>
      ),
    },
  ];

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

  const statusRows = statusFilter ? (stats.statusDrill.get(statusFilter) ?? []) : [];
  const selectedRole = roleFilter === null ? undefined : stats.roleRows.find((r) => r.roleId === roleFilter);
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
              onClick={() => toggleDrill('complete')}
              active={drillKey === 'complete'}
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
              onClick={() => toggleDrill('notApplicable')}
              active={drillKey === 'notApplicable'}
            />
            <StatCard
              label="Stale evidence"
              value={String(stats.stale)}
              caption={`Older than ${settings?.evidenceStaleAfterDays ?? 365} days or predating the last ATO`}
              colour={stats.stale > 0 ? '#ffa726' : '#43a047'}
              onClick={() => toggleDrill('stale')}
              active={drillKey === 'stale'}
            />
            <StatCard
              label="Open findings"
              value={String(stats.openFindings)}
              caption="Controls carrying an open POA&M item"
              colour={stats.openFindings > 0 ? '#ef5350' : '#43a047'}
              onClick={() => toggleDrill('findings')}
              active={drillKey === 'findings'}
            />
            </Box>
          </Grid>

          {drillKey && (
            <Grid size={12}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="subtitle2">
                      {DRILL_TITLE[drillKey].title} · {drillRows.length} control{drillRows.length === 1 ? '' : 's'}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      Select a row to open the control.
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    {drillKey === 'complete' && (
                      <ToggleButtonGroup
                        exclusive
                        size="small"
                        value={completeView}
                        onChange={(_e, value: 'complete' | 'incomplete' | null) => value && setCompleteView(value)}
                      >
                        <ToggleButton value="complete">Complete ({stats.drill.complete.length})</ToggleButton>
                        <ToggleButton value="incomplete">Below {COMPLETE_THRESHOLD}% ({stats.drill.incomplete.length})</ToggleButton>
                      </ToggleButtonGroup>
                    )}
                    <Tooltip title="Close">
                      <IconButton size="small" onClick={() => setDrillKey(null)} aria-label="Close list">
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>
                <Box sx={{ height: 380, mt: 1 }}>
                  <DataGrid<DrillRow>
                    rows={drillRows}
                    columns={drillColumnsFor(drillDetailHeader)}
                    showToolbar
                    density="compact"
                    disableRowSelectionOnClick
                    onRowClick={(params: GridRowParams<DrillRow>) =>
                      void navigate({ to: '/control/$controlId', params: { controlId: params.row.id } })
                    }
                    initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                    pageSizeOptions={[10, 25, 50]}
                    sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
                  />
                </Box>
              </Paper>
            </Grid>
          )}

          <Grid size={{ xs: 12, md: 4 }}>
            <ChartCard
              title="Overall coverage"
              subtitle={`Controls at ${COMPLETE_THRESHOLD}%+ completeness`}
            >
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
                <GaugeContainer
                  width={300}
                  height={240}
                  value={stats.coveragePercent}
                  startAngle={-110}
                  endAngle={110}
                  innerRadius="62%"
                  outerRadius="82%"
                  sx={(theme) => ({
                    [`& .${gaugeClasses.valueText}`]: { fontSize: 36, fontWeight: 600 },
                    [`& .${gaugeClasses.valueArc}`]: { fill: coverageColour(stats.coveragePercent) },
                    '& .coverage-tick line': { stroke: theme.palette.text.secondary },
                    '& .coverage-tick text': { fill: theme.palette.text.secondary },
                  })}
                >
                  <CoverageBands />
                  <GaugeValueArc />
                  <GaugeValueText text={({ value }) => `${value}%`} />
                </GaugeContainer>
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', textAlign: 'center' }}>
                Average completeness across all applicable controls: {stats.averageScore}%
              </Typography>
            </ChartCard>
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <ChartCard
              title="Implementation status"
              subtitle="Every applicable control by recorded status, plus those marked N/A · select a slice to list the controls"
            >
              <PieChart
                height={230}
                onItemClick={(_event, item) => {
                  const slice = statusSlices[item.dataIndex];
                  if (slice) selectStatus(slice.id);
                }}
                series={[
                  {
                    data: statusSlices,
                    innerRadius: 50,
                    paddingAngle: 2,
                    cornerRadius: 3,
                    highlightScope: { fade: 'global', highlight: 'item' },
                  },
                ]}
                sx={{ '& .MuiPieArc-root': { cursor: 'pointer' } }}
              />
            </ChartCard>
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <ChartCard title="Controls by responsible role" subtitle="Applicable controls per assigned role · select a slice to list the controls">
              <PieChart
                height={230}
                onItemClick={(_event, item) => {
                  const role = stats.roleRows[item.dataIndex];
                  if (role) selectRole(role.roleId);
                }}
                series={[
                  {
                    data: stats.roleRows.map((r) => ({
                      id: r.roleId || '__unassigned',
                      value: r.rows.length,
                      label: r.label,
                      ...(r.roleId === '' && { color: '#9e9e9e' }),
                    })),
                    innerRadius: 50,
                    paddingAngle: 2,
                    cornerRadius: 3,
                    highlightScope: { fade: 'global', highlight: 'item' },
                  },
                ]}
                sx={{ '& .MuiPieArc-root': { cursor: 'pointer' } }}
              />
            </ChartCard>
          </Grid>

          {statusFilter && (
            <Grid size={12}>
              <Paper variant="outlined" sx={{ p: 2 }} ref={statusPanelRef}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="subtitle2" component="h2">
                      Implementation status · {STATUS_LABEL[statusFilter]} · {statusRows.length} control
                      {statusRows.length === 1 ? '' : 's'}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      Select a row to open the control.
                    </Typography>
                  </Box>
                  <Tooltip title="Close">
                    <IconButton size="small" onClick={() => setStatusFilter(null)} aria-label="Close implementation status list">
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                <Box sx={{ height: 380, mt: 1 }}>
                  <DataGrid<DrillRow>
                    rows={statusRows}
                    columns={drillColumnsFor(statusFilter === 'not_applicable' ? 'Rationale' : 'Gaps')}
                    showToolbar
                    density="compact"
                    disableRowSelectionOnClick
                    onRowClick={(params: GridRowParams<DrillRow>) =>
                      void navigate({ to: '/control/$controlId', params: { controlId: params.row.id } })
                    }
                    initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                    pageSizeOptions={[10, 25, 50]}
                    sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
                  />
                </Box>
              </Paper>
            </Grid>
          )}

          {selectedRole && (
            <Grid size={12}>
              <Paper variant="outlined" sx={{ p: 2 }} ref={rolePanelRef}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="subtitle2" component="h2">
                      Responsible role · {selectedRole.label} · {selectedRole.rows.length} control
                      {selectedRole.rows.length === 1 ? '' : 's'}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      Select a row to open the control.
                    </Typography>
                  </Box>
                  <Tooltip title="Close">
                    <IconButton size="small" onClick={() => setRoleFilter(null)} aria-label="Close responsible role list">
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                <Box sx={{ height: 380, mt: 1 }}>
                  <DataGrid<DrillRow>
                    rows={selectedRole.rows}
                    columns={drillColumnsFor('Owner / POC')}
                    showToolbar
                    density="compact"
                    disableRowSelectionOnClick
                    onRowClick={(params: GridRowParams<DrillRow>) =>
                      void navigate({ to: '/control/$controlId', params: { controlId: params.row.id } })
                    }
                    initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                    pageSizeOptions={[10, 25, 50]}
                    sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
                  />
                </Box>
              </Paper>
            </Grid>
          )}

          <Grid size={{ xs: 12, md: 8 }}>
            <ChartCard
              title="Families needing the most work"
              subtitle={`Controls above and below ${COMPLETE_THRESHOLD}% completeness · select a family to open its controls`}
            >
              <BarChart
                height={280}
                onAxisClick={(_event, data) => {
                  const family = stats.familyRows[data?.dataIndex ?? -1];
                  if (family) void navigate({ to: '/family/$familyId', params: { familyId: family.familyId } });
                }}
                sx={{ cursor: 'pointer' }}
                xAxis={[{ data: stats.familyRows.map((f) => f.familyId), scaleType: 'band', tickLabelInterval: () => true }]}
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
            <ChartCard title="Review schedule" subtitle="When the next review falls due · select a bar to list the controls">
              <BarChart
                height={280}
                layout="horizontal"
                onItemClick={(_event, item) => {
                  const bucket = REVIEW_BUCKETS[item.dataIndex ?? -1];
                  if (bucket) selectReviewBucket(bucket.key);
                }}
                yAxis={[
                  {
                    data: REVIEW_BUCKETS.map((b) => b.label),
                    scaleType: 'band',
                    width: 100,
                  },
                ]}
                series={[
                  {
                    data: REVIEW_BUCKETS.map((b) => stats.reviewBuckets[b.key]),
                    label: 'Controls',
                    color: '#5fa8d3',
                  },
                ]}
              />
            </ChartCard>
          </Grid>

          {reviewBucket && (
            <Grid size={12}>
              <Paper variant="outlined" sx={{ p: 2 }} ref={reviewPanelRef}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="subtitle2" component="h2">
                      Review schedule · {REVIEW_BUCKETS.find((b) => b.key === reviewBucket)?.label} ·{' '}
                      {stats.reviewDrill[reviewBucket].length} control{stats.reviewDrill[reviewBucket].length === 1 ? '' : 's'}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      Select a row to open the control.
                    </Typography>
                  </Box>
                  <Tooltip title="Close">
                    <IconButton size="small" onClick={() => setReviewBucket(null)} aria-label="Close review schedule list">
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                <Box sx={{ height: 380, mt: 1 }}>
                  <DataGrid<DrillRow>
                    rows={stats.reviewDrill[reviewBucket]}
                    columns={drillColumnsFor('Next review')}
                    showToolbar
                    density="compact"
                    disableRowSelectionOnClick
                    onRowClick={(params: GridRowParams<DrillRow>) =>
                      void navigate({ to: '/control/$controlId', params: { controlId: params.row.id } })
                    }
                    initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                    pageSizeOptions={[10, 25, 50]}
                    sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
                  />
                </Box>
              </Paper>
            </Grid>
          )}

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
