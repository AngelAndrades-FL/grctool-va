import { useMemo } from 'react';
import { Alert, AlertTitle, Stack } from '@mui/material';
import { DateTime } from 'luxon';
import { useWorkspaceData } from '@/api/queries';
import { useAppState } from '@/state/AppState';
import { isNodeInBaseline } from '@/domain/catalogIndex';
import { predatesAto, stalenessDays } from '@/domain/completeness';
import { LinkButton } from './routerLinks';

/**
 * Surfaces the authorization clock: how close the next ATO is, and how much
 * in-baseline evidence an assessor would consider out of date for it.
 */
export function AtoBanner() {
  const { index, evidence, settings } = useWorkspaceData();
  const { baseline, mode } = useAppState();

  const alert = useMemo(() => {
    if (!index || !settings) return null;

    const nodes = index.nodes.filter((node) => isNodeInBaseline(node, baseline, mode));
    const staleCount = nodes.filter((node) => {
      const record = evidence[node.id];
      return (
        stalenessDays(record, settings.evidenceStaleAfterDays) !== null ||
        predatesAto(record, settings.lastAtoDate)
      );
    }).length;

    const daysToAto = settings.nextAtoDate
      ? Math.ceil(DateTime.fromISO(settings.nextAtoDate).diffNow('days').days)
      : null;

    if (daysToAto !== null && daysToAto <= 180) {
      return {
        severity: (daysToAto <= 60 ? 'error' : 'warning') as 'error' | 'warning',
        title:
          daysToAto < 0
            ? `Authorization expired ${Math.abs(daysToAto)} days ago`
            : `Next ATO in ${daysToAto} days`,
        body:
          staleCount > 0
            ? `${staleCount} in-baseline control${staleCount === 1 ? '' : 's'} carry evidence older than your staleness threshold or predating the last ATO (${settings.lastAtoDate ?? 'not set'}). Assessors will expect current-year artifacts.`
            : 'All in-baseline evidence is current.',
      };
    }

    if (staleCount > 0) {
      return {
        severity: 'info' as const,
        title: `${staleCount} control${staleCount === 1 ? '' : 's'} need refreshed evidence`,
        body: `Evidence is older than ${settings.evidenceStaleAfterDays} days or predates the last ATO (${settings.lastAtoDate ?? 'not set'}).`,
      };
    }

    return null;
  }, [index, evidence, settings, baseline, mode]);

  if (!alert) return null;

  return (
    <Alert
      severity={alert.severity}
      sx={{ borderRadius: 0, py: 0.5 }}
      action={
        <Stack direction="row" spacing={1}>
          <LinkButton size="small" to="/gaps">
            Review
          </LinkButton>
          <LinkButton size="small" to="/settings">
            ATO dates
          </LinkButton>
        </Stack>
      }
    >
      <AlertTitle sx={{ mb: 0, fontSize: 13 }}>{alert.title}</AlertTitle>
      {alert.body}
    </Alert>
  );
}
