import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { AiRelatedDraft, RelatedNarrative } from '@shared/types';
import { formatRelatedDraft } from '@shared/ai';
import type { ControlNode } from '@/domain/catalogIndex';
import { useAiRelatedDraft, useCatalogIndex, useEvidence } from '@/api/queries';
import { useAppState } from '@/state/AppState';
import { RichTextEditor, linesToEditorState } from './RichTextEditor';
import { LinkChip } from './routerLinks';

export interface RelatedControlsDrawerProps {
  open: boolean;
  node: ControlNode;
  currentNarrative: string;
  onClose: () => void;
}

export function RelatedControlsDrawer({ open, node, currentNarrative, onClose }: RelatedControlsDrawerProps) {
  const { data: index } = useCatalogIndex();
  const { data: evidence } = useEvidence();
  const { notify } = useAppState();
  const generate = useAiRelatedDraft();
  const [draft, setDraft] = useState<AiRelatedDraft | null>(null);
  const [edited, setEdited] = useState<{ json: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(null);
    setEdited(null);
    setError(null);
  }, [node.id]);

  const related = useMemo<RelatedNarrative[]>(() => {
    const ids = [...new Set([...node.relatedControls, ...node.crossReferences.map((r) => r.control_id)])].filter(
      (id) => id !== node.id,
    );
    return ids.map((id) => ({
      controlId: id,
      controlName: index?.nodeById.get(id)?.name ?? '',
      narrative: evidence?.[id]?.narrative.implementation.text.trim() ?? '',
    }));
  }, [node, index, evidence]);

  const withNarrative = related.filter((r) => r.narrative);

  const run = () => {
    setError(null);
    generate.mutate(
      {
        controlId: node.id,
        controlName: node.name,
        controlStatement: node.statement,
        statementTemplate: node.statementVerbatim || node.statement,
        supplementalGuidance: node.supplementalGuidance || node.discussion,
        currentNarrative,
        related: withNarrative,
      },
      {
        onSuccess: (result) => {
          const text = formatRelatedDraft(result);
          setDraft(result);
          setEdited({ json: linesToEditorState(text), text });
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Draft generation failed.'),
      },
    );
  };

  const copy = async () => {
    if (!edited?.text.trim()) return;
    await navigator.clipboard.writeText(edited.text);
    notify('Draft copied to the clipboard', 'success');
  };

  return (
    <Drawer anchor="left" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 600 } } } }}>
      <Stack direction="row" sx={{ alignItems: 'center', px: 2, py: 1.5 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1">Related controls — {node.id}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {related.length} related control(s), {withNarrative.length} with an implementation narrative
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Close related controls">
          <CloseIcon />
        </IconButton>
      </Stack>
      <Divider />

      <Box sx={{ overflowY: 'auto', p: 2 }}>
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle2">Draft from related narratives</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Uses AI to draft text for {node.id}, one statement element at a time, from what the related controls
                already implement. Elements the related narratives do not support are listed as gaps.
              </Typography>
              <Box>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={generate.isPending ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
                  disabled={generate.isPending || withNarrative.length === 0}
                  onClick={run}
                >
                  {draft ? 'Regenerate' : 'Generate partial narrative'}
                </Button>
              </Box>
              {withNarrative.length === 0 && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  None of the related controls has an implementation narrative yet.
                </Typography>
              )}
              {error && <Alert severity="error">{error}</Alert>}

              {draft && edited && (
                <>
                  {draft.elements.length === 0 && (
                    <Alert severity="info" variant="outlined">
                      The related narratives do not address any element of the {node.id} control statement.
                    </Alert>
                  )}
                  <RichTextEditor
                    key={draft.renderedPrompt + draft.elements.length}
                    label="Generated partial narrative"
                    valueJson={edited.json}
                    fallbackText={edited.text}
                    onChange={(json, text) => setEdited({ json, text })}
                    minHeight={180}
                    helperText="Review, then copy and paste the parts you want into the Implementation narrative. Nothing is added automatically."
                    actions={[
                      {
                        key: 'copy',
                        label: 'Copy',
                        title: 'Copy the generated text to the clipboard',
                        icon: <ContentCopyIcon fontSize="small" />,
                        onClick: () => void copy(),
                        disabled: !edited.text.trim(),
                      },
                    ]}
                  />
                  {draft.gaps.length > 0 && (
                    <Alert severity="warning" variant="outlined">
                      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                        Not covered by related narratives
                      </Typography>
                      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                        {draft.gaps.map((gap) => (
                          <li key={gap}>
                            <Typography variant="body2">{gap}</Typography>
                          </li>
                        ))}
                      </Box>
                    </Alert>
                  )}
                  <Accordion disableGutters elevation={0} variant="outlined">
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="caption">Prompt sent</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Typography
                        component="pre"
                        variant="caption"
                        sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', m: 0, maxHeight: 260, overflowY: 'auto' }}
                      >
                        {draft.renderedPrompt}
                      </Typography>
                    </AccordionDetails>
                  </Accordion>
                </>
              )}
            </Stack>
          </Paper>

          {related.length === 0 && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              The catalog lists no related controls for {node.id}.
            </Typography>
          )}

          {related.map((r) => (
            <Paper key={r.controlId} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                <Tooltip title={`Open ${r.controlId}`}>
                  <LinkChip
                    to="/control/$controlId"
                    params={{ controlId: r.controlId }}
                    label={r.controlId}
                    size="small"
                    variant="outlined"
                    clickable
                    onClick={onClose}
                    sx={{ height: 22, fontSize: 11 }}
                  />
                </Tooltip>
                <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                  {r.controlName}
                </Typography>
              </Stack>
              {r.narrative ? (
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {r.narrative}
                </Typography>
              ) : (
                <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                  No implementation narrative written yet.
                </Typography>
              )}
            </Paper>
          ))}
        </Stack>
      </Box>
    </Drawer>
  );
}
