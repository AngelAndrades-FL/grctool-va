import { useEffect, useMemo } from 'react';
import { Outlet } from '@tanstack/react-router';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  MenuItem,
  Snackbar,
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
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import type { BaselineFilter, FrameworkMode } from '@shared/types';
import { useAppState } from '@/state/AppState';
import { useWorkspaceData } from '@/api/queries';
import { api } from '@/api/client';
import { isNodeInBaseline } from '@/domain/catalogIndex';
import { computeCompleteness } from '@/domain/completeness';
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
  const { baseline, setBaseline, mode, setMode, themeMode, toggleTheme, setPaletteOpen, toasts, dismissToast, notify } =
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
    const nodes = index.nodes.filter((node) => isNodeInBaseline(node, baseline, mode));
    const complete = nodes.filter((node) => computeCompleteness(node, evidence[node.id]) >= 80).length;
    return {
      total: nodes.length,
      complete,
      percent: nodes.length === 0 ? 0 : Math.round((complete / nodes.length) * 100),
    };
  }, [index, evidence, baseline, mode]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar variant="dense" sx={{ gap: 2 }}>
          <LinkTypography variant="h6" to="/dashboard" sx={{ textDecoration: 'none', color: 'inherit' }}>
            GRC Evidence Workspace
          </LinkTypography>

          <Stack direction="row" spacing={0.5}>
            {NAV.map((item) => (
              <LinkButton
                key={item.to}
                to={item.to}
                activeProps={{ className: 'active' }}
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

          <Tooltip title={`${overall.complete} of ${overall.total} in-baseline controls at 80%+ completeness`}>
            <Stack spacing={0.25} sx={{ minWidth: 140 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Coverage
                </Typography>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {overall.percent}%
                </Typography>
              </Stack>
              <LinearProgress variant="determinate" value={overall.percent} sx={{ height: 5, borderRadius: 2 }} />
            </Stack>
          </Tooltip>

          <Tooltip title="Search controls (Ctrl+K)">
            <IconButton onClick={() => setPaletteOpen(true)} size="small">
              <SearchIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Open workspace folder">
            <IconButton
              size="small"
              onClick={() => {
                void api.openWorkspaceFolder();
                notify('Opened the workspace folder', 'info');
              }}
            >
              <FolderOpenIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Toggle theme">
            <IconButton onClick={toggleTheme} size="small">
              {themeMode === 'light' ? <DarkModeIcon /> : <LightModeIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Settings">
            <LinkIconButton to="/settings" activeProps={{ className: 'active' }} size="small">
              <SettingsIcon />
            </LinkIconButton>
          </Tooltip>
        </Toolbar>
        {isLoading && <LinearProgress />}
      </AppBar>

      <AtoBanner />

      {error && (
        <Alert severity="error" sx={{ borderRadius: 0 }}>
          {error instanceof Error ? error.message : 'Failed to load the workspace.'}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexGrow: 1, minHeight: 0 }}>
        <FamilyRail />
        <Box sx={{ flexGrow: 1, minWidth: 0, overflow: 'auto' }}>
          <Outlet />
        </Box>
      </Box>

      <CommandPalette />

      {toasts.map((toast, i) => (
        <Snackbar
          key={toast.id}
          open
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          sx={{ mb: i * 7 }}
          onClose={() => dismissToast(toast.id)}
        >
          <Alert severity={toast.severity} variant="filled" onClose={() => dismissToast(toast.id)}>
            {toast.message}
          </Alert>
        </Snackbar>
      ))}
    </Box>
  );
}

export function BaselineChip({ label }: { label: string }) {
  return <Chip size="small" variant="outlined" label={label} sx={{ height: 20, fontSize: 11 }} />;
}
