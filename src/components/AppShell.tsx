import { useEffect, useMemo, useRef } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import {
  Alert,
  AppBar,
  Box,
  Chip,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import SearchIcon from '@mui/icons-material/Search';
import SettingsIcon from '@mui/icons-material/Settings';
import type { BaselineFilter, FrameworkMode } from '@shared/types';
import { useAppState } from '@/state/AppState';
import { titleForPath } from '@/a11y';
import { useWorkspaceData } from '@/api/queries';
import { isNodeInBaseline } from '@/domain/catalogIndex';
import { computeCompleteness, isDocumentedNa } from '@/domain/completeness';
import { FamilyRail } from './FamilyRail';
import { CommandPalette } from './CommandPalette';
import { AtoBanner } from './AtoBanner';
import { LinkButton, LinkIconButton, LinkTypography } from './routerLinks';

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/gaps', label: 'Gaps' },
  { to: '/export', label: 'Import / Export' },
] as const;

export function AppShell() {
  const { index, evidence, isLoading, error } = useWorkspaceData();
  const { baseline, setBaseline, mode, setMode, themeMode, toggleTheme, setPaletteOpen, toasts, dismissToast } =
    useAppState();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen]);

  const overall = useMemo(() => {
    if (!index) return { total: 0, complete: 0, percent: 0 };
    const nodes = index.nodes.filter(
      (node) => isNodeInBaseline(node, baseline, mode) && !isDocumentedNa(evidence[node.id]),
    );
    const complete = nodes.filter((node) => computeCompleteness(node, evidence[node.id]) >= 80).length;
    return {
      total: nodes.length,
      complete,
      percent: nodes.length === 0 ? 0 : Math.round((complete / nodes.length) * 100),
    };
  }, [index, evidence, baseline, mode]);

  const coverageSummary = `${overall.complete} of ${overall.total} in-baseline controls at 80%+ completeness`;

  // Announce the new page and move focus into it after each client-side navigation.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    document.title = titleForPath(pathname);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [pathname]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Box
        component="a"
        href="#main-content"
        onClick={(e: React.MouseEvent) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
        sx={{
          position: 'absolute',
          left: 8,
          top: -48,
          zIndex: (t) => t.zIndex.tooltip + 1,
          bgcolor: 'background.paper',
          color: 'text.primary',
          px: 2,
          py: 1,
          borderRadius: 1,
          border: 2,
          borderColor: 'primary.main',
          '&:focus': { top: 8 },
        }}
      >
        Skip to main content
      </Box>
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar variant="dense" sx={{ gap: 2 }}>
          <LinkTypography variant="h6" to="/dashboard" sx={{ textDecoration: 'none', color: 'inherit' }}>
            GRC Evidence Workspace
          </LinkTypography>

          <Stack component="nav" aria-label="Primary" direction="row" spacing={0.5}>
            {NAV.map((item) => (
              <LinkButton
                key={item.to}
                to={item.to}
                activeProps={{ className: 'active', 'aria-current': 'page' }}
                size="small"
                sx={{ '&.active': { bgcolor: 'action.selected' } }}
              >
                {item.label}
              </LinkButton>
            ))}
          </Stack>

          <Box sx={{ flexGrow: 1 }} />

          <TextField
            select
            label="Baseline"
            value={baseline}
            onChange={(e) => setBaseline(e.target.value as BaselineFilter)}
            sx={{ width: 140 }}
          >
            {(['Low', 'Moderate', 'High', 'All'] as BaselineFilter[]).map((level) => (
              <MenuItem key={level} value={level}>
                {level}
              </MenuItem>
            ))}
          </TextField>

          <ToggleButtonGroup
            exclusive
            size="small"
            aria-label="Framework"
            value={mode}
            onChange={(_e, next: FrameworkMode | null) => next && setMode(next)}
          >
            <ToggleButton value="nist" sx={{ px: 1.5 }}>
              NIST
            </ToggleButton>
            <ToggleButton value="va" sx={{ px: 1.5 }}>
              VA overlay
            </ToggleButton>
          </ToggleButtonGroup>

          <Box sx={{ minWidth: 140 }} title={coverageSummary}>
            <Stack spacing={0.25}>
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Coverage
                </Typography>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {overall.percent}%
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={overall.percent}
                aria-label="Coverage"
                aria-valuetext={coverageSummary}
                sx={{ height: 5, borderRadius: 2 }}
              />
            </Stack>
          </Box>

          <Tooltip title="Search controls (Ctrl+K)">
            <IconButton onClick={() => setPaletteOpen(true)} size="small" aria-keyshortcuts="Control+K">
              <SearchIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={themeMode === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}>
            <IconButton onClick={toggleTheme} size="small">
              {themeMode === 'light' ? <DarkModeIcon /> : <LightModeIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Settings">
            <LinkIconButton to="/settings" activeProps={{ className: 'active', 'aria-current': 'page' }} size="small">
              <SettingsIcon />
            </LinkIconButton>
          </Tooltip>
        </Toolbar>
        {isLoading && <LinearProgress aria-label="Loading workspace" />}
      </AppBar>

      <AtoBanner />

      {error && (
        <Alert severity="error" sx={{ borderRadius: 0 }}>
          {error instanceof Error ? error.message : 'Failed to load the workspace.'}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexGrow: 1, minHeight: 0 }}>
        <FamilyRail />
        <Box
          component="main"
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          sx={{ flexGrow: 1, minWidth: 0, overflow: 'auto', outline: 'none' }}
        >
          <Outlet />
        </Box>
      </Box>

      <CommandPalette />

      {/* Errors and warnings stay until dismissed; they are not removed on a timer. */}
      <Stack spacing={1} sx={{ position: 'fixed', right: 16, bottom: 16, zIndex: (t) => t.zIndex.snackbar, maxWidth: 480 }}>
        {toasts.map((toast) => (
          <Alert
            key={toast.id}
            severity={toast.severity}
            variant="filled"
            role={toast.severity === 'error' || toast.severity === 'warning' ? 'alert' : 'status'}
            onClose={() => dismissToast(toast.id)}
            slotProps={{ closeButton: { 'aria-label': 'Dismiss notification' } }}
          >
            {toast.message}
          </Alert>
        ))}
      </Stack>
    </Box>
  );
}

export function BaselineChip({ label }: { label: string }) {
  return <Chip size="small" variant="outlined" label={label} sx={{ height: 20, fontSize: 11 }} />;
}
