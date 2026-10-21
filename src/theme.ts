import { createTheme, type Theme } from '@mui/material/styles';

/** Shared so the status and score palettes cannot drift apart. Each gives at least 4.5:1 against white chip text. */
const NEUTRAL = '#757575';
const GREEN = '#2e7d32';
const AMBER = '#b45309';
const RED = '#c62828';

const STATUS_COLOURS = {
  not_started: NEUTRAL,
  planned: '#5c6bc0',
  partially_implemented: AMBER,
  implemented: GREEN,
  inherited: '#00796b',
  not_applicable: '#546e7a',
  alternative_implementation: '#8e24aa',
} as const;

export function statusColour(status: keyof typeof STATUS_COLOURS): string {
  return STATUS_COLOURS[status] ?? NEUTRAL;
}

export function scoreColour(score: number): string {
  if (score >= 80) return GREEN;
  if (score >= 50) return AMBER;
  if (score > 0) return RED;
  return NEUTRAL;
}

export function buildTheme(mode: 'light' | 'dark'): Theme {
  return createTheme({
    palette: {
      mode,
      primary: { main: mode === 'light' ? '#1b4965' : '#62b6cb' },
      secondary: { main: mode === 'light' ? '#2a6f97' : '#5fa8d3' },
      background: {
        default: mode === 'light' ? '#f4f6f8' : '#121417',
        paper: mode === 'light' ? '#ffffff' : '#1b1e24',
      },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
      h6: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
    },
    components: {
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiSelect: { defaultProps: { size: 'small' } },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiButtonBase: {
        styleOverrides: {
          root: { '&.Mui-focusVisible': { outline: '3px solid', outlineColor: 'currentColor', outlineOffset: 2 } },
        },
      },
    },
  });
}
