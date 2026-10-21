import type { SxProps, Theme } from '@mui/material/styles';

/** Hides content visually while keeping it available to screen readers. */
export const visuallyHidden: SxProps<Theme> = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px',
};

/** Page title per top-level route, announced by screen readers on navigation. */
export function titleForPath(pathname: string): string {
  const [, section = ''] = pathname.split('/');
  const titles: Record<string, string> = {
    dashboard: 'Dashboard',
    family: 'Control family',
    control: 'Control',
    gaps: 'Gaps',
    export: 'Import / Export',
    settings: 'Settings',
  };
  const title = titles[section];
  return title ? `${title} – GRC Evidence Workspace` : 'GRC Evidence Workspace';
}
