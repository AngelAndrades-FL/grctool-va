import { useState } from 'react';
import { Box, Button, IconButton, Link, Stack, Tooltip, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import { DateTime } from 'luxon';
import type { Artifact } from '@shared/types';
import { api } from '@/api/client';
import { useAppState } from '@/state/AppState';

interface PoamAttachmentsProps {
  controlId: string;
  familyId: string;
  artifactIds: string[];
  artifacts: Artifact[];
  currentUser: string;
  onArtifactIdsChange: (ids: string[]) => void;
  onArtifactsChange: (artifacts: Artifact[]) => void;
}

/**
 * Files proving the finding itself — the POA&M record, a risk acceptance memo,
 * closure evidence. Supplements the written remediation plan; it does not
 * replace it.
 */
export function PoamAttachments({
  controlId,
  familyId,
  artifactIds,
  artifacts,
  currentUser,
  onArtifactIdsChange,
  onArtifactsChange,
}: PoamAttachmentsProps) {
  const { notify } = useAppState();
  const [uploading, setUploading] = useState(false);

  const linked = artifactIds
    .map((id) => artifacts.find((a) => a.id === id))
    .filter((a): a is Artifact => Boolean(a));

  const upload = async () => {
    setUploading(true);
    try {
      const result = await api.addAttachments({ controlId, familyId });
      if (result.cancelled || result.artifacts.length === 0) return;

      const now = DateTime.now();
      const collectedOn = now.toISODate() ?? '';
      const files = await Promise.all(
        result.artifacts.map(async (file) =>
          file.filePath
            ? { ...file, ...(await api.renameAttachment({ filePath: file.filePath, controlId, collectedOn, scheme: 'poam' })) }
            : file,
        ),
      );
      const added: Artifact[] = files.map((file) => ({
        id: crypto.randomUUID(),
        evidenceType: 'POA&M',
        title: file.fileName ?? 'POA&M record',
        description: `POA&M documentation for ${controlId}.`,
        kind: 'file',
        collectedAt: now.toISO() ?? undefined,
        collectedBy: currentUser,
        ...file,
      }));

      onArtifactsChange([...artifacts, ...added]);
      onArtifactIdsChange([...artifactIds, ...added.map((a) => a.id)]);
      notify(`Attached ${added.length} POA&M file(s)`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  // Unlinking leaves the artifact in the record's evidence list rather than deleting the file.
  const unlink = (id: string) => onArtifactIdsChange(artifactIds.filter((a) => a !== id));

  const isArchived = (artifact: Artifact) => Boolean(artifact.fileName?.startsWith('archive_'));

  const archive = async (artifact: Artifact) => {
    if (!artifact.filePath) return;
    try {
      const collectedOn = (artifact.collectedAt ? DateTime.fromISO(artifact.collectedAt) : DateTime.now()).toISODate() ?? '';
      const renamed = await api.renameAttachment({ filePath: artifact.filePath, controlId, collectedOn, scheme: 'poam-archive' });
      const title = !artifact.title || artifact.title === artifact.fileName ? renamed.fileName ?? artifact.title : artifact.title;
      onArtifactsChange(artifacts.map((a) => (a.id === artifact.id ? { ...a, ...renamed, title } : a)));
      notify('POA&M file archived', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Archive failed', 'error');
    }
  };

  const remove = async (artifact: Artifact) => {
    const label = artifact.title || artifact.fileName || 'this file';
    if (!window.confirm(`Delete "${label}"? The file will be permanently deleted from the workspace.`)) return;
    try {
      if (artifact.filePath) await api.deleteAttachments([artifact.filePath]);
      onArtifactsChange(artifacts.filter((a) => a.id !== artifact.id));
      onArtifactIdsChange(artifactIds.filter((a) => a !== artifact.id));
      notify('POA&M file deleted', 'info');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Delete failed', 'error');
    }
  };

  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
        POA&amp;M documentation — the tracked POA&amp;M record, risk acceptance memo or closure proof. The remediation
        plan above stays the written summary.
      </Typography>

      <Stack spacing={0.5}>
        {linked.map((artifact) => (
          <Stack key={artifact.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="caption" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
              {artifact.title || artifact.fileName}
              {isArchived(artifact) ? ' · archived' : ''}
              {artifact.collectedAt
                ? ` · ${DateTime.fromISO(artifact.collectedAt).toFormat('dd LLL yyyy')}`
                : ''}
            </Typography>
            {artifact.filePath && (
              <Link
                component="button"
                type="button"
                variant="caption"
                onClick={() => void api.revealAttachment(artifact.filePath!)}
              >
                Show in folder
              </Link>
            )}
            <Tooltip title="Unlink from this finding (keeps the file in evidence artifacts)">
              <IconButton size="small" onClick={() => unlink(artifact.id)}>
                <LinkOffIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {artifact.filePath && !isArchived(artifact) && (
              <Tooltip title="Archive (renames the file with an archive_ prefix)">
                <IconButton size="small" onClick={() => void archive(artifact)}>
                  <ArchiveOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Delete file">
              <IconButton size="small" onClick={() => void remove(artifact)}>
                <DeleteOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ))}
      </Stack>

      <Button size="small" startIcon={<UploadFileIcon />} disabled={uploading} onClick={() => void upload()} sx={{ mt: 0.5 }}>
        {uploading ? 'Attaching…' : 'Attach POA&M file'}
      </Button>
    </Box>
  );
}
