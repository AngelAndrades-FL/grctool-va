import { createTheme, type Theme } from '@mui/material/styles';

const STATUS_COLOURS = {
  not_started: '#9e9e9e',
  planned: '#7986cb',
  partially_implemented: '#ffa726',
  implemented: '#43a047',
  inherited: '#26a69a',
  not_applicable: '#78909c',
  alternative_implementation: '#ab47bc',
} as const;

export function statusColour(status: keyof typeof STATUS_COLOURS): string {
  return STATUS_COLOURS[status] ?? '#9e9e9e';
}

export function scoreColour(score: number): string {
  if (score >= 80) return '#43a047';
  if (score >= 50) return '#ffa726';
  if (score > 0) return '#ef5350';
  return '#bdbdbd';
}

export function buildTheme(mode: 'light' | 'dark'): Theme {
  return createTheme({
    palette: {
      mode,
      primary: { main: mode === 'light' ? '#1b4965' : '#62b6cb' },
      secondary: { main: '#5fa8d3' },
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
    },
  });
}
