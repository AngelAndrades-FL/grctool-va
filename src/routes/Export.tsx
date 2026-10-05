import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import BackupIcon from '@mui/icons-material/Backup';
import TableChartIcon from '@mui/icons-material/TableChart';
import ArticleIcon from '@mui/icons-material/Article';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import RestoreIcon from '@mui/icons-material/Restore';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import FolderZipIcon from '@mui/icons-material/FolderZip';
import type { ExportRequest, OscalImportResult } from '@shared/types';
import { recordsToOscal } from '@shared/oscal';
import { api } from '@/api/client';
import { useExportFile, useImportBackup, useSaveEvidence, useWorkspaceData } from '@/api/queries';
import { useAppState } from '@/state/AppState';
import { buildCsv, buildJsonBackup, buildRecurringCsv, buildSspLiteMarkdown } from '@/domain/export';
import { planOscalImport, type OscalImportPlan } from '@/domain/oscalImport';

type ExportFormat = ExportRequest['format'] | 'oscal-package';

interface ExportOption {
  format: ExportFormat;
  title: string;
  detail: string;
  icon: React.ReactNode;
  suggestedName: (systemId: string) => string;
}

export function Export() {
  const { index, evidence, settings } = useWorkspaceData();
  const exportFile = useExportFile();
  const importBackup = useImportBackup();
  const saveEvidence = useSaveEvidence();
  const { notify } = useAppState();
  const [pendingFormat, setPendingFormat] = useState<ExportFormat | null>(null);
  const [snPicking, setSnPicking] = useState(false);
  const [snPreview, setSnPreview] = useState<{ result: OscalImportResult; plan: OscalImportPlan } | null>(null);

  const options: ExportOption[] = [
    {
      format: 'oscal-package',
      title: 'OSCAL SSP package (.zip)',
      detail:
        'The OSCAL v1.2.0 SSP plus every evidence file it references, in one ZIP. Files keep their attachments/… paths so the SSP links resolve inside the package; SHA-256 hashes in the SSP let an assessor verify them.',
      icon: <FolderZipIcon />,
      suggestedName: (id) => `${id}-ssp-package.zip`,
    },
    {
      format: 'oscal',
      title: 'OSCAL SSP (JSON only)',
      detail: 'The System Security Plan as OSCAL v1.2.0 JSON without the evidence files, for tools that only take the SSP.',
      icon: <DescriptionIcon />,
      suggestedName: (id) => `${id}-ssp.json`,
    },
    {
      format: 'json',
      title: 'JSON backup',
      detail: 'Every evidence record, verbatim. Restore it with "Import backup" below.',
      icon: <BackupIcon />,
      suggestedName: (id) => `${id}-evidence-backup.json`,
    },
    {
      format: 'csv',
      title: 'CSV',
      detail: 'One row per control: status, completeness, artifact count and review dates.',
      icon: <TableChartIcon />,
      suggestedName: (id) => `${id}-controls.csv`,
    },
    {
      format: 'markdown',
      title: 'SSP-lite Markdown',
      detail: 'Implementation narratives and artifact manifest, grouped by family.',
      icon: <ArticleIcon />,
      suggestedName: (id) => `${id}-ssp-lite.md`,
    },
    {
      format: 'recurring-csv',
      title: 'Recurring evidence status (CSV)',
      detail:
        'Assessor-ready: control, requirement, frequency, last collected, next due, status and the evidence files held for each cycle.',
      icon: <EventRepeatIcon />,
      suggestedName: (id) => `${id}-recurring-evidence.csv`,
    },
  ];

  const buildContents = (format: ExportRequest['format']): string | null => {
    if (!index || !settings) return null;
    switch (format) {
      case 'oscal':
        return JSON.stringify(recordsToOscal(Object.values(evidence), settings).ssp, null, 2);
      case 'json':
        return buildJsonBackup(evidence);
      case 'csv':
        return buildCsv(index, evidence);
      case 'markdown':
        return buildSspLiteMarkdown(index, evidence, settings);
      case 'recurring-csv':
        return buildRecurringCsv(evidence, settings);
    }
  };

  const handleExport = async (option: ExportOption) => {
    if (option.format === 'oscal-package') {
      await handlePackageExport(option);
      return;
    }
    const contents = buildContents(option.format);
    if (contents === null) {
      notify('Workspace is still loading', 'error');
      return;
    }
    setPendingFormat(option.format);
    try {
      const result = await exportFile.mutateAsync({
        format: option.format,
        contents,
        suggestedName: option.suggestedName(settings?.systemId || 'system'),
      });
      if (!result.cancelled) notify(`Exported to ${result.path}`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Export failed', 'error');
    } finally {
      setPendingFormat(null);
    }
  };

  const handlePackageExport = async (option: ExportOption) => {
    const sspJson = buildContents('oscal');
    if (sspJson === null) {
      notify('Workspace is still loading', 'error');
      return;
    }
    const systemId = settings?.systemId || 'system';
    setPendingFormat(option.format);
    try {
      const result = await api.exportOscalPackage({
        sspJson,
        sspFileName: `${systemId}-ssp.json`,
        suggestedName: option.suggestedName(systemId),
      });
      if (result.cancelled) return;
      const missing = result.missing ?? [];
      if (missing.length) {
        notify(
          `Exported to ${result.path} with ${result.fileCount} file(s). ${missing.length} referenced file(s) were not found: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`,
          'warning',
        );
      } else {
        notify(`Exported to ${result.path} with ${result.fileCount} file(s)`, 'success');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Export failed', 'error');
    } finally {
      setPendingFormat(null);
    }
  };

  const handleImport = async () => {
    try {
      const result = await importBackup.mutateAsync();
      if (!result.cancelled) notify('Backup imported', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Import failed', 'error');
    }
  };

  const handlePickServiceNow = async () => {
    if (!index) return;
    setSnPicking(true);
    try {
      const result = await api.importOscalSsp();
      if (result.cancelled) return;
      setSnPreview({ result, plan: planOscalImport(result, index, evidence, settings?.currentUser ?? '') });
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Import failed', 'error');
    } finally {
      setSnPicking(false);
    }
  };

  const handleApplyServiceNow = async () => {
    if (!snPreview) return;
    try {
      await saveEvidence.mutateAsync(snPreview.plan.records);
      notify(`Imported ${snPreview.plan.records.length} control(s) from ServiceNow`, 'success');
      setSnPreview(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Import failed', 'error');
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>
        <Paper variant="outlined" sx={{ p: 3, flex: 3, minWidth: 0, width: '100%' }}>
          <Typography variant="h6" gutterBottom>
            Export
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            Every export is a snapshot of the current evidence, written wherever you choose in the save dialog.
          </Typography>
          <List disablePadding>
            {options.map((option) => (
              <ListItem
                key={option.format}
                disableGutters
                sx={{ py: 1.5, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}
                secondaryAction={
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={!index || !settings || pendingFormat !== null}
                    onClick={() => void handleExport(option)}
                  >
                    {pendingFormat === option.format ? 'Exporting…' : 'Export'}
                  </Button>
                }
              >
                <ListItemIcon>{option.icon}</ListItemIcon>
                <ListItemText primary={option.title} secondary={option.detail} sx={{ mr: 12 }} />
              </ListItem>
            ))}
          </List>
        </Paper>

        <Stack spacing={3} sx={{ flex: 2, minWidth: 0, width: '100%' }}>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="h6" gutterBottom>
                Import backup
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Restore evidence records from a JSON backup file. Existing records with the same control id are
                replaced.
              </Typography>
            </Box>
            <Chip label="Overwrites matching records" size="small" variant="outlined" />
          </Stack>
          <Button
            variant="outlined"
            startIcon={<RestoreIcon />}
            sx={{ mt: 2 }}
            disabled={importBackup.isPending}
            onClick={() => void handleImport()}
          >
            {importBackup.isPending ? 'Importing…' : 'Choose backup file…'}
          </Button>
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="h6" gutterBottom>
                Import ServiceNow OSCAL SSP
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Read a System Security Plan exported from ServiceNow (OSCAL 1.1.2 JSON; other 1.x versions are also
                accepted). It is migrated to OSCAL 1.2.0, then each control&apos;s narrative, implementation status,
                origination, parameters, responsible role and reference links are merged into the matching control.
                Artifacts, POA&amp;M and assessment data already in the workspace are kept. You&apos;ll see a preview first.
              </Typography>
            </Box>
            <Chip label="Overwrites imported fields" size="small" variant="outlined" />
          </Stack>
          <Button
            variant="outlined"
            startIcon={<CloudDownloadIcon />}
            sx={{ mt: 2 }}
            disabled={!index || snPicking}
            onClick={() => void handlePickServiceNow()}
          >
            {snPicking ? 'Reading…' : 'Choose ServiceNow OSCAL file…'}
          </Button>
        </Paper>
        </Stack>
      </Stack>

      <Dialog open={Boolean(snPreview)} onClose={() => setSnPreview(null)} fullWidth maxWidth="sm">
        <DialogTitle>Import ServiceNow OSCAL SSP</DialogTitle>
        <DialogContent dividers>
          {snPreview && (
            <Stack spacing={1.5}>
              <Typography variant="body2">
                <strong>{snPreview.result.fileName}</strong>
                {snPreview.result.systemName ? ` — ${snPreview.result.systemName}` : ''}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Chip size="small" label={`Source OSCAL ${snPreview.result.sourceVersion}`} />
                <Chip size="small" label={`Target OSCAL ${snPreview.result.targetVersion}`} color="primary" variant="outlined" />
              </Stack>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                <li>
                  <Typography variant="body2">{snPreview.plan.records.length} control(s) will be updated</Typography>
                </li>
                {snPreview.plan.overwrittenNarratives > 0 && (
                  <li>
                    <Typography variant="body2">
                      {snPreview.plan.overwrittenNarratives} existing implementation narrative(s) will be replaced
                    </Typography>
                  </li>
                )}
                {snPreview.plan.addedLinks > 0 && (
                  <li>
                    <Typography variant="body2">{snPreview.plan.addedLinks} reference link(s) will be added as artifacts</Typography>
                  </li>
                )}
                {snPreview.plan.unmatchedParameters > 0 && (
                  <li>
                    <Typography variant="body2">
                      {snPreview.plan.unmatchedParameters} parameter value(s) did not match a parameter in this catalog and will be skipped
                    </Typography>
                  </li>
                )}
                {snPreview.plan.unknownControls.length > 0 && (
                  <li>
                    <Typography variant="body2">
                      {snPreview.plan.unknownControls.length} control(s) are not in the catalog and will be skipped:{' '}
                      {snPreview.plan.unknownControls.slice(0, 12).join(', ')}
                      {snPreview.plan.unknownControls.length > 12 ? '…' : ''}
                    </Typography>
                  </li>
                )}
              </Box>
              {(snPreview.result.notes ?? []).length > 0 && (
                <Alert severity="info" variant="outlined">
                  <Box component="ul" sx={{ m: 0, pl: 2 }}>
                    {snPreview.result.notes!.map((n) => (
                      <li key={n}>
                        <Typography variant="body2">{n}</Typography>
                      </li>
                    ))}
                  </Box>
                </Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSnPreview(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!snPreview?.plan.records.length || saveEvidence.isPending}
            onClick={() => void handleApplyServiceNow()}
          >
            {saveEvidence.isPending ? 'Importing…' : `Import ${snPreview?.plan.records.length ?? 0} control(s)`}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
